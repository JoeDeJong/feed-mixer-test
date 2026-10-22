// Pure ration and loading logic (no DOM), so it can be unit tested.

export const sum = (values) => values.reduce((total, v) => total + (Number(v) || 0), 0);

// Cost of an amount at an as-fed $/ton price; null when there is no price.
export const itemCost = (lbs, costPerTon) =>
  costPerTon === null || costPerTon === undefined || costPerTon === '' ? null : (lbs * Number(costPerTon)) / 2000;

const priceOf = (ingredient) => {
  const p = ingredient?.costPerTon;
  return p === null || p === undefined || p === '' || !Number.isFinite(Number(p)) ? null : Number(p);
};

// Feed cost of a ration per head per day, from today's ingredient prices.
// `missing` lists ingredients with no price (their cost is left out).
export function rationCostPerHeadDay(ration, ingredients) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  let cost = 0;
  const missing = [];
  for (const it of ration.items) {
    if (!(Number(it.lbsPerHead) > 0)) continue;
    const ing = byId.get(it.ingredientId);
    const price = priceOf(ing);
    if (price === null) missing.push(ing?.name ?? '(deleted ingredient)');
    else cost += itemCost(it.lbsPerHead, price);
  }
  return { cost, missing };
}

export const newId = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Scale a ration to a batch, either by head count or by total batch weight.
// lbsPerHead is as-fed lb per head per day; ration.feedingPct is the share of
// the daily amount mixed in one load (50 = two loads a day, 200 = one load for
// two days). Targets are rounded to the nearest roundTo lb, like a feeding sheet.
// Returns one target per ingredient, in loading order.
export function batchTargets(ration, ingredients, { headCount = 0, totalLbs = 0, roundTo = 1 } = {}) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const items = ration.items.filter((it) => Number(it.lbsPerHead) > 0);
  const perHead = sum(items.map((it) => it.lbsPerHead));
  const share = (Number(ration.feedingPct) || 100) / 100;
  const factor = totalLbs > 0 ? (perHead ? totalLbs / perHead : 0) : (Number(headCount) || 0) * share;
  const step = Number(roundTo) > 0 ? Number(roundTo) : 1;
  return items.map((it) => ({
    ingredientId: it.ingredientId,
    name: byId.get(it.ingredientId)?.name ?? '(deleted ingredient)',
    target: Math.round((it.lbsPerHead * factor) / step) * step,
    costPerTon: priceOf(byId.get(it.ingredientId)),
  }));
}

// How far off an ingredient may be and still count as "on target".
export function tolerance(target, { tolerancePct = 2, toleranceMinLbs = 10 } = {}) {
  return Math.max((target * tolerancePct) / 100, toleranceMinLbs);
}

export function stepStatus(target, net, tol) {
  const diff = net - target;
  if (diff > tol) return 'over';
  if (diff >= -tol) return 'ok';
  return 'under';
}

// A loading session walks through the targets one ingredient at a time. Each
// step remembers the mixer's gross weight when it began, so the amount loaded
// for that ingredient is simply (current gross - start gross).
export function startSession({
  targets, startWeight, rationName, rationId = '', penName = '', penId = '', feedingPct = 100,
  headCount = 0, operator = '', operatorId = '', now = new Date(),
}) {
  return {
    id: newId(),
    rationName,
    rationId,
    penName,
    penId,
    feedingPct,
    headCount,
    operator,
    operatorId,
    startedAt: now.toISOString(),
    index: 0,
    steps: targets.map((t, i) => ({
      name: t.name,
      target: t.target,
      costPerTon: t.costPerTon ?? null,
      start: i === 0 ? startWeight : null,
      actual: null,
      skipped: false,
    })),
  };
}

export const currentStep = (session) => session.steps[session.index];

export const netLoaded = (session, weight) => weight - currentStep(session).start;

// Record the current step and move on. Returns true when every step is done.
export function advance(session, weight, { skip = false } = {}) {
  const step = currentStep(session);
  step.actual = Math.round(weight - step.start);
  step.skipped = skip;
  session.index += 1;
  if (session.index < session.steps.length) session.steps[session.index].start = weight;
  return session.index >= session.steps.length;
}

// Return to the previous ingredient (e.g. after tapping "Next" too early).
export function goBack(session) {
  if (session.index === 0) return;
  if (session.index < session.steps.length) session.steps[session.index].start = null;
  session.index -= 1;
  const step = currentStep(session);
  step.actual = null;
  step.skipped = false;
}

export function finishSession(session, now = new Date()) {
  const items = session.steps.map(({ name, target, actual, skipped, costPerTon = null }) => ({
    name,
    target,
    actual: actual ?? 0,
    skipped,
    costPerTon,
    cost: itemCost(actual ?? 0, costPerTon),
  }));
  const priced = items.filter((i) => i.cost !== null);
  return {
    id: session.id,
    startedAt: session.startedAt,
    finishedAt: now.toISOString(),
    rationName: session.rationName,
    rationId: session.rationId ?? '',
    penName: session.penName,
    penId: session.penId ?? '',
    feedingPct: session.feedingPct ?? 100,
    headCount: session.headCount,
    operator: session.operator,
    operatorId: session.operatorId ?? '',
    items,
    totalTarget: sum(items.map((i) => i.target)),
    totalActual: sum(items.map((i) => i.actual)),
    // Prices are copied into the load so later price changes don't rewrite history.
    totalCost: priced.length ? sum(priced.map((i) => i.cost)) : null,
    costComplete: priced.length === items.length,
  };
}
