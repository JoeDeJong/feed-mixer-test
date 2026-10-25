import * as store from './store.js';
import {
  advance, asFedLbs, batchTargets, currentStep, dmLbs, dmPctOf, finishSession, goBack, itemAsFed,
  itemCost, netLoaded, newId, rationCostPerHeadDay, rationTotals, startSession, stepStatus, sum, tolerance,
} from './calc.js';
import { icon } from './icons.js';
import { PERIODS, summarize } from './metrics.js';
import { loadsToCsv } from './csv.js';
import { SCALE_TYPES, ScaleConnection } from './scale.js';
import {
  Attempts, ROLES, checkPin, createUser, isManager, managerCount, pinProblem, setPin,
} from './users.js';

let data = store.load();
const scale = new ScaleConnection();
const app = document.getElementById('app');

const persist = () => store.save(data);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
const num = (v) => (Number.isFinite(Number.parseFloat(v)) ? Number.parseFloat(v) : 0);
const byId = (list, id) => list.find((x) => x.id === id);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (n, whole = false) => (n === null || n === undefined ? '—' : (whole ? usd0 : usd).format(n));
const pct = (n) => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);
let currentRoute = 'home';
const route = () => currentRoute;

// Signed-in user. Not saved, so reopening the app always asks for a PIN.
let user = null;
const attempts = new Attempts();
const pinEntry = { userId: null, digits: '', error: '' };
let lastActivity = Date.now();
const MANAGER_ROUTES = new Set(['dashboard', 'rations', 'ingredients', 'pens', 'settings', 'users']);

// Dashboard choices; kept for the session only.
const dash = { period: '7', metric: 'cost' };

// Where the app may go right now: first-time setup, PIN screen, or the
// requested screen if this user is allowed to see it.
function allowedRoute(r) {
  if (!data.users.length) return 'setup';
  if (!user) return 'login';
  if (!views[r] || r === 'login' || r === 'setup') return 'home';
  if (MANAGER_ROUTES.has(r) && !isManager(user)) return 'home';
  return r;
}

function go(r) {
  currentRoute = views[r] ? r : 'home';
  render();
  window.scrollTo(0, 0);
}

// In-page replacement for alert/confirm/prompt, which some browsers and
// embedded views block. Resolves to true (or the typed text) on OK, null on cancel.
function ask(message, { ok = 'OK', cancel = 'Cancel', danger = false, input = null, secret = false } = {}) {
  const modal = document.getElementById('modal');
  const field = document.getElementById('modal-input');
  const okBtn = document.getElementById('modal-ok');
  const cancelBtn = document.getElementById('modal-cancel');
  document.getElementById('modal-msg').textContent = message;
  okBtn.textContent = ok;
  okBtn.classList.toggle('danger-fill', danger);
  cancelBtn.textContent = cancel ?? '';
  cancelBtn.hidden = cancel === null;
  field.hidden = input === null;
  field.type = secret ? 'password' : 'number';
  field.value = input ?? '';
  modal.hidden = false;
  (input === null ? okBtn : field).focus();
  return new Promise((resolve) => {
    const close = (result) => {
      modal.hidden = true;
      okBtn.onclick = cancelBtn.onclick = field.onkeydown = null;
      resolve(result);
    };
    okBtn.onclick = () => close(input === null ? true : field.value);
    cancelBtn.onclick = () => close(null);
    field.onkeydown = (e) => { if (e.key === 'Enter') okBtn.onclick(); };
  });
}

const notify = (message) => ask(message, { cancel: null });

// The "start a load" form; not saved, but pre-filled from the first pen.
const draft = { penId: data.pens[0]?.id ?? '', rationId: '', mode: 'head', headCount: 0, totalLbs: 0 };
applyPen(draft.penId);

function applyPen(penId) {
  const pen = byId(data.pens, penId);
  draft.penId = pen ? pen.id : '';
  if (pen) {
    draft.rationId = pen.rationId;
    draft.headCount = pen.headCount;
  }
  if (!byId(data.rations, draft.rationId)) draft.rationId = data.rations[0]?.id ?? '';
}

function draftTargets() {
  const ration = byId(data.rations, draft.rationId);
  if (!ration) return [];
  return batchTargets(ration, data.ingredients, draft.mode === 'total'
    ? { totalLbs: num(draft.totalLbs), roundTo: num(data.settings.roundToLbs) }
    : { headCount: num(draft.headCount), roundTo: num(data.settings.roundToLbs) });
}

const options = (list, selectedId, label = (x) => x.name) =>
  list.map((x) => `<option value="${esc(x.id)}" ${x.id === selectedId ? 'selected' : ''}>${esc(label(x))}</option>`).join('');

// ---------------------------------------------------------------- views

const pinField = (id, label) =>
  `<label>${label}<input id="${id}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"></label>`;

