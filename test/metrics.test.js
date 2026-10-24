import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance, finishSession, itemCost, rationCostPerHeadDay, startSession,
} from '../js/calc.js';
import { costPerHeadDay, summarize } from '../js/metrics.js';

const tolOpts = { tolerancePct: 2, toleranceMinLbs: 20 };

test('itemCost uses as-fed $/ton and is null without a price', () => {
  assert.equal(itemCost(2000, 55), 55);
  assert.equal(itemCost(500, 300), 75);
  assert.equal(itemCost(500, null), null);
  assert.equal(itemCost(500, ''), null);
});

test('rationCostPerHeadDay adds priced ingredients and lists unpriced ones', () => {
  const ingredients = [{ id: 'a', name: 'Hay', costPerTon: 200 }, { id: 'b', name: 'Corn', costPerTon: null }];
  const r = rationCostPerHeadDay({ items: [{ ingredientId: 'a', dmLbsPerHead: 10 }, { ingredientId: 'b', dmLbsPerHead: 5 }] }, ingredients);
  assert.equal(r.cost, 1);
  assert.deepEqual(r.missing, ['Corn']);
});

test('a finished load keeps the prices it was loaded at', () => {
  const s = startSession({
    targets: [{ name: 'Hay', target: 1000, costPerTon: 200 }, { name: 'Mineral', target: 100, costPerTon: null }],
    startWeight: 0, rationName: 'R', feedingPct: 50, headCount: 100,
  });
  advance(s, 1000);
  advance(s, 1100);
  const load = finishSession(s);
  assert.equal(load.items[0].cost, 100);
  assert.equal(load.items[1].cost, null);
  assert.equal(load.totalCost, 100);
  assert.equal(load.costComplete, false);
  // $100 for 100 head at half the daily amount = $2.00 per head per day.
  assert.equal(costPerHeadDay(load), 2);
});

const load = (startedAt, { pen = 'Holstein Cows', operator = 'Sam', items, headCount = 100, feedingPct = 100 }) => ({
  startedAt,
  finishedAt: startedAt,
  penName: pen,
  rationName: pen,
  operator,
  headCount,
  feedingPct,
  items,
  totalTarget: items.reduce((s, i) => s + i.target, 0),
  totalActual: items.reduce((s, i) => s + i.actual, 0),
  totalCost: items.some((i) => i.cost !== null) ? items.reduce((s, i) => s + (i.cost ?? 0), 0) : null,
  costComplete: items.every((i) => i.cost !== null),
});

const now = new Date('2026-10-21T15:00:00');
const loads = [
  load('2026-10-21T06:00:00', { items: [
    { name: 'Hay', target: 1000, actual: 1010, cost: 101, skipped: false }, // on target
    { name: 'Silage', target: 5000, actual: 5300, cost: 132.5, skipped: false }, // over
  ] }),
  load('2026-10-20T06:00:00', { pen: 'Jerseys', operator: 'Joe', items: [
    { name: 'Hay', target: 500, actual: 500, cost: 50, skipped: false },
    { name: 'Silage', target: 2000, actual: 0, cost: 0, skipped: true },
  ] }),
  load('2026-09-01T06:00:00', { items: [{ name: 'Hay', target: 800, actual: 800, cost: null, skipped: false }] }),
];

test('summarize totals a period and leaves older loads out', () => {
  const m = summarize(loads, { period: '7', tolOpts, now });
  assert.equal(m.loads, 2);
  assert.equal(m.lbs, 6810);
  assert.equal(m.cost, 283.5);
  assert.equal(m.skipped, 1);
  // 3 loaded items, 2 on target (the skipped one doesn't count either way).
  assert.equal(Math.round(m.accuracyPct), 67);
  // |10| + |300| + |0| over 6500 lb of targets.
  assert.equal(m.deviationPct.toFixed(2), (310 / 6500 * 100).toFixed(2));
  assert.equal(summarize(loads, { period: 'today', tolOpts, now }).loads, 1);
  assert.equal(summarize(loads, { period: 'all', tolOpts, now }).loads, 3);
});

test('summarize breaks figures down by group, ingredient and operator', () => {
  const m = summarize(loads, { period: '7', tolOpts, now });
  assert.deepEqual(m.byGroup.map((g) => [g.name, g.loads, g.lbs]), [['Holstein Cows', 1, 6310], ['Jerseys', 1, 500]]);
  assert.equal(m.byGroup[0].costPerHeadDay, 2.335);
  const silage = m.byIngredient.find((i) => i.name === 'Silage');
  assert.deepEqual([silage.target, silage.actual, silage.skipped], [5000, 5300, 1]);
  assert.deepEqual(m.byOperator.map((o) => o.name).sort(), ['Joe', 'Sam']);
});

test('the daily trend covers at least a week, with empty days at zero', () => {
  const m = summarize(loads, { period: 'today', tolOpts, now });
  assert.equal(m.daily.length, 7);
  assert.equal(m.daily.at(-1).date, '2026-10-21');
  assert.equal(m.daily.at(-1).cost, 233.5);
  assert.equal(m.daily.at(-2).lbs, 500);
  assert.equal(m.daily[0].loads, 0);
  assert.equal(m.daily[0].cost, null);
});

test('summaries of old loads without prices report unknown cost, not $0', () => {
  const m = summarize([loads[2]], { period: 'all', tolOpts, now });
  assert.equal(m.cost, null);
  assert.equal(m.unpricedLoads, 1);
});
