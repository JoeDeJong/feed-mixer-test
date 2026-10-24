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

// Bump when the built-in data changes. Version 2 added the farm rations;
// version 3 moved rations to dry-matter amounts and added DM % per ingredient.
const SEED_VERSION = 3;

// DM % from the nutritionist's feeding sheets.
const SHEET_DM = {
  'alf-z': 90, 'alf-zg': 90, straw: 90, pvm: 91.3847, 'cu-grain': 92.718, zelit: 93,
  canola: 90, earlage: 53.47, grass: 39.07, 'cs-1010': 36.64, 'cs-0630': 35.41, molasses: 68.13,
};

export function defaultData() {
  const ing = (id, name) => ({ id, name, dmPct: SHEET_DM[id], costPerTon: null });
  const item = (ingredientId, dmLbsPerHead) => ({ ingredientId, dmLbsPerHead });
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
    // Dry-matter lb per head per day and feeding % from the nutritionist's
    // feeding sheets; items are in loading order.
    rations: [
      {
        id: 'holstein',
        name: 'Holstein Cows – 10/12/26',
        feedingPct: 50,
        items: [
          item('alf-z', 2.0), item('pvm', 7.6378), item('canola', 7.249),
          item('earlage', 7.021), item('grass', 10.558), item('cs-1010', 18.44),
        ],
      },
      {
        id: 'jersey',
        name: 'Mature Jerseys – 10/12/26',
        feedingPct: 100,
        items: [
          item('alf-z', 2.4), item('pvm', 8.0), item('canola', 4.5),
          item('earlage', 4.8), item('grass', 9.567), item('cs-1010', 13.08),
        ],
      },
      {
        id: 'jersey-1st',
        name: '1st Lact. Jerseys – 10/12/26',
        feedingPct: 100,
        items: [
          item('alf-z', 1.8), item('pvm', 8.0436), item('canola', 4.579),
          item('earlage', 5.673), item('grass', 8.077), item('cs-1010', 11.78),
        ],
      },
      {
        id: 'closeup',
        name: 'Closeups – 9/30/26',
        feedingPct: 200,
        items: [
          item('straw', 3.999), item('alf-zg', 3.599), item('zelit', 0.92984),
          item('cu-grain', 1.3905), item('canola', 3.014), item('earlage', 1.177),
          item('cs-0630', 9.878), item('molasses', 1.362),
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
  } else if (raw.seedVersion < 3) {
    // Rations were stored as as-fed lb. Give each ingredient its sheet DM %
    // (or 100% if it isn't one of ours) and convert the amounts to dry matter,
    // so every load comes out exactly as before.
    data.ingredients = raw.ingredients.map((i) => ({ ...i, dmPct: i.dmPct ?? SHEET_DM[i.id] ?? 100 }));
    const dmById = new Map(data.ingredients.map((i) => [i.id, i.dmPct]));
    data.rations = raw.rations.map((r) => ({
      ...r,
      items: r.items.map(({ lbsPerHead, ...it }) => ({
        ...it,
        dmLbsPerHead: it.dmLbsPerHead ?? (Number(lbsPerHead) || 0) * ((dmById.get(it.ingredientId) ?? 100) / 100),
      })),
    }));
    data.seedVersion = SEED_VERSION;
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