const roleOptions = (selected) =>
  Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${v}</option>`).join('');

const pageHead = (title, desc = '', actions = '') => `
  <div class="page-head">
    <div class="page-title"><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </div>`;

// Number input with its unit shown inside the box ("lb", "%", "$/ton").
const unitInput = (attrs, unit, value) =>
  `<span class="unit-input"><input type="number" ${attrs} value="${esc(value ?? '')}"><span class="unit">${unit}</span></span>`;

const iconBtn = (name, action, attrs = '', label = '', extra = '') =>
  `<button class="icon-btn ${extra}" data-action="${action}" ${attrs} aria-label="${label}" title="${label}">${icon(name, 18)}</button>`;

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const avatar = (name, big = false) => `<span class="avatar ${big ? 'lg' : ''}">${esc(initials(name))}</span>`;
const brandMark = () => `<span class="brand-mark">${icon('mixer', 22)}</span>`;

const fmt2 = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
// Value for an editable amount: up to 4 decimals, no trailing zeros.
const amount = (n) => String(Math.round(n * 10000) / 10000);

const views = {
  setup() {
    return `
      <div class="auth">
        <div class="auth-brand">${brandMark()}<span>Feed Mixer</span></div>
        <div class="card">
          <h1 class="auth-title">Set up the first manager</h1>
          <p class="hint">Managers add users and change rations, ingredients, pens and settings. Operators load and see history. You can add more people after this.</p>
          <div class="form">
            <label>Name<input id="setup-name" autocomplete="off"></label>
            ${pinField('setup-pin', 'PIN (4–6 digits)')}
            ${pinField('setup-pin2', 'PIN again')}
          </div>
          <button class="btn primary block lg" data-action="create-first">Create manager</button>
        </div>
      </div>`;
  },

  login() {
    const sel = byId(data.users, pinEntry.userId) ?? (data.users.length === 1 ? data.users[0] : null);
    if (!sel) {
      return `
        <div class="auth">
          <div class="auth-brand">${brandMark()}<span>Feed Mixer</span></div>
          <div class="card">
            <h1 class="auth-title">Who is loading?</h1>
            <div class="user-list">
              ${data.users.map((u) => `<button class="user-tile" data-action="pick-user" data-id="${u.id}">
                ${avatar(u.name)}<span><b>${esc(u.name)}</b><small>${ROLES[u.role]}</small></span>${icon('next', 18)}</button>`).join('')}
            </div>
          </div>
        </div>`;
    }
    pinEntry.userId = sel.id;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    return `
      <div class="auth">
        <div class="card pin-card">
          ${avatar(sel.name, true)}
          <h1 class="auth-title">${esc(sel.name)}</h1>
          <p class="hint">Enter your PIN</p>
          <div class="pin-dots" data-live="pin-dots">${pinDots()}</div>
          <p class="pin-msg" data-live="pin-msg">${esc(pinEntry.error)}</p>
          <div class="keypad">
            ${keys.map((k) => `<button class="key" data-action="pin-key" data-key="${k}">${k}</button>`).join('')}
            <button class="key" data-action="pin-back" aria-label="Delete digit">${icon('backspace', 26)}</button>
            <button class="key" data-action="pin-key" data-key="0">0</button>
            <button class="key primary" data-action="pin-ok">OK</button>
          </div>
          ${data.users.length > 1 ? `<button class="btn ghost" data-action="pick-user" data-id="">Not ${esc(sel.name)}? Switch user</button>` : ''}
        </div>
      </div>`;
  },

  users() {
    return `${pageHead('Users', 'Everyone signs in with their own PIN. Managers can change rations, ingredients, pens and settings; operators load and see history.')}
      <div class="card flush">
        <table class="users-table">
          <thead><tr><th>Name</th><th>Role</th><th class="actions-col"></th></tr></thead>
          <tbody>
            ${data.users.map((u) => `<tr>
              <td><div class="name-cell">${avatar(u.name)}<input data-field="user.name" data-id="${u.id}" value="${esc(u.name)}" aria-label="Name">${u.id === user.id ? '<span class="badge">You</span>' : ''}</div></td>
              <td><select data-field="user.role" data-id="${u.id}" aria-label="Role">${roleOptions(u.role)}</select></td>
              <td class="actions-col">
                <button class="btn small" data-action="change-pin" data-id="${u.id}">${icon('key', 16)}Change PIN</button>
                ${iconBtn('trash', 'del-user', `data-id="${u.id}" ${u.id === user.id ? 'disabled' : ''}`, `Delete ${esc(u.name)}`, 'danger')}
              </td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h2 class="card-title">Add a user</h2>
        <div class="form cols-3">
          <label>Name<input id="new-user-name" autocomplete="off"></label>
          ${pinField('new-user-pin', 'PIN (4–6 digits)')}
          <label>Role<select id="new-user-role">${roleOptions('operator')}</select></label>
        </div>
        <button class="btn primary" data-action="add-user">${icon('plus', 18)}Add user</button>
      </div>`;
  },

  home() {
    if (data.activeLoad) {
      const s = data.activeLoad;
      return `
        ${pageHead('Load in progress')}
        <div class="card callout">
          <div class="callout-icon">${icon('load', 24)}</div>
          <div class="grow">
            <b>${esc(s.rationName)}${s.penName ? ` · ${esc(s.penName)}` : ''}</b>
            <p class="hint">Ingredient ${s.index + 1} of ${s.steps.length}: ${esc(currentStep(s).name)}</p>
          </div>
        </div>
        <div class="row">
          <a class="btn primary lg" href="#" data-go="loading">Resume load</a>
          <button class="btn ghost danger" data-action="cancel-load">Discard load</button>
        </div>`;
    }
    if (!data.rations.length) {
      return `${pageHead('Start a load')}<div class="card empty"><p>No rations yet. Create a ration first.</p><a class="btn primary" href="#" data-go="rations">Go to rations</a></div>`;
    }
    return `
      ${pageHead('Start a load', 'Pick the pen, check the amounts, then start loading.')}
      <div class="card">
        <div class="form cols-2">
          <label>Pen
            <select data-draft="penId"><option value="">— No pen —</option>${options(data.pens, draft.penId, (p) => `${p.name} (${p.headCount} hd)`)}</select>
          </label>
          <label>Ration
            <select data-draft="rationId">${options(data.rations, draft.rationId)}</select>
          </label>
        </div>
        <div class="form cols-2">
          <div class="segmented" role="group" aria-label="Size the load">
            <button class="${draft.mode === 'head' ? 'on' : ''}" data-action="mode" data-mode="head">By head count</button>
            <button class="${draft.mode === 'total' ? 'on' : ''}" data-action="mode" data-mode="total">By total weight</button>
          </div>
          ${draft.mode === 'head'
            ? unitInput(`inputmode="numeric" min="0" data-draft="headCount" aria-label="Head count"`, 'head', draft.headCount)
            : unitInput(`inputmode="numeric" min="0" step="100" data-draft="totalLbs" aria-label="Total batch weight"`, 'lb', draft.totalLbs)}
        </div>
      </div>
      <div id="preview">${previewTable()}</div>`;
  },

  loading() {
    const s = data.activeLoad;
    if (!s) return `<div class="card empty"><p>No load in progress.</p><a class="btn primary" href="#" data-go="home">Start a load</a></div>`;
    const step = currentStep(s);
    const next = s.steps[s.index + 1];
    const manual = scale.type === 'manual';
    return `
      <section class="loading" id="loadview">
        <div class="step-meta"><span class="step-count">${s.index + 1} / ${s.steps.length}</span><span>${esc(s.rationName)}${s.penName ? ` · ${esc(s.penName)}` : ''}${s.headCount ? ` · ${s.headCount} hd` : ''}</span></div>
        <h1 class="ing-name">${esc(step.name)}</h1>
        <p class="scale-warn off" data-live="scale-warn">&nbsp;</p>
        <div class="remaining"><span data-live="remaining">—</span><small data-live="remaining-label">lb to go</small></div>
        <div class="bar"><div class="fill" data-live="bar"></div><div class="target-mark"></div></div>
        <div class="stats">
          <div><span>Target</span><b>${fmt(step.target)}</b></div>
          <div><span>Loaded</span><b data-live="net">—</b></div>
          <div><span>In mixer</span><b data-live="gross">—</b></div>
        </div>
        ${manual ? `<label class="manual">Mixer scale reading
          ${unitInput('inputmode="numeric" data-manual', 'lb', scale.weight ?? '')}</label>` : ''}
        ${scale.simulator ? `<button class="btn" data-action="sim-bucket">${icon('bucket', 18)}Simulate a bucket</button>` : ''}
        <button class="btn primary huge" data-action="next">${icon('check', 30)}<span>${next ? `Done<small>Next: ${esc(next.name)}</small>` : 'Finish load'}</span></button>
        <div class="load-actions">
          <button class="btn" data-action="back" ${s.index === 0 ? 'disabled' : ''}>${icon('back', 18)}Back</button>
          <button class="btn" data-action="skip">${icon('skip', 18)}Skip</button>
          <button class="btn ghost danger" data-action="cancel-load">Cancel load</button>
        </div>
        <ol class="steps">
          ${s.steps.map((st, i) => `<li class="${i < s.index ? 'done' : i === s.index ? 'current' : ''}${st.skipped ? ' skipped' : ''}">
            <span class="step-dot">${i < s.index ? icon(st.skipped ? 'skip' : 'check', 14) : i + 1}</span>
            <span class="step-name">${esc(st.name)}</span>
            <span class="step-val">${i < s.index ? (st.skipped ? 'skipped' : `${fmt(st.actual)} / `) : ''}${st.skipped ? '' : `${fmt(st.target)} lb`}</span></li>`).join('')}
        </ol>
      </section>`;
  },

  done() {
    const load = data.loads[0];
    if (!load) return views.home();
    return `
      ${pageHead('Load complete', `${esc(load.rationName)}${load.penName ? ` · ${esc(load.penName)}` : ''}`)}
      <div class="card">${loadDetail(load)}</div>
      <a class="btn primary lg" href="#" data-go="home">${icon('plus', 20)}Start another load</a>`;
  },

  rations() {
    return `${pageHead('Rations',
      '<b>Dry matter</b> is the feed without its water: what each cow gets per day, as set by the nutritionist (“DM lbs/day” on the feeding sheet). <b>As fed</b> is the wet weight you load: dry matter ÷ the ingredient’s dry matter % from the Ingredients tab. Type either one and the other follows. Ingredients load in the order listed.',
      `<button class="btn primary" data-action="add-ration">${icon('plus', 18)}New ration</button>`)}
      ${data.rations.map((r) => `
        <div class="card ration-card">
          <div class="card-head">
            <input class="title-input" data-field="ration.name" data-id="${r.id}" value="${esc(r.name)}" aria-label="Ration name">
            ${iconBtn('trash', 'del-ration', `data-id="${r.id}"`, `Delete ${esc(r.name)}`, 'danger')}
          </div>
          <div class="feeding-pct">Each load is
            ${unitInput(`inputmode="decimal" min="1" step="any" data-field="ration.feedingPct" data-id="${r.id}" aria-label="Percent of the daily amount per load"`, '%', r.feedingPct ?? 100)}
            of the daily amount</div>
          <table class="ration-table">
            <thead><tr><th class="idx">#</th><th>Ingredient</th><th class="num">Dry matter<small>lb per cow per day</small></th><th class="num">As fed<small>lb per cow per day</small></th><th class="actions-col"></th></tr></thead>
            <tbody>
              ${r.items.map((it, idx) => {
                const ing = byId(data.ingredients, it.ingredientId);
                return `<tr>
                <td class="idx">${idx + 1}</td>
                <td class="ing"><select data-field="item.ingredient" data-id="${r.id}" data-idx="${idx}" aria-label="Ingredient">${options(data.ingredients, it.ingredientId)}</select></td>
                <td class="num dm"><span class="cell-label">Dry matter</span>${unitInput(`inputmode="decimal" min="0" step="any" data-field="item.dm" data-id="${r.id}" data-idx="${idx}" aria-label="Dry matter, lb per cow per day"`, 'lb', amount(it.dmLbsPerHead))}</td>
                <td class="num af"><span class="cell-label">As fed</span>${unitInput(`inputmode="decimal" min="0" step="any" data-field="item.af" data-id="${r.id}" data-idx="${idx}" aria-label="As fed, lb per cow per day"`, 'lb', fmt2(itemAsFed(it, ing)).replace(/,/g, ''))}</td>
                <td class="actions-col">
                  ${iconBtn('up', 'item-up', `data-id="${r.id}" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}`, 'Move up')}
                  ${iconBtn('down', 'item-down', `data-id="${r.id}" data-idx="${idx}" ${idx === r.items.length - 1 ? 'disabled' : ''}`, 'Move down')}
                  ${iconBtn('trash', 'item-del', `data-id="${r.id}" data-idx="${idx}"`, 'Remove ingredient', 'danger')}
                </td></tr>`;
              }).join('')}
            </tbody>
            <tfoot><tr><td class="idx"></td><td>Total per cow per day</td>
              <td class="num dm"><span class="cell-label">Dry matter intake</span><span><span data-total-dm="${r.id}">${fmt2(rationTotals(r, data.ingredients).dm)}</span> <small>lb</small></span></td>
              <td class="num af"><span class="cell-label">As fed</span><span><span data-total-af="${r.id}">${fmt2(rationTotals(r, data.ingredients).asFed)}</span> <small>lb</small></span></td><td class="actions-col"></td></tr></tfoot>
          </table>
          <div class="card-foot">
            <button class="btn ghost" data-action="item-add" data-id="${r.id}" ${data.ingredients.length ? '' : 'disabled'}>${icon('plus', 18)}Add ingredient</button>
            <span class="ration-cost" data-ration-cost="${r.id}">${rationCostText(r)}</span>
          </div>
        </div>`).join('')}`;
  },

  ingredients() {
    const usedIn = (id) => data.rations.filter((r) => r.items.some((i) => i.ingredientId === id)).map((r) => r.name.split(' – ')[0]);
    return `${pageHead('Ingredients',
      'Dry matter % and as-fed price per ton (2,000 lb). When you change a DM %, the as-fed pounds in every ration adjust so the cows get the same dry matter. Loads keep the price they were mixed at.',
      `<button class="btn primary" data-action="add-ingredient">${icon('plus', 18)}New ingredient</button>`)}
      <div class="card flush">
        <table class="ingredients-table">
          <thead><tr><th>Ingredient</th><th class="num">Dry matter %</th><th class="num">Price (as fed)</th><th class="actions-col"></th></tr></thead>
          <tbody>
          ${data.ingredients.map((i) => {
            const used = usedIn(i.id);
            return `<tr>
            <td class="ing"><input data-field="ingredient.name" data-id="${i.id}" value="${esc(i.name)}" aria-label="Ingredient name">
              <small class="used-in">${used.length ? `Used in ${esc(used.join(', '))}` : 'Not used in a ration'}</small></td>
            <td class="num dm">${unitInput(`inputmode="decimal" min="1" max="100" step="any" data-field="ingredient.dmPct" data-id="${i.id}" aria-label="Dry matter percent"`, '% DM', i.dmPct ?? '')}</td>
            <td class="num price">${unitInput(`inputmode="decimal" min="0" step="any" placeholder="—" data-field="ingredient.costPerTon" data-id="${i.id}" aria-label="Price, dollars per ton as fed"`, '$/ton', i.costPerTon ?? '')}</td>
            <td class="actions-col">${iconBtn('trash', 'del-ingredient', `data-id="${i.id}"`, `Delete ${esc(i.name)}`, 'danger')}</td>
          </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`;
  },

  pens() {
    return `${pageHead('Pens', 'Each pen or group has a head count and the ration it’s fed.',
      `<button class="btn primary" data-action="add-pen">${icon('plus', 18)}New pen</button>`)}
      <div class="card flush">
        <table class="pens-table">
          <thead><tr><th>Name</th><th class="num">Head</th><th>Ration</th><th class="actions-col"></th></tr></thead>
          <tbody>
            ${data.pens.map((p) => `<tr>
              <td class="name"><input data-field="pen.name" data-id="${p.id}" value="${esc(p.name)}" aria-label="Pen name"></td>
              <td class="num head">${unitInput(`inputmode="numeric" min="0" data-field="pen.headCount" data-id="${p.id}" aria-label="Head count"`, 'hd', p.headCount)}</td>
              <td class="ration"><select data-field="pen.rationId" data-id="${p.id}" aria-label="Ration">${options(data.rations, p.rationId)}</select></td>
              <td class="actions-col">${iconBtn('trash', 'del-pen', `data-id="${p.id}"`, `Delete ${esc(p.name)}`, 'danger')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  },

  dashboard() {
    const m = summarize(data.loads, { period: dash.period, tolOpts: data.settings });
    const perTon = m.cost !== null && m.lbs > 0 ? m.cost / (m.lbs / 2000) : null;
    const tile = (label, value, sub = '') =>
      `<div class="tile"><span class="tile-label">${label}</span><b class="tile-value">${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const accClass = (a) => (a === null ? '' : a >= 90 ? 'good' : a >= 75 ? 'fair' : 'poor');
    const pill = (a) => `<span class="pill ${accClass(a)}">${pct(a)}</span>`;
    const section = (title, body) => `<div class="card flush"><h2 class="card-title">${title}</h2><div class="table-scroll">${body}</div></div>`;
    return `
      ${pageHead('Dashboard', m.loads ? `${fmt(m.loads)} load${m.loads === 1 ? '' : 's'} since ${shortDate(m.from)}` : '',
        `<div class="segmented" role="group" aria-label="Period">${PERIODS.map(([k, v]) =>
          `<button class="${dash.period === k ? 'on' : ''}" data-action="dash-period" data-period="${k}">${v}</button>`).join('')}</div>`)}
      ${m.loads ? '' : `<div class="card empty"><p>No loads ${dash.period === 'all' ? 'yet' : 'in this period'}. Figures appear here as loads are finished.</p></div>`}
      <div class="tiles">
        ${tile('Feed cost', money(m.cost, true), perTon !== null ? `${money(perTon)} per ton fed` : 'Add prices under Ingredients')}
        ${tile('Feed mixed', `${fmt(m.lbs)}<span class="tile-unit">lb</span>`, `${signed(m.lbs - m.targetLbs)} lb vs target`)}
        ${tile('Loads', fmt(m.loads), m.skipped ? `${m.skipped} ingredient${m.skipped === 1 ? '' : 's'} skipped` : 'None skipped')}
        ${tile('On target', pill(m.accuracyPct), `Average miss ${m.deviationPct === null ? '—' : `${m.deviationPct.toFixed(1)}%`}`)}
      </div>
      ${m.unpricedLoads ? `<p class="hint">${m.unpricedLoads} load${m.unpricedLoads === 1 ? ' was' : 's were'} mixed with ingredients that had no price, so their cost is incomplete.</p>` : ''}

      <div class="card">
        <div class="card-head">
          <h2 class="card-title">${dash.metric === 'cost' ? 'Feed cost per day' : 'Feed mixed per day (lb)'}</h2>
          <div class="segmented small" role="group" aria-label="Chart measure">
            <button class="${dash.metric === 'cost' ? 'on' : ''}" data-action="dash-metric" data-metric="cost">Cost</button>
            <button class="${dash.metric === 'lbs' ? 'on' : ''}" data-action="dash-metric" data-metric="lbs">Pounds</button>
          </div>
        </div>
        ${trendChart(m.daily, dash.metric)}
      </div>

      ${section('By group', `<table>
          <thead><tr><th>Group</th><th class="num">Loads</th><th class="num">Lb mixed</th><th class="num">Cost</th><th class="num">$ / head / day</th><th class="num">On target</th></tr></thead>
          <tbody>${m.byGroup.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${g.loads}</td><td class="num">${fmt(g.lbs)}</td>
            <td class="num">${money(g.cost, true)}</td><td class="num">${money(g.costPerHeadDay)}</td><td class="num">${pill(g.accuracyPct)}</td></tr>`).join('') || emptyRow(6)}</tbody>
        </table>`)}

      ${section('By ingredient', `<table>
          <thead><tr><th>Ingredient</th><th class="num">Target lb</th><th class="num">Actual lb</th><th class="num">Difference</th><th class="num">Cost</th></tr></thead>
          <tbody>${m.byIngredient.map((i) => `<tr><td>${esc(i.name)}${i.skipped ? ` <small class="muted">(${i.skipped} skipped)</small>` : ''}</td>
            <td class="num">${fmt(i.target)}</td><td class="num">${fmt(i.actual)}</td>
            <td class="num ${diffClass(i.actual - i.target, i.target)}">${signed(i.actual - i.target)}${i.target ? ` <small>(${signedPct((i.actual - i.target) / i.target * 100)})</small>` : ''}</td>
            <td class="num">${money(i.cost, true)}</td></tr>`).join('') || emptyRow(5)}</tbody>
        </table>`)}

      ${section('By operator', `<table>
          <thead><tr><th>Operator</th><th class="num">Loads</th><th class="num">Lb mixed</th><th class="num">On target</th><th class="num">Average miss</th></tr></thead>
          <tbody>${m.byOperator.map((o) => `<tr><td>${esc(o.name)}</td><td class="num">${o.loads}</td><td class="num">${fmt(o.lbs)}</td>
            <td class="num">${pill(o.accuracyPct)}</td><td class="num">${o.deviationPct === null ? '—' : `${o.deviationPct.toFixed(1)}%`}</td></tr>`).join('') || emptyRow(5)}</tbody>
        </table>`)}
      <p class="hint">“On target” counts ingredients within ±${data.settings.tolerancePct}% or ±${data.settings.toleranceMinLbs} lb, whichever is larger (change in Settings). Skipped ingredients aren’t counted.</p>`;
  },

  history() {
    const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${pageHead('History', data.loads.length ? `${fmt(data.loads.length)} load${data.loads.length === 1 ? '' : 's'} on this device` : '',
      `<button class="btn" data-action="export-csv" ${data.loads.length ? '' : 'disabled'}>${icon('download', 18)}Export CSV</button>
       ${isManager(user) ? `<button class="btn ghost danger" data-action="clear-history" ${data.loads.length ? '' : 'disabled'}>Clear history</button>` : ''}`)}
      ${data.loads.length ? '' : '<div class="card empty"><p>No loads recorded yet. Finished loads appear here.</p></div>'}
      <div class="history-list">
      ${data.loads.map((l) => `
        <details class="history-item">
          <summary>
            <span class="h-date"><b>${esc(day(l.startedAt))}</b><small>${esc(time(l.startedAt))}</small></span>
            <span class="h-main"><b>${esc(l.penName || l.rationName)}</b><small>${esc(l.rationName)}${l.operator ? ` · ${esc(l.operator)}` : ''}</small></span>
            <span class="h-figs"><span class="${diffClass(l.totalActual - l.totalTarget, l.totalTarget)}">${fmt(l.totalActual)} lb</span><small>${l.totalCost != null ? money(l.totalCost) : `of ${fmt(l.totalTarget)} lb`}</small></span>
            <span class="h-chev">${icon('down', 18)}</span>
          </summary>
          <div class="h-body">${loadDetail(l)}</div>
        </details>`).join('')}
      </div>`;
  },

  settings() {
    const st = data.settings;
    const field = (key, label, type = 'text', extra = '') =>
      `<label>${label}<input type="${type}" data-field="setting.${key}" value="${esc(st[key])}" ${extra}></label>`;
    const unitField = (key, label, unit, extra = '') =>
      `<label>${label}${unitInput(`data-field="setting.${key}" ${extra}`, unit, st[key])}</label>`;
    return `${pageHead('Settings')}
      <div class="card">
        <div class="card-head">
          <h2 class="card-title">Scale connection</h2>
          <span class="status-line"><span class="dot ${scale.status}"></span><span data-live="status-text">${esc(statusText())}</span></span>
        </div>
        <div class="form cols-2">
          <label>Connection type
            <select data-field="setting.scaleType">${Object.entries(SCALE_TYPES).map(([k, v]) => `<option value="${k}" ${k === st.scaleType ? 'selected' : ''}>${v}</option>`).join('')}</select>
          </label>
          ${st.scaleType === 'serial' ? field('serialBaud', 'Baud rate', 'number', 'inputmode="numeric"') : ''}
          ${st.scaleType === 'bluetooth' ? field('bleService', 'BLE service UUID') + field('bleCharacteristic', 'BLE notify characteristic UUID') : ''}
          ${st.scaleType === 'websocket' ? field('wsUrl', 'Bridge address (ws://…)') : ''}
          ${['serial', 'bluetooth', 'websocket'].includes(st.scaleType) ? `
            ${field('parserPattern', 'Weight pattern (regex, optional)', 'text', 'placeholder="Default: first number on each line" autocapitalize="off" spellcheck="false"')}
            ${field('parserDivisor', 'Divide reading by', 'number', 'min="0" step="any"')}` : ''}
        </div>
        ${st.scaleType === 'bluetooth' ? `<div class="row">
          <button class="btn small" data-action="ble-preset" data-preset="nus">Nordic UART preset</button>
          <button class="btn small" data-action="ble-preset" data-preset="hm10">HM-10 preset</button></div>` : ''}
        <div class="row">
          <button class="btn primary" data-action="connect">Connect</button>
          <button class="btn" data-action="disconnect">Disconnect</button>
          ${scale.simulator ? `<button class="btn ghost" data-action="sim-empty">Empty simulated mixer</button>` : ''}
        </div>
        ${['serial', 'bluetooth', 'websocket'].includes(st.scaleType) ? `
          <p class="hint">Raw data from the scale. Use this to check the weight is read correctly.</p>
          <pre class="rawlog" data-live="rawlog">${esc(scale.recentLines.join('\n')) || '(nothing received yet)'}</pre>
          <p>Reading: <b data-live="gross">—</b> lb</p>` : ''}
      </div>
      <div class="card">
        <h2 class="card-title">Loading</h2>
        <div class="form cols-2">
          ${unitField('tolerancePct', 'On-target tolerance', '%', 'min="0" step="0.5"')}
          ${unitField('toleranceMinLbs', 'Minimum tolerance', 'lb', 'min="0"')}
          ${unitField('mixerCapacityLbs', 'Mixer capacity', 'lb', 'min="0" step="100"')}
          ${unitField('roundToLbs', 'Round load amounts to nearest', 'lb', 'min="1" step="1"')}
          ${unitField('autoLockMinutes', 'Lock after idle (0 = never)', 'min', 'min="0" step="1"')}
          <label class="check"><input type="checkbox" data-field="setting.beep" ${st.beep ? 'checked' : ''}> Beep when on target</label>
        </div>
      </div>
      <div class="card">
        <h2 class="card-title">Backup</h2>
        <p class="hint">Data is stored only on this device. Save a backup now and then.</p>
        <div class="row">
          <button class="btn" data-action="backup">${icon('download', 18)}Download backup</button>
          <label class="btn">${icon('upload', 18)}Restore backup<input type="file" accept="application/json,.json" data-restore hidden></label>
        </div>
      </div>`;
  },
};

function rationCostText(r) {
  const { cost, missing } = rationCostPerHeadDay(r, data.ingredients);
  if (missing.length === r.items.filter((i) => i.dmLbsPerHead > 0).length) return 'Add prices under Ingredients to see feed cost';
  return `<b>${money(cost)}</b> per head per day${missing.length ? ` <span class="muted">(no price yet for ${esc(missing.join(', '))})</span>` : ''}`;
}

function previewTable() {
  const targets = draftTargets();
  const total = sum(targets.map((t) => t.target));
  const cap = num(data.settings.mixerCapacityLbs);
  const costs = targets.map((t) => itemCost(t.target, t.costPerTon));
  const priced = costs.filter((c) => c !== null);
  const totalCost = priced.length ? sum(priced) : null;
  const ration = byId(data.rations, draft.rationId);
  const head = draft.mode === 'head' ? num(draft.headCount) : 0;
  const perHeadDay = totalCost !== null && head > 0 ? totalCost / head / ((ration?.feedingPct ?? 100) / 100) : null;
  return `
    <div class="card flush">
      <div class="card-head padded">
        <h2 class="card-title">Load plan</h2>
        <span class="summary-figs"><b>${fmt(total)} lb</b>${totalCost !== null ? `<span>${money(totalCost)}${perHeadDay !== null ? ` · ${money(perHeadDay)}/hd/day` : ''}</span>` : ''}</span>
      </div>
      <table class="plan-table">
        <thead><tr><th class="idx">#</th><th>Ingredient</th><th class="num">Target</th><th class="num">Cost</th></tr></thead>
        <tbody>${targets.map((t, i) => `<tr><td class="idx">${i + 1}</td><td>${esc(t.name)}</td><td class="num">${fmt(t.target)} <small>lb</small></td><td class="num muted">${money(costs[i], true)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td class="idx"></td><td>Total</td><td class="num">${fmt(total)} <small>lb</small></td><td class="num">${money(totalCost, true)}</td></tr></tfoot>
      </table>
      ${totalCost !== null && priced.length < costs.length ? '<p class="hint padded">Some ingredients have no price, so the cost is incomplete.</p>' : ''}
    </div>
    ${cap && total > cap ? `<div class="callout warn">${icon('alert', 20)}<span>${fmt(total)} lb is over the mixer capacity of ${fmt(cap)} lb. Consider ${Math.ceil(total / cap)} smaller loads.</span></div>` : ''}
    <button class="btn primary huge" data-action="start" ${total > 0 ? '' : 'disabled'}>${icon('load', 28)}<span>Start loading</span></button>`;
}

const emptyRow = (cols) => `<tr><td colspan="${cols}" class="muted">No loads in this period.</td></tr>`;

function costPerHeadDayText(l) {
  if (l.totalCost == null || !(l.headCount > 0)) return '';
  const v = l.totalCost / l.headCount / ((l.feedingPct || 100) / 100);
  return `<p class="hint">${money(v)} per head per day${l.costComplete === false ? ' (some ingredients had no price)' : ''}</p>`;
}

// Round an axis maximum up to 1, 2 or 5 × a power of ten.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((k) => k * p).find((n) => n >= v);
}

const shortDate = (key) => {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Daily bar chart as inline SVG: one series, rounded bar tops, faint grid,
// and a tooltip on hover or tap (see the dashboard click/pointer handlers).
function trendChart(daily, metric) {
  const values = daily.map((d) => (metric === 'cost' ? d.cost ?? 0 : d.lbs));
  // Draw at the card's real width so axis text stays readable on a phone.
  const W = Math.round(Math.min(900, Math.max(300, app.clientWidth - 72)));
  const H = W < 500 ? 200 : 240;
  const pad = { l: 56, r: 8, t: 12, b: 28 };
  const max = niceMax(Math.max(...values));
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / daily.length;
  const gap = 2;
  const bw = Math.max(1, slot - gap);
  const y = (v) => pad.t + plotH - (v / max) * plotH;
  const label = (v) => (metric === 'cost' ? money(v, true) : `${fmt(v)}`);
  const grid = [0, 0.5, 1].map((f) => {
    const v = max * f;
    return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"></line>
      <text class="axis" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${label(v)}</text>`;
  }).join('');
  const ticks = [0, Math.floor((daily.length - 1) / 2), daily.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const xLabels = ticks.map((i) => `<text class="axis" x="${pad.l + i * slot + bw / 2}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'}">${shortDate(daily[i].date)}</text>`).join('');
  const bars = daily.map((d, i) => {
    const v = values[i];
    const x = pad.l + i * slot;
    const tip = `${shortDate(d.date)}: ${metric === 'cost' ? money(d.cost) : `${fmt(d.lbs)} lb`} · ${d.loads} load${d.loads === 1 ? '' : 's'}`;
    let mark = '';
    if (v > 0) {
      const top = y(v);
      const r = Math.min(4, bw / 2, (pad.t + plotH - top));
      const bottom = pad.t + plotH;
      mark = `<path class="bar" d="M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${bottom} Z"></path>`;
    }
    // A full-height invisible target makes thin bars easy to hover or tap.
    return `<g data-tip="${esc(tip)}">${mark}<rect class="hit" x="${x}" y="${pad.t}" width="${slot}" height="${plotH}"></rect></g>`;
  }).join('');
  return `
    <div class="chart" data-chart>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric === 'cost' ? 'Feed cost' : 'Feed mixed'} per day for the last ${daily.length} days">
        ${grid}<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + plotH}" y2="${pad.t + plotH}"></line>${bars}${xLabels}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>`;
}

function diffClass(diff, target) {
  const tol = tolerance(target, data.settings);
  return stepStatus(target, target + diff, tol);
}

function loadDetail(l) {
  return `
    <div class="detail-meta">
      ${l.operator ? `<span>${icon('users', 16)}${esc(l.operator)}</span>` : ''}
      ${l.headCount ? `<span>${icon('pens', 16)}${l.headCount} head</span>` : ''}
      <span>${icon('history', 16)}${esc(new Date(l.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}–${esc(new Date(l.finishedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</span>
    </div>
    <div class="table-scroll"><table class="detail-table">
      <thead><tr><th>Ingredient</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Diff</th><th class="num">Cost</th></tr></thead>
      <tbody>${l.items.map((i) => `<tr>
        <td>${esc(i.name)}${i.skipped ? ' <small class="muted">(skipped)</small>' : ''}</td>
        <td class="num">${fmt(i.target)}</td><td class="num">${fmt(i.actual)}</td>
        <td class="num ${diffClass(i.actual - i.target, i.target)}">${signed(i.actual - i.target)}</td>
        <td class="num muted">${money(i.cost, true)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${fmt(l.totalTarget)}</td><td class="num">${fmt(l.totalActual)}</td>
        <td class="num">${signed(l.totalActual - l.totalTarget)}</td><td class="num">${money(l.totalCost, true)}</td></tr></tfoot>
    </table></div>
    ${costPerHeadDayText(l)}`;
}

const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const signedPct = (n) => {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r === 0 ? '0.0' : r.toFixed(1)}%`;
};

function statusText() {
  const labels = {
    connected: 'Connected', connecting: 'Connecting', stale: 'No data',
    error: 'Problem', disconnected: 'Not connected',
  };
  return `${labels[scale.status] ?? scale.status}${scale.message ? ` – ${scale.message}` : ''}`;
}

// ---------------------------------------------------------------- rendering

function pinDots() {
  const n = Math.max(4, pinEntry.digits.length);
  return Array.from({ length: n }, (_, i) => `<span class="${i < pinEntry.digits.length ? 'on' : ''}"></span>`).join('');
}

function render() {
  const r = allowedRoute(route());
  currentRoute = r;
  document.querySelector('nav').hidden = !user;
  document.querySelectorAll('nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.go === r);
    a.hidden = MANAGER_ROUTES.has(a.dataset.go) && !isManager(user);
  });
  const chip = document.getElementById('user-chip');
  chip.hidden = !user;
  chip.querySelector('b').textContent = user?.name ?? '';
  document.body.classList.toggle('is-loading', r === 'loading');
  app.innerHTML = views[r]();
  updateStatus();
  updateLive();
  keepScreenOn(r === 'loading');
}

let beepedStep = null;

function updateLive() {
  const w = scale.weight;
  document.querySelectorAll('[data-live="gross"]').forEach((el) => { el.textContent = fmt(w); });
  const s = data.activeLoad;
  const view = document.getElementById('loadview');
  if (!s || !view || w === null) return;

  const step = currentStep(s);
  const net = netLoaded(s, w);
  const remaining = step.target - net;
  const tol = tolerance(step.target, data.settings);
  const status = stepStatus(step.target, net, tol);

  view.dataset.status = status;
  view.querySelector('[data-live="net"]').textContent = fmt(net);
  view.querySelector('[data-live="remaining"]').textContent = fmt(Math.abs(remaining));
  view.querySelector('[data-live="remaining-label"]').textContent =
    status === 'ok' ? 'lb – on target' : remaining >= 0 ? 'lb to go' : 'lb OVER';
  // The bar runs to 110% of target; the target mark sits at 100/110.
  const pct = step.target > 0 ? Math.max(0, Math.min(net / (step.target * 1.1), 1)) * 100 : 0;
  view.querySelector('[data-live="bar"]').style.width = `${pct}%`;

  const key = `${s.id}:${s.index}:${status}`;
  if (status !== 'under' && beepedStep !== key) {
    beepedStep = key;
    signal(status);
  }
}

function updateStatus() {
  const dot = document.getElementById('scale-dot');
  dot.className = `dot ${scale.status}`;
  dot.title = statusText();
  document.querySelectorAll('[data-live="status-text"]').forEach((el) => { el.textContent = statusText(); });
  const warn = document.querySelector('[data-live="scale-warn"]');
  if (warn) {
    // Toggle visibility rather than hiding it, so it always takes the same space.
    warn.classList.toggle('off', scale.status === 'connected');
    warn.innerHTML = `${icon('alert', 18)}<span>Scale: ${esc(statusText())}. Check the reading before tapping Done.</span>`;
  }
  document.getElementById('scale-type').textContent =
    scale.type === 'simulator' ? 'SIM' : scale.type === 'manual' ? 'MANUAL' : '';
}

let audio = null;
function signal(status) {
  if (!data.settings.beep) return;
  navigator.vibrate?.(status === 'over' ? [200, 100, 200] : 150);
  if (!audio) return;
  const tones = status === 'over' ? [330, 330] : [880];
  tones.forEach((freq, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.3;
    osc.connect(gain).connect(audio.destination);
    const t = audio.currentTime + i * 0.3;
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

let wakeLock = null;
async function keepScreenOn(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
    }
  } catch { /* not supported or not allowed; harmless */ }
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- actions

async function signIn() {
  const sel = byId(data.users, pinEntry.userId);
  if (!sel) return;
  const wait = attempts.waitMs();
  if (wait) {
    pinEntry.error = `Too many wrong PINs. Try again in ${Math.ceil(wait / 1000)} seconds.`;
  } else if (await checkPin(sel, pinEntry.digits)) {
    attempts.succeed();
    Object.assign(pinEntry, { userId: null, digits: '', error: '' });
    user = sel;
    lastActivity = Date.now();
    go(data.activeLoad ? 'loading' : 'home');
    return;
  } else {
    attempts.fail();
    pinEntry.error = attempts.waitMs() ? 'Too many wrong PINs. Wait 30 seconds.' : 'Wrong PIN. Try again.';
  }
  pinEntry.digits = '';
  render();
}

function lock() {
  user = null;
  Object.assign(pinEntry, { userId: null, digits: '', error: '' });
  go('login');
}

function refreshPin() {
  document.querySelector('[data-live="pin-dots"]').innerHTML = pinDots();
  document.querySelector('[data-live="pin-msg"]').textContent = pinEntry.error;
}

const actions = {
  'pick-user'(el) {
    Object.assign(pinEntry, { userId: el.dataset.id || null, digits: '', error: '' });
    render();
  },
  'pin-key'(el) {
    if (pinEntry.digits.length >= 6) return;
    pinEntry.digits += el.dataset.key;
    pinEntry.error = '';
    refreshPin();
  },
  'pin-back'() {
    pinEntry.digits = pinEntry.digits.slice(0, -1);
    refreshPin();
  },
  'pin-ok'() { signIn(); },
  'dash-period'(el) { dash.period = el.dataset.period; render(); },
  'dash-metric'(el) { dash.metric = el.dataset.metric; render(); },
  lock() { lock(); },

  async 'create-first'() {
    const name = document.getElementById('setup-name').value.trim();
    const pin = document.getElementById('setup-pin').value;
    if (!name) return notify('Enter a name.');
    const problem = pinProblem(pin);
    if (problem) return notify(problem);
    if (pin !== document.getElementById('setup-pin2').value) return notify('The two PINs don\'t match.');
    const first = await createUser({ name, pin, role: 'manager' });
    data.users.push(first);
    persist();
    user = first;
    go('home');
  },
  async 'add-user'() {
    const name = document.getElementById('new-user-name').value.trim();
    const pin = document.getElementById('new-user-pin').value;
    if (!name) return notify('Enter a name.');
    if (data.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) return notify(`There is already a user called ${name}.`);
    const problem = pinProblem(pin);
    if (problem) return notify(problem);
    data.users.push(await createUser({ name, pin, role: document.getElementById('new-user-role').value }));
    persist();
    render();
  },
  async 'change-pin'(el) {
    const u = byId(data.users, el.dataset.id);
    const pin = await ask(`New PIN for ${u.name} (4–6 digits)`, { ok: 'Save PIN', input: '', secret: true });
    if (pin === null) return;
    const problem = pinProblem(pin);
    if (problem) return notify(problem);
    await setPin(u, pin);
    persist();
    notify(`PIN changed for ${u.name}.`);
  },
  async 'del-user'(el) {
    const u = byId(data.users, el.dataset.id);
    if (isManager(u) && managerCount(data.users) === 1) return notify('You need at least one manager.');
    if (!(await ask(`Delete user ${u.name}? Their past loads stay in history.`, { ok: 'Delete', danger: true }))) return;
    data.users = data.users.filter((x) => x !== u);
    persist();
    render();
  },
  mode(el) {
    draft.mode = el.dataset.mode;
    if (draft.mode === 'total' && !num(draft.totalLbs)) draft.totalLbs = sum(draftTargets().map((t) => t.target)) || 0;
    render();
  },
  async start() {
    if (scale.weight === null && scale.type === 'manual') {
      const reading = await ask('What does the mixer scale read now (lb)?', { ok: 'Start', input: '0' });
      if (reading === null) return;
      scale.setManual(num(reading));
    }
    if (scale.weight === null) {
      notify('No weight from the scale yet. Check the scale connection in Settings.');
      return;
    }
    try { audio ??= new AudioContext(); } catch { /* no audio */ }
    const ration = byId(data.rations, draft.rationId);
    const pen = byId(data.pens, draft.penId);
    data.activeLoad = startSession({
      targets: draftTargets(),
      startWeight: scale.weight,
      rationName: ration.name,
      rationId: ration.id,
      penName: pen?.name ?? '',
      penId: pen?.id ?? '',
      feedingPct: ration.feedingPct ?? 100,
      headCount: draft.mode === 'head' ? num(draft.headCount) : 0,
      operator: user.name,
      operatorId: user.id,
    });
    persist();
    go('loading');
  },
  next() { recordStep(false); },
  skip() { recordStep(true); },
  back() {
    goBack(data.activeLoad);
    persist();
    render();
  },
  async 'cancel-load'() {
    if (!(await ask('Cancel this load? It will not be saved to history.', { ok: 'Cancel load', cancel: 'Keep loading', danger: true }))) return;
    data.activeLoad = null;
    persist();
    go('home');
  },
  'sim-bucket'() { scale.simulator?.addBucket(); },
  'sim-empty'() { scale.simulator?.empty(); },

  'add-ration'() {
    data.rations.push({ id: newId(), name: 'New ration', items: [] });
    persist(); render();
  },
  async 'del-ration'(el) {
    const r = byId(data.rations, el.dataset.id);
    if (data.pens.some((p) => p.rationId === r.id)) {
      notify('This ration is used by a pen. Change the pen first.');
      return;
    }
    if (!(await ask(`Delete ration "${r.name}"?`, { ok: 'Delete', danger: true }))) return;
    data.rations = data.rations.filter((x) => x !== r);
    persist(); render();
  },
  'item-add'(el) {
    byId(data.rations, el.dataset.id).items.push({ ingredientId: data.ingredients[0].id, dmLbsPerHead: 0 });
    persist(); render();
  },
  'item-del'(el) {
    byId(data.rations, el.dataset.id).items.splice(Number(el.dataset.idx), 1);
    persist(); render();
  },
  'item-up'(el) { moveItem(el, -1); },
  'item-down'(el) { moveItem(el, 1); },

  'add-ingredient'() {
    data.ingredients.push({ id: newId(), name: 'New ingredient', dmPct: 100, costPerTon: null });
    persist(); render();
  },
  async 'del-ingredient'(el) {
    const ing = byId(data.ingredients, el.dataset.id);
    const used = data.rations.filter((r) => r.items.some((i) => i.ingredientId === ing.id));
    if (used.length) {
      notify(`"${ing.name}" is used in: ${used.map((r) => r.name).join(', ')}. Remove it from those rations first.`);
      return;
    }
    if (!(await ask(`Delete ingredient "${ing.name}"?`, { ok: 'Delete', danger: true }))) return;
    data.ingredients = data.ingredients.filter((x) => x !== ing);
    persist(); render();
  },

  'add-pen'() {
    data.pens.push({ id: newId(), name: 'New pen', headCount: 0, rationId: data.rations[0]?.id ?? '' });
    persist(); render();
  },
  async 'del-pen'(el) {
    const pen = byId(data.pens, el.dataset.id);
    if (!(await ask(`Delete pen "${pen.name}"?`, { ok: 'Delete', danger: true }))) return;
    data.pens = data.pens.filter((x) => x !== pen);
    if (draft.penId === pen.id) draft.penId = '';
    persist(); render();
  },

  'export-csv'() { download(`feed-loads-${today()}.csv`, loadsToCsv(data.loads), 'text/csv'); },
  async 'clear-history'() {
    if (!(await ask('Delete all load history from this device? Export a CSV first if you need it.', { ok: 'Delete history', danger: true }))) return;
    data.loads = [];
    persist(); render();
  },

  connect() { connectScale(false); },
  disconnect() { scale.disconnect(); },
  'ble-preset'(el) {
    const presets = {
      nus: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e', '6e400003-b5a3-f393-e0a9-e50e24dcca9e'],
      hm10: ['ffe0', 'ffe1'],
    };
    [data.settings.bleService, data.settings.bleCharacteristic] = presets[el.dataset.preset];
    persist(); render();
  },
  backup() { download(`feedmixer-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json'); },
};

// Update one ration row's DM / as-fed boxes and the totals without redrawing
// the page, so the operator's place in the form is kept.
function refreshRationRow(ration, idx) {
  const it = ration.items[idx];
  const ing = byId(data.ingredients, it.ingredientId);
  const set = (field, v) => {
    const box = document.querySelector(`[data-field="item.${field}"][data-id="${ration.id}"][data-idx="${idx}"]`);
    if (box && document.activeElement !== box) box.value = amount(v);
  };
  set('dm', it.dmLbsPerHead);
  const afBox = document.querySelector(`[data-field="item.af"][data-id="${ration.id}"][data-idx="${idx}"]`);
  if (afBox && document.activeElement !== afBox) afBox.value = fmt2(asFedLbs(it.dmLbsPerHead, dmPctOf(ing))).replace(/,/g, '');
  const t = rationTotals(ration, data.ingredients);
  document.querySelector(`[data-total-dm="${ration.id}"]`).textContent = fmt2(t.dm);
  document.querySelector(`[data-total-af="${ration.id}"]`).textContent = fmt2(t.asFed);
  document.querySelector(`[data-ration-cost="${ration.id}"]`).innerHTML = rationCostText(ration);
}

let toastTimer;
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.innerHTML = `${icon('check', 18)}<span>${esc(message)}</span>`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function recordStep(skip) {
  if (scale.weight === null) return;
  try { audio ??= new AudioContext(); } catch { /* no audio */ }
  if (advance(data.activeLoad, scale.weight, { skip })) {
    data.loads.unshift(finishSession(data.activeLoad));
    data.activeLoad = null;
    persist();
    go('done');
    return;
  }
  persist();
  render();
}

function moveItem(el, delta) {
  const items = byId(data.rations, el.dataset.id).items;
  const i = Number(el.dataset.idx);
  const j = i + delta;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  persist(); render();
}

function connectScale(auto) {
  return scale.connect(data.settings.scaleType, data.settings, { auto });
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-go]');
  if (link) {
    e.preventDefault();
    go(link.dataset.go);
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  e.preventDefault();
  actions[el.dataset.action]?.(el);
});

// Start-a-load form: update the preview as the operator types.
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.draft) {
    const key = el.dataset.draft;
    if (key === 'penId') {
      applyPen(el.value);
      render();
      return;
    }
    draft[key] = el.value;
    if (key === 'rationId') draft.penId = '';
    document.getElementById('preview').innerHTML = previewTable();
    if (key === 'rationId') document.querySelector('[data-draft="penId"]').value = '';
  } else if (el.matches('[data-manual]')) {
    scale.setManual(num(el.value));
  }
});

// Editors: save each field as it changes.
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('[data-restore]')) {
    restoreBackup(el.files[0]);
    return;
  }
  const field = el.dataset.field;
  if (!field) return;
  const [kind, key] = field.split('.');
  const value = el.value;
  const { id } = el.dataset;
  const idx = Number(el.dataset.idx);

  if (kind === 'ration' && key === 'name') byId(data.rations, id).name = value.trim() || 'Unnamed ration';
  if (kind === 'ration' && key === 'feedingPct') byId(data.rations, id).feedingPct = num(value) > 0 ? num(value) : 100;
  if (kind === 'item') {
    const ration = byId(data.rations, id);
    const it = ration.items[idx];
    if (key === 'ingredient') it.ingredientId = value;
    // DM and as-fed are two views of one amount: store DM, show both.
    if (key === 'dm') it.dmLbsPerHead = Math.max(0, num(value));
    if (key === 'af') it.dmLbsPerHead = dmLbs(Math.max(0, num(value)), dmPctOf(byId(data.ingredients, it.ingredientId)));
    refreshRationRow(ration, idx);
  }
  if (kind === 'ingredient' && key === 'name') byId(data.ingredients, id).name = value.trim() || 'Unnamed';
  if (kind === 'ingredient' && key === 'dmPct') {
    const ing = byId(data.ingredients, id);
    const v = num(value);
    if (!(v > 0 && v <= 100)) {
      el.value = ing.dmPct ?? '';
      notify('Dry matter must be between 1 and 100%.');
      return;
    }
    const changed = ing.dmPct !== v;
    ing.dmPct = v;
    const affected = data.rations.filter((r) => r.items.some((x) => x.ingredientId === id)).length;
    if (changed && affected) toast(`As-fed amounts updated in ${affected} ration${affected === 1 ? '' : 's'}`);
  }
  if (kind === 'ingredient' && key === 'costPerTon') byId(data.ingredients, id).costPerTon = value === '' ? null : Math.max(0, num(value));
  if (kind === 'user') {
    const u = byId(data.users, id);
    if (key === 'name') u.name = value.trim() || u.name;
    if (key === 'role') {
      if (u.role === 'manager' && value !== 'manager' && managerCount(data.users) === 1) {
        el.value = 'manager';
        notify('You need at least one manager.');
        return;
      }
      u.role = value;
      if (u.id === user.id && !isManager(u)) {
        persist();
        go('home');
        return;
      }
    }
    if (u.id === user.id) render();
  }
  if (kind === 'pen') {
    const pen = byId(data.pens, id);
    pen[key] = key === 'headCount' ? Math.max(0, Math.round(num(value))) : key === 'name' ? value.trim() || 'Unnamed pen' : value;
    if (draft.penId === id) applyPen(id);
  }
  if (kind === 'setting') {
    data.settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? num(value) : value.trim();
    if (key === 'scaleType') {
      persist();
      // Simulator, manual and Wi-Fi can connect straight away; the others need a tap.
      connectScale(true).then(render);
      render();
      return;
    }
  }
  persist();
});

async function restoreBackup(file) {
  if (!file) return;
  try {
    const restored = store.normalize(JSON.parse(await file.text()));
    if (!Array.isArray(restored.rations) || !Array.isArray(restored.ingredients)) throw new Error('not a backup file');
    if (!(await ask('Replace all data on this device with this backup?', { ok: 'Replace', danger: true }))) return;
    data = restored;
    persist();
    user = byId(data.users, user?.id) ?? null;
    applyPen(data.pens[0]?.id ?? '');
    await connectScale(true);
    render();
  } catch (err) {
    notify(`Could not restore backup: ${err.message}`);
  }
}

scale.addEventListener('weight', updateLive);
scale.addEventListener('status', updateStatus);
scale.addEventListener('line', () => {
  const log = document.querySelector('[data-live="rawlog"]');
  if (log) log.textContent = scale.recentLines.join('\n');
});
// Chart tooltip: follows the pointer on desktop, shows on tap on a phone.
function showChartTip(e) {
  const chart = e.target.closest?.('[data-chart]');
  document.querySelectorAll('.chart-tip').forEach((t) => { if (!chart || !chart.contains(t)) t.hidden = true; });
  if (!chart) return;
  const g = e.target.closest('[data-tip]');
  const tip = chart.querySelector('.chart-tip');
  chart.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
  if (!g) { tip.hidden = true; return; }
  g.querySelector('.bar')?.classList.add('active');
  tip.textContent = g.dataset.tip;
  tip.hidden = false;
  const box = chart.getBoundingClientRect();
  const hit = g.querySelector('.hit').getBoundingClientRect();
  const x = hit.left + hit.width / 2 - box.left;
  // Sit just above the bar (or the baseline on an empty day), inside the chart.
  const top = (g.querySelector('.bar') ?? hit).getBoundingClientRect()[g.querySelector('.bar') ? 'top' : 'bottom'] - box.top;
  tip.style.left = `${Math.min(Math.max(x, tip.offsetWidth / 2), box.width - tip.offsetWidth / 2)}px`;
  tip.style.top = `${Math.max(top - 6, tip.offsetHeight)}px`;
}
document.addEventListener('pointermove', showChartTip);
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (route() === 'dashboard') render(); }, 200);
});
document.addEventListener('pointerdown', showChartTip);

// Lock after a spell of no taps, but never in the middle of a load.
['pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, () => { lastActivity = Date.now(); }, true));
setInterval(() => {
  const minutes = num(data.settings.autoLockMinutes);
  if (user && minutes > 0 && !data.activeLoad && Date.now() - lastActivity > minutes * 60_000) lock();
}, 15_000);

// A hardware keyboard can type the PIN too.
document.addEventListener('keydown', (e) => {
  if (route() !== 'login' || !pinEntry.userId || !document.getElementById('modal').hidden) return;
  if (/^\d$/.test(e.key)) actions['pin-key']({ dataset: { key: e.key } });
  else if (e.key === 'Backspace') actions['pin-back']();
  else if (e.key === 'Enter') signIn();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepScreenOn(route() === 'loading');
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable', err));
}

const NAV = [
  ['home', 'Load', 'load'], ['rations', 'Rations', 'rations'], ['ingredients', 'Ingredients', 'ingredients'],
  ['pens', 'Pens', 'pens'], ['history', 'History', 'history'], ['dashboard', 'Dashboard', 'dashboard'],
  ['users', 'Users', 'users'], ['settings', 'Settings', 'settings'],
];
document.querySelector('nav').innerHTML = NAV.map(([r, label, ic]) => `<a href="#" data-go="${r}">${icon(ic, 18)}<span>${label}</span></a>`).join('');
document.querySelector('.brand').innerHTML = `${brandMark()}<span>Feed Mixer</span>`;
document.querySelector('#user-chip span').innerHTML = `${icon('lock', 14)}Lock`;

render();
connectScale(true);
