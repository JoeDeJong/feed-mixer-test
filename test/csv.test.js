import test from 'node:test';
import assert from 'node:assert/strict';
import { loadsToCsv } from '../js/csv.js';

test('loadsToCsv writes one row per ingredient and escapes text', () => {
  const csv = loadsToCsv([{
    startedAt: '2026-01-01T06:00:00.000Z',
    finishedAt: '2026-01-01T06:20:00.000Z',
    operator: 'Sam',
    penName: 'Pen 1, "High"',
    rationName: 'Lact',
    headCount: 100,
    items: [
      { name: 'Hay', target: 400, actual: 410, skipped: false, costPerTon: 200, cost: 41 },
      { name: 'Corn', target: 1250, actual: 0, skipped: true },
    ],
  }]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'started,finished,operator,pen,ration,head_count,ingredient,target_lb,actual_lb,diff_lb,skipped,cost_per_ton,cost_usd');
  assert.equal(lines[1], '2026-01-01T06:00:00.000Z,2026-01-01T06:20:00.000Z,Sam,"Pen 1, ""High""",Lact,100,Hay,400,410,10,,200,41.00');
  assert.match(lines[2], /,Corn,1250,0,-1250,yes,,$/);
});
