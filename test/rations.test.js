import test from 'node:test';
import assert from 'node:assert/strict';
import { batchTargets, rationTotals } from '../js/calc.js';
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

test('a new DM % changes the as-fed amount but keeps the dry matter', () => {
  const d = defaultData();
  const holstein = d.rations.find((r) => r.id === 'holstein');
  const before = batchTargets(holstein, d.ingredients, { headCount: 256, roundTo: 1 });
  d.ingredients.find((i) => i.id === 'cs-1010').dmPct = 34; // wetter silage
  const after = batchTargets(holstein, d.ingredients, { headCount: 256, roundTo: 1 });
  const cs = (t) => t.find((x) => x.ingredientId === 'cs-1010');
  // 18.44 lb DM × 256 head × 50% ÷ 0.34 = 6,942 lb as fed (was 6,442 at 36.64%).
  assert.equal(cs(before).target, 6442);
  assert.equal(cs(after).target, 6942);
  assert.equal(cs(after).dmPct, 34);
  // Other ingredients are untouched.
  assert.deepEqual(after.filter((x) => x.ingredientId !== 'cs-1010'), before.filter((x) => x.ingredientId !== 'cs-1010'));
});

test('rationTotals gives dry matter intake and as-fed per head', () => {
  const d = defaultData();
  const t = rationTotals(d.rations.find((r) => r.id === 'holstein'), d.ingredients);
  assert.equal(t.dm.toFixed(2), '52.91'); // "Inputted DMI: 52.91" on the sheet
  assert.equal(t.asFed.toFixed(2), '109.12'); // as-fed total on the sheet: 109.1158
});

test('devices saved with as-fed rations (v2) upgrade to dry matter with identical loads', () => {
  // A v2 device: as-fed lb per head, no DM %, plus a home-made ingredient.
  const v2 = {
    seedVersion: 2,
    ingredients: [{ id: 'cs-1010', name: 'Corn Silage 10.10.26', costPerTon: 58 }, { id: 'x1', name: 'Salt' }],
    rations: [{ id: 'r', name: 'R', feedingPct: 50, items: [{ ingredientId: 'cs-1010', lbsPerHead: 50.328 }, { ingredientId: 'x1', lbsPerHead: 0.25 }] }],
    pens: [], loads: [{ id: 'old' }], users: [], settings: {},
  };
  const v3 = normalize(v2);
  assert.equal(v3.seedVersion, 3);
  assert.equal(v3.ingredients[0].dmPct, 36.64);
  assert.equal(v3.ingredients[0].costPerTon, 58);
  assert.equal(v3.ingredients[1].dmPct, 100);
  assert.ok(!('lbsPerHead' in v3.rations[0].items[0]));
  const targets = batchTargets(v3.rations[0], v3.ingredients, { headCount: 256, roundTo: 10 }).map((t) => t.target);
  assert.deepEqual(targets, [6440, 30]);
  assert.equal(v3.loads.length, 1);
});
