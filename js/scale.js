// Live connection to the mixer wagon's scale indicator.
//
// Several transports are supported because indicators and tablets vary:
//   serial     – USB-to-RS-232 cable or Bluetooth serial (Web Serial, Chrome/Edge)
//   bluetooth  – Bluetooth Low Energy serial module (Web Bluetooth, Chrome on Android)
//   websocket  – a Wi-Fi bridge (e.g. ESP32) that forwards the indicator's output
//   manual     – the operator types the reading from the indicator's display
//   simulator  – fake scale for trying the app out
//
// Emits 'weight' (detail: lbs), 'status' and 'line' (raw text, for setup).

import { LineBuffer, makeWeightParser } from './parser.js';

const STALE_MS = 5000;

class ManualAdapter {
  constructor(settings, cb) {
    this.cb = cb;
  }
  async open() {
    this.cb.status('connected', 'Type the mixer scale reading');
  }
  close() {}
}

class SimulatorAdapter {
  constructor(settings, cb) {
    this.cb = cb;
    this.weight = 0;
    this.target = 0;
  }
  async open() {
    this.cb.status('connected', 'Simulator');
    this.timer = setInterval(() => {
      const gap = this.target - this.weight;
      this.weight += Math.abs(gap) < 60 ? gap : Math.sign(gap) * 60;
      const noise = Math.round((Math.random() - 0.5) * 4);
      this.cb.weight(Math.round(this.weight) + noise);
    }, 200);
  }
  addBucket() {
    this.target += 300 + Math.round(Math.random() * 600);
  }
  empty() {
    this.target = 0;
  }
  close() {
    clearInterval(this.timer);
  }
}

class SerialAdapter {
  constructor(settings, cb) {
    this.settings = settings;
    this.cb = cb;
  }
  async open({ auto }) {
    if (!('serial' in navigator)) {
      throw new Error('This browser has no Web Serial support. Use Chrome or Edge.');
    }
    const [granted] = await navigator.serial.getPorts();
    if (auto && !granted) throw new Error('Tap Connect to choose the scale port');
    this.port = granted ?? (await navigator.serial.requestPort());
    await this.port.open({ baudRate: Number(this.settings.serialBaud) || 9600 });
    this.cb.status('connected', 'Serial');
    this.readLoop();
  }
  async readLoop() {
    const decoder = new TextDecoder();
    const lines = new LineBuffer(this.cb.line);
    while (this.port.readable && !this.closed) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          lines.push(decoder.decode(value, { stream: true }));
        }
      } catch (err) {
        // Framing/parity errors are recoverable; the loop opens a new reader.
        if (!this.closed) this.cb.status('error', err.message);
      } finally {
        this.reader.releaseLock();
      }
    }
    if (!this.closed) this.cb.status('error', 'Scale cable disconnected');
  }
  async close() {
    this.closed = true;
    try { await this.reader?.cancel(); } catch { /* already closed */ }
    try { await this.port?.close(); } catch { /* already closed */ }
  }
}

// 16-bit UUIDs such as "ffe0" must be passed to Web Bluetooth as numbers.
const bleUuid = (s) => {
  const v = String(s).trim().toLowerCase();
  return /^[0-9a-f]{4}$/.test(v) ? Number.parseInt(v, 16) : v;
};

class BluetoothAdapter {
  constructor(settings, cb) {
    this.settings = settings;
    this.cb = cb;
  }
  async open({ auto }) {
    if (!navigator.bluetooth) {
      throw new Error('This browser has no Web Bluetooth support. Use Chrome on Android.');
    }
    if (auto) throw new Error('Tap Connect to pair with the scale');
    const service = bleUuid(this.settings.bleService);
    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [service],
    });
    this.device.addEventListener('gattserverdisconnected', () => {
      if (!this.closed) this.cb.status('error', 'Bluetooth disconnected – tap Connect');
    });
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(service);
    const char = await svc.getCharacteristic(bleUuid(this.settings.bleCharacteristic));
    const decoder = new TextDecoder();
    const lines = new LineBuffer(this.cb.line);
    char.addEventListener('characteristicvaluechanged', (e) =>
      lines.push(decoder.decode(e.target.value, { stream: true })),
    );
    await char.startNotifications();
    this.cb.status('connected', this.device.name || 'Bluetooth');
  }
  close() {
    this.closed = true;
    try { this.device?.gatt?.disconnect(); } catch { /* already gone */ }
  }
}

