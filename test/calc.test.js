import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance, batchTargets, finishSession, goBack, netLoaded, startSession, stepStatus, tolerance,
} from '../js/calc.js';

const ingredients = [{ id: 'a', name: 'Hay' }, { id: 'b', name: 'Corn' }, { id: 'c', name: 'Silage' }];
const ration = {
  name: 'Test',
  items: [
    { ingredientId: 'a', dmLbsPerHead: 4 },
    { ingredientId: 'b', dmLbsPerHead: 12.5 },
    { ingredientId: 'c', dmLbsPerHead: 0 },
  ],
};

test('batchTargets scales by head count, skipping zero-amount ingredients', () => {
  assert.deepEqual(batchTargets(ration, ingredients, { headCount: 100 }), [
    { ingredientId: 'a', name: 'Hay', target: 400, costPerTon: null, dmPct: 100 },
    { ingredientId: 'b', name: 'Corn', target: 1250, costPerTon: null, dmPct: 100 },
  ]);
});

test('batchTargets scales to a total batch weight in proportion', () => {
  const t = batchTargets(ration, ingredients, { totalLbs: 3300 });
  assert.deepEqual(t.map((x) => x.target), [800, 2500]);
});

test('batchTargets handles an empty ration and a deleted ingredient', () => {
  assert.deepEqual(batchTargets({ items: [] }, ingredients, { totalLbs: 1000 }), []);
  const t = batchTargets({ items: [{ ingredientId: 'zz', dmLbsPerHead: 1 }] }, ingredients, { headCount: 5 });
  assert.equal(t[0].name, '(deleted ingredient)');
});

test('tolerance uses the larger of percent and minimum lb', () => {
  assert.equal(tolerance(10000, { tolerancePct: 2, toleranceMinLbs: 20 }), 200);
  assert.equal(tolerance(100, { tolerancePct: 2, toleranceMinLbs: 20 }), 20);
});

test('stepStatus classifies under / ok / over', () => {
  assert.equal(stepStatus(1000, 900, 20), 'under');
  assert.equal(stepStatus(1000, 985, 20), 'ok');
  assert.equal(stepStatus(1000, 1020, 20), 'ok');
  assert.equal(stepStatus(1000, 1021, 20), 'over');
});

test('a loading session measures each ingredient from the gross weight', () => {
  const targets = batchTargets(ration, ingredients, { headCount: 100 });
  const s = startSession({ targets, startWeight: 250, rationName: 'Test', now: new Date('2026-01-01T06:00:00Z') });

  assert.equal(netLoaded(s, 650), 400);
  assert.equal(advance(s, 655), false);
  assert.equal(s.steps[0].actual, 405);
  assert.equal(s.steps[1].start, 655);
  assert.equal(netLoaded(s, 1900), 1245);

  assert.equal(advance(s, 1900), true);
  const load = finishSession(s, new Date('2026-01-01T06:20:00Z'));
  assert.deepEqual(load.items.map((i) => i.actual), [405, 1245]);
  assert.equal(load.totalTarget, 1650);
  assert.equal(load.totalActual, 1650);
  assert.equal(load.finishedAt, '2026-01-01T06:20:00.000Z');
});

test('goBack reopens the previous ingredient with its original start weight', () => {
  const targets = batchTargets(ration, ingredients, { headCount: 100 });
  const s = startSession({ targets, startWeight: 0, rationName: 'Test' });
  advance(s, 300); // tapped Next too early
  goBack(s);
  assert.equal(s.index, 0);
  assert.equal(s.steps[0].actual, null);
  assert.equal(netLoaded(s, 400), 400);
  goBack(s); // no-op on the first ingredient
  assert.equal(s.index, 0);
});

test('skipped ingredients are flagged in the record', () => {
  const targets = batchTargets(ration, ingredients, { headCount: 100 });
  const s = startSession({ targets, startWeight: 0, rationName: 'Test' });
  advance(s, 0, { skip: true });
  advance(s, 1250);
  const load = finishSession(s);
  assert.equal(load.items[0].skipped, true);
  assert.equal(load.items[0].actual, 0);
  assert.equal(load.items[1].actual, 1250);
});
