// Everything is stored on the tablet itself (localStorage), so the app works
// with no internet connection in the cab.

const KEY = 'feedmixer.v1';

export const defaultSettings = {
  tolerancePct: 2,
  toleranceMinLbs: 20,
  mixerCapacityLbs: 15000,
  roundToLbs: 10,
  autoLockMinutes: 15,
  beep: true,
  scaleType: 'simulator',
  serialBaud: 9600,
  bleService: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  bleCharacteristic: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  wsUrl: 'ws://192.168.4.1:81',
  parserPattern: '',
  parserDivisor: 1,
};

// Bump when the built-in rations change, so devices that still hold the
// earlier built-in set pick up the new one (their history and settings stay).
const SEED_VERSION = 2;

export function defaultData() {
  const ing = (id, name) => ({ id, name });
  const item = (ingredientId, lbsPerHead) => ({ ingredientId, lbsPerHead });
  return {
    seedVersion: SEED_VERSION,
    ingredients: [
      ing('alf-z', 'Alfalfa Zehner 11.2025'),
      ing('alf-zg', 'Alfalfa Zehner.Gardner'),
      ing('straw', 'Wheat Straw 11.15.22'),
      ing('pvm', 'Kuipers PVM 9.30.26'),
      ing('cu-grain', 'Kuipers Closeup Grain November 26 23'),
      ing('zelit', 'X Zelit'),
      ing('canola', 'Warden HiFat Canola'),
      ing('earlage', 'Earlage 9.30.26'),
      ing('grass', 'Grass Silage 9.15.26'),
      ing('cs-1010', 'Corn Silage 10.10.26'),
      ing('cs-0630', 'Corn Silage 6.30.26'),
      ing('molasses', 'Molasses 42 Blend'),
    ],
    // As-fed lb per head per day and feeding % from the nutritionist's
    // feeding sheets; items are in loading order.
    rations: [
      {
        id: 'holstein',
        name: 'Holstein Cows – 10/12/26',
        feedingPct: 50,
        items: [
          item('alf-z', 2.222), item('pvm', 8.3579), item('canola', 8.054),
          item('earlage', 13.131), item('grass', 27.023), item('cs-1010', 50.328),
        ],
      },
      {
        id: 'jersey',
        name: 'Mature Jerseys – 10/12/26',
        feedingPct: 100,
        items: [
          item('alf-z', 2.666), item('pvm', 8.7542), item('canola', 5.0),
          item('earlage', 8.977), item('grass', 24.487), item('cs-1010', 35.699),
        ],
      },
      {
        id: 'jersey-1st',
        name: '1st Lact. Jerseys – 10/12/26',
        feedingPct: 100,
        items: [
          item('alf-z', 2.0), item('pvm', 8.8019), item('canola', 5.088),
          item('earlage', 10.61), item('grass', 20.673), item('cs-1010', 32.151),
        ],
      },
      {
        id: 'closeup',
        name: 'Closeups – 9/30/26',
        feedingPct: 200,
        items: [
          item('straw', 4.444), item('alf-zg', 3.999), item('zelit', 0.99983),
          item('cu-grain', 1.4997), item('canola', 3.349), item('earlage', 2.201),
          item('cs-0630', 27.897), item('molasses', 2.0),
        ],
      },
    ],
    pens: [
      { id: 'pen-holstein', name: 'Holstein Cows', headCount: 256, rationId: 'holstein' },
      { id: 'pen-jersey', name: 'Mature Jerseys', headCount: 154, rationId: 'jersey' },
      { id: 'pen-jersey-1st', name: '1st Lact. Jerseys', headCount: 112, rationId: 'jersey-1st' },
      { id: 'pen-closeup', name: 'Closeups', headCount: 14, rationId: 'closeup' },
    ],
    users: [],
    loads: [],
    activeLoad: null,
    settings: { ...defaultSettings },
  };
}

export function normalize(raw) {
  const base = defaultData();
  const data = { ...base, ...raw, settings: { ...defaultSettings, ...(raw?.settings ?? {}) } };
  if (!raw?.seedVersion) {
    // Saved before the farm rations were built in: it only has the demo set.
    Object.assign(data, {
      seedVersion: SEED_VERSION,
      ingredients: base.ingredients,
      rations: base.rations,
      pens: base.pens,
    });
  }
  return data;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.error('Could not read saved data', err);
  }
  return defaultData();
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Could not save data', err);
  }
}
