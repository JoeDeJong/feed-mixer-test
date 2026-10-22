import test from 'node:test';
import assert from 'node:assert/strict';
import { batchTargets } from '../js/calc.js';
import { defaultData, normalize } from '../js/store.js';

const data = defaultData();
const targets = (rationId, headCount) => batchTargets(
  data.rations.find((r) => r.id === rationId), data.ingredients, { headCount, roundTo: 10 },
).map((t) => t.target);

// Expected values copied from the nutritionist's feeding sheets.
test('Holstein Cows (50% of daily per load) matches the 10/12/26 sheet', () => {
  assert.deepEqual(targets('holstein', 256), [280, 1070, 1030, 1680, 3460, 6440]);
  assert.deepEqual(targets('holstein', 302), [340, 1260, 1220, 1980, 4080, 7600]);
});

test('Mature Jerseys (100%) matches the 10/12/26 sheet', () => {
  assert.deepEqual(targets('jersey', 154), [410, 1350, 770, 1380, 3770, 5500]);
});

test('1st lactation Jerseys (100%) matches the 10/12/26 sheet', () => {
  assert.deepEqual(targets('jersey-1st', 112), [220, 990, 570, 1190, 2320, 3600]);
});

test('Closeups (200%) matches the 9/30/26 sheet', () => {
  assert.deepEqual(targets('closeup', 14), [120, 110, 30, 40, 90, 60, 780, 60]);
  assert.deepEqual(targets('closeup', 44), [390, 350, 90, 130, 290, 190, 2450, 180]);
});

test('feeding % does not change a load scaled to a total weight', () => {
  const ration = data.rations.find((r) => r.id === 'holstein');
  const t = batchTargets(ration, data.ingredients, { totalLbs: 13960, roundTo: 10 });
  assert.deepEqual(t.map((x) => x.target), [280, 1070, 1030, 1680, 3460, 6440]);
});

test('data saved with the old demo rations switches to the farm rations, keeping history', () => {
  const old = { rations: [{ id: 'lact', name: 'Lactating cows', items: [] }], ingredients: [], pens: [], loads: [{ id: 'x' }], settings: { operator: 'Joe' } };
  const migrated = normalize(old);
  assert.deepEqual(migrated.rations.map((r) => r.id), ['holstein', 'jersey', 'jersey-1st', 'closeup']);
  assert.equal(migrated.loads.length, 1);
  assert.equal(migrated.settings.operator, 'Joe');
  const edited = normalize({ ...migrated, rations: [] });
  assert.deepEqual(edited.rations, [], 'later edits are kept');
});
