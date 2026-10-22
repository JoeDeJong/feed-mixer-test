// Turning raw text from a scale indicator into a weight.
//
// Most mixer-wagon indicators stream ASCII lines such as
//   "   12345 LB GR"   or   "ST,GS,+0012345 lb"
// so by default we take the first number on each line. A custom regular
// expression can be configured for indicators with a different format; its
// first capture group (or the whole match) is used as the number.

export function parseNumber(text) {
  // "- 120" -> -120, "1,234" -> 1234, "+0012345" -> 12345
  const cleaned = text.replace(/\s+/g, '').replace(/,/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function makeWeightParser({ pattern = '', divisor = 1 } = {}) {
  const re = pattern ? new RegExp(pattern) : /[-+]?\s*\d[\d,]*(?:\.\d+)?/;
  const div = Number(divisor) > 0 ? Number(divisor) : 1;
  return function parse(line) {
    const m = line.match(re);
    if (!m) return null;
    const n = parseNumber(m[1] ?? m[0]);
    return n === null ? null : n / div;
  };
}

// Collects chunks of text and calls onLine for every complete line.
// Lines may end in CR, LF, CRLF, or be framed with STX/ETX.
export class LineBuffer {
  constructor(onLine) {
    this.onLine = onLine;
    this.buf = '';
  }

  push(text) {
    this.buf += text;
    const parts = this.buf.split(/\r\n|[\r\n\x02\x03]/);
    this.buf = parts.pop();
    for (const part of parts) if (part.trim()) this.onLine(part);
    // Never let a stream without line endings grow without bound.
    if (this.buf.length > 1024) this.buf = '';
  }
}