class WebSocketAdapter {
  constructor(settings, cb) {
    this.settings = settings;
    this.cb = cb;
  }
  async open() {
    this.connect();
  }
  connect() {
    // Throws synchronously for a bad URL, or for ws:// from an https:// page.
    const ws = new WebSocket(this.settings.wsUrl);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    const decoder = new TextDecoder();
    const lines = new LineBuffer(this.cb.line);
    ws.onopen = () => this.cb.status('connected', 'Wi-Fi bridge');
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') lines.push(`${e.data}\n`); // one reading per message
      else lines.push(decoder.decode(e.data, { stream: true }));
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.cb.status('error', 'Bridge not reachable – retrying…');
      this.retry = setTimeout(() => this.connect(), 3000);
    };
  }
  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.ws?.close();
  }
}

const ADAPTERS = {
  manual: ManualAdapter,
  simulator: SimulatorAdapter,
  serial: SerialAdapter,
  bluetooth: BluetoothAdapter,
  websocket: WebSocketAdapter,
};

export const SCALE_TYPES = {
  simulator: 'Simulator (demo)',
  manual: 'Manual entry',
  serial: 'Serial / USB cable',
  bluetooth: 'Bluetooth LE module',
  websocket: 'Wi-Fi bridge (WebSocket)',
};

export class ScaleConnection extends EventTarget {
  weight = null;
  status = 'disconnected'; // connecting | connected | stale | error | disconnected
  message = '';
  type = null;
  recentLines = [];
  adapter = null;
  parse = makeWeightParser();
  lastAt = 0;

  constructor() {
    super();
    setInterval(() => {
      const live = this.type !== 'manual' && this.status === 'connected';
      if (live && Date.now() - this.lastAt > STALE_MS) this.setStatus('stale', 'No data from scale');
    }, 1000);
  }

  get simulator() {
    return this.adapter instanceof SimulatorAdapter ? this.adapter : null;
  }

  async connect(type, settings, { auto = false } = {}) {
    await this.disconnect();
    try {
      this.parse = makeWeightParser({ pattern: settings.parserPattern, divisor: settings.parserDivisor });
    } catch (err) {
      this.setStatus('error', `Bad weight pattern: ${err.message}`);
      return;
    }
    const Adapter = ADAPTERS[type] ?? ManualAdapter;
    this.type = type;
    this.lastAt = Date.now();
    const adapter = new Adapter(settings, {
      line: (l) => this.onLine(adapter, l),
      weight: (w) => this.adapter === adapter && this.setWeight(w),
      status: (s, m) => this.adapter === adapter && this.setStatus(s, m),
    });
    this.adapter = adapter;
    this.setStatus('connecting', 'Connecting…');
    try {
      await adapter.open({ auto });
    } catch (err) {
      if (this.adapter === adapter) {
        this.adapter = null;
        this.setStatus('error', err.message);
      }
    }
  }

  async disconnect() {
    const adapter = this.adapter;
    this.adapter = null;
    if (adapter) await adapter.close();
    // Never show an old reading as if it were live.
    this.weight = null;
    this.dispatchEvent(new CustomEvent('weight', { detail: null }));
    this.setStatus('disconnected', '');
  }

  setManual(lbs) {
    if (this.type === 'manual' && Number.isFinite(lbs)) this.setWeight(lbs);
  }

  onLine(adapter, line) {
    if (this.adapter !== adapter) return;
    this.recentLines = [...this.recentLines.slice(-14), line];
    this.dispatchEvent(new CustomEvent('line', { detail: line }));
    const w = this.parse(line);
    if (w !== null) this.setWeight(w);
  }

  setWeight(lbs) {
    this.weight = lbs;
    this.lastAt = Date.now();
    if (this.status !== 'connected') this.setStatus('connected', '');
    this.dispatchEvent(new CustomEvent('weight', { detail: lbs }));
  }

  setStatus(status, message = '') {
    this.status = status;
    this.message = message;
    this.dispatchEvent(new CustomEvent('status'));
  }
}
