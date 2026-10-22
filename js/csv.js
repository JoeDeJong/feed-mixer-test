const HEADER = [
  'started', 'finished', 'operator', 'pen', 'ration', 'head_count',
  'ingredient', 'target_lb', 'actual_lb', 'diff_lb', 'skipped', 'cost_per_ton', 'cost_usd',
];

const cell = (value) => {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// One row per ingredient per load, ready for Excel / Google Sheets.
export function loadsToCsv(loads) {
  const rows = [HEADER];
  for (const load of loads) {
    for (const item of load.items) {
      rows.push([
        load.startedAt, load.finishedAt, load.operator, load.penName, load.rationName,
        load.headCount, item.name, item.target, item.actual, item.actual - item.target,
        item.skipped ? 'yes' : '',
        item.costPerTon ?? '', item.cost == null ? '' : item.cost.toFixed(2),
      ]);
    }
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
