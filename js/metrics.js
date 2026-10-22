// Dashboard figures computed from the load history (no DOM, unit tested).

import { stepStatus, sum, tolerance } from './calc.js';

// In display order (an array, since object keys like "7" would sort first).
export const PERIODS = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time']];

const DAY_MS = 86_400_000;

// Local calendar date, "YYYY-MM-DD".
export const dayKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

// First day included in a period ("today", "7", "30" or "all").
export function periodStart(period, loads, now = new Date()) {
  if (period === 'all') {
    const first = loads.reduce((min, l) => Math.min(min, Date.parse(l.startedAt)), now.getTime());
    return startOfDay(first);
  }
  const days = period === 'today' ? 1 : Number(period);
  const d = startOfDay(now);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

// Feed cost per head per day for one load, or null when it can't be known
// (no prices, or a load mixed by total weight with no head count).
export function costPerHeadDay(load) {
  if (load.totalCost === null || load.totalCost === undefined || !(load.headCount > 0)) return null;
  return load.totalCost / load.headCount / ((load.feedingPct || 100) / 100);
}

const avg = (values) => (values.length ? sum(values) / values.length : null);

function accuracyOf(items, tolOpts) {
  const loaded = items.filter((i) => !i.skipped);
  const onTarget = loaded.filter((i) => stepStatus(i.target, i.actual, tolerance(i.target, tolOpts)) === 'ok');
  const targetLbs = sum(loaded.map((i) => i.target));
  return {
    accuracyPct: loaded.length ? (onTarget.length / loaded.length) * 100 : null,
    // Average miss, as a share of what should have gone in.
    deviationPct: targetLbs ? (sum(loaded.map((i) => Math.abs(i.actual - i.target))) / targetLbs) * 100 : null,
  };
}

function groupBy(list, keyOf) {
  const groups = new Map();
  for (const x of list) {
    const k = keyOf(x);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  return groups;
}

const loadCost = (loads) => {
  const priced = loads.filter((l) => l.totalCost !== null && l.totalCost !== undefined);
  return priced.length ? sum(priced.map((l) => l.totalCost)) : null;
};

export function summarize(allLoads, { period = '7', tolOpts = {}, now = new Date() } = {}) {
  const from = periodStart(period, allLoads, now);
  const loads = allLoads.filter((l) => Date.parse(l.startedAt) >= from.getTime());
  const items = loads.flatMap((l) => l.items.map((i) => ({ ...i, load: l })));

  const byGroup = [...groupBy(loads, (l) => l.penName || l.rationName)].map(([name, ls]) => ({
    name,
    loads: ls.length,
    lbs: sum(ls.map((l) => l.totalActual)),
    cost: loadCost(ls),
    costPerHeadDay: avg(ls.map(costPerHeadDay).filter((v) => v !== null)),
    ...accuracyOf(ls.flatMap((l) => l.items), tolOpts),
  }));

  const byIngredient = [...groupBy(items, (i) => i.name)].map(([name, is]) => {
    const loaded = is.filter((i) => !i.skipped);
    const priced = is.filter((i) => i.cost !== null && i.cost !== undefined);
    return {
      name,
      target: sum(loaded.map((i) => i.target)),
      actual: sum(loaded.map((i) => i.actual)),
      cost: priced.length ? sum(priced.map((i) => i.cost)) : null,
      skipped: is.length - loaded.length,
    };
  }).sort((a, b) => b.actual - a.actual);

  const byOperator = [...groupBy(loads, (l) => l.operator || '(not recorded)')].map(([name, ls]) => ({
    name,
    loads: ls.length,
    lbs: sum(ls.map((l) => l.totalActual)),
    ...accuracyOf(ls.flatMap((l) => l.items), tolOpts),
  })).sort((a, b) => b.loads - a.loads);

  // One entry per calendar day for the trend chart: the period itself, but at
  // least a week so a single day still has context, and at most 90 days.
  const chartDays = Math.min(90, Math.max(7, Math.round((startOfDay(now) - from) / DAY_MS) + 1));
  const chartFrom = startOfDay(now);
  chartFrom.setDate(chartFrom.getDate() - (chartDays - 1));
  const perDay = groupBy(allLoads.filter((l) => Date.parse(l.startedAt) >= chartFrom.getTime()), (l) => dayKey(l.startedAt));
  const daily = Array.from({ length: chartDays }, (_, k) => {
    const d = new Date(chartFrom);
    d.setDate(d.getDate() + k);
    const ls = perDay.get(dayKey(d)) ?? [];
    return { date: dayKey(d), loads: ls.length, lbs: sum(ls.map((l) => l.totalActual)), cost: loadCost(ls) };
  });

  return {
    from: dayKey(from),
    loads: loads.length,
    lbs: sum(loads.map((l) => l.totalActual)),
    targetLbs: sum(loads.map((l) => l.totalTarget)),
    cost: loadCost(loads),
    unpricedLoads: loads.filter((l) => l.totalCost === null || l.totalCost === undefined || l.costComplete === false).length,
    skipped: items.filter((i) => i.skipped).length,
    ...accuracyOf(items, tolOpts),
    byGroup: byGroup.sort((a, b) => b.lbs - a.lbs),
    byIngredient,
    byOperator,
    daily,
  };
}
