import test from 'node:test';
import assert from 'node:assert/strict';
import { LineBuffer, makeWeightParser } from '../js/parser.js';

test('default parser takes the first number on the line', () => {
  const parse = makeWeightParser();
  assert.equal(parse('   12345 LB GR'), 12345);
  assert.equal(parse('ST,GS,+0012345 lb'), 12345);
  assert.equal(parse('-  120 LB'), -120);
  assert.equal(parse('12,345 lb'), 12345);
  assert.equal(parse('1234.5'), 1234.5);
  assert.equal(parse('MOTION'), null);
});

test('custom pattern uses the first capture group, and divisor scales it', () => {
  const parse = makeWeightParser({ pattern: 'W=([-\\d]+)', divisor: 10 });
  assert.equal(parse('ID01 W=123450 T=0'), 12345);
  assert.equal(parse('ID01 T=5'), null);
});

test('invalid pattern throws so the UI can report it', () => {
  assert.throws(() => makeWeightParser({ pattern: '(' }));
});

test('LineBuffer splits chunks on CR, LF, CRLF and STX/ETX', () => {
  const lines = [];
  const buf = new LineBuffer((l) => lines.push(l));
  buf.push('  100 LB\r\n  2');
  buf.push('00 LB\r');
  buf.push('\x02  300 LB\x03');
  buf.push('400');
  assert.deepEqual(lines, ['  100 LB', '  200 LB', '  300 LB']);
});

test('LineBuffer drops runaway data with no line endings', () => {
  const lines = [];
  const buf = new LineBuffer((l) => lines.push(l));
  buf.push('x'.repeat(2000));
  buf.push('5 LB\n');
  assert.deepEqual(lines, ['5 LB']);
});
