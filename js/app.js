import { readXlsx } from './xlsx.js';
import {
  MEALS, MEAL_LABEL, PLAN_LABEL, DEFAULT_TIMES, dateKey, monthKey, parseDateKey, pad,
  parseMenuWorkbook, menuFor, mealWindows, currentMeal, formatDuration, formatClock,
} from './menu.js';
import { estimateItem, totals, computeTargets, DEFAULT_TARGETS } from './nutrition.js';
import * as db from './db.js';
import * as ai from './ai.js';
import { dayTotals, summarise, streak, findings, coachPayload, eachDay, dayReport, dayPayload } from './insights.js';
import { dayline, dailyBars, ICONS, LOGO } from './charts.js';
import * as fx from './fx.js';
import { buildReport } from './report.js';
import { openLog, openEntry, openDay, processPending, closeSheet } from './log.js';

const BUNDLED_MENUS = ['menu/2026-10.xlsx'];
const VERSION = '2.4.0';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n) => Math.round(n || 0).toLocaleString('en-IN');
const NONVEG = /\b(chicken|mutton|fish|prawn|egg|omlet|omelet|omelette)\b/i;

export const S = {
  now: new Date(),
  tab: 'today',
  menus: new Map(),
  prefs: { theme: 'auto', plan: 'regular', diet: 'nonveg' },
  targets: { ...DEFAULT_TARGETS, manual: false },
  profile: {},
  times: structuredClone(DEFAULT_TIMES),
  ai: ai.emptyConfig(),
  aiStatus: {},
  dayKey: null,
  focus: null,
  todayPlan: null,
  menuDate: null,
  menuPlan: null,
  journalMonth: null,
  range: '7',
  showTable: false,
  coach: {},
  installEvt: null,
};

export function toast(message, ms = 2600) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}

export const NATIVE = typeof window.AnnamayaNative !== 'undefined';

export async function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  if (NATIVE) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    window.AnnamayaNative.saveFile(name, blob.type || type || 'application/octet-stream', btoa(bin));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const menuOf = (date) => S.menus.get(monthKey(date)) || null;

export function effectiveLine(item) {
  if (item.tag !== 'mixed') return item.raw.replace(/\s*\((?:non[\s-]?veg|nv|veg)\)/gi, '').trim();
  const wantVeg = S.prefs.diet === 'veg';
  const parts = item.raw.split(/\s*,\s*(?![^()]*\))/).map((p) => ({ p, nv: /\((?:non[\s-]?veg|nv)\)/i.test(p), veg: /\(veg\)/i.test(p) }));
  if (parts.some((t) => t.nv) && parts.some((t) => t.veg)) {
    const pick = parts.find((t) => (wantVeg ? t.veg : t.nv));
    return pick.p.replace(/\((?:non[\s-]?veg|nv|veg)\)/gi, '').split('/')[0].trim();
  }
  const options = item.raw.split('/').map((s) => s.trim()).filter(Boolean);
  const nv = options.find((o) => NONVEG.test(o));
  const veg = options.find((o) => !NONVEG.test(o));
  return (wantVeg ? veg : nv) || options[0];
}

export const isOffDiet = (item) => S.prefs.diet === 'veg' && item.tag === 'nonveg';

export function menuItems(date, plan, meal) {
  const day = menuFor(menuOf(date), date, plan);
  if (!day) return null;
  return day[meal].map((item) => {
    const line = effectiveLine(item);
    return { ...item, line, est: estimateItem(line), off: isOffDiet(item) };
  });
}

const photoUrls = new Map();
export async function photoUrl(id) {
  if (!id) return null;
  if (!photoUrls.has(id)) {
    const blob = await db.photos.get(id);
    if (!blob) return null;
    photoUrls.set(id, URL.createObjectURL(blob));
  }
  return photoUrls.get(id);
}
async function hydratePhotos(root) {
  for (const el of $$('[data-photo]', root)) {
    const url = await photoUrl(el.dataset.photo);
    if (url) {
      el.style.backgroundImage = `url(${url})`;
      el.textContent = '';
    }
  }
}

export function entryRow(e) {
  const names = (e.items || []).map((i) => i.name).join(', ');
  const src = e.pending ? '<span class="badge pending">To analyse</span>' : e.source === 'photo' ? '<span class="badge">Photo</span>' : '';
  const at = new Date(e.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `<button class="entry" data-action="open-entry" data-id="${e.id}" style="--c:var(--m-${e.meal})">
    ${e.photoId ? `<span class="thumb" data-photo="${e.photoId}"></span>` : ''}
    <span class="grow"><span class="ttl"><i></i>${MEAL_LABEL[e.meal]} <em>${at}</em> ${src}</span><span class="sub">${esc(e.summary || names || 'Photo saved')}</span></span>
    <span class="kc num">${e.pending ? '—' : fmt(e.kcal)}</span></button>`;
}

const meter = (label, value, target, unit = 'g', color = '') => `<div class="meter" ${color ? `style="--c:${color}"` : ''}>
  <div class="lab"><b>${label}</b><span class="num">${fmt(value)} / ${fmt(target)} ${unit}</span></div>
  <div class="bar"><i style="width:${Math.min(100, target ? (value / target) * 100 : 0).toFixed(1)}%"></i></div></div>`;

const seg = (action, options, current) => `<div class="seg" role="group">${options
  .map(([v, label]) => `<button type="button" data-action="${action}" data-value="${v}" aria-pressed="${v === current}">${esc(label)}</button>`)
  .join('')}</div>`;

const topBar = (title, sub, right = '') => `<header class="top">
  <div class="brand">${LOGO}<div class="grow"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div></div>${right}</header>`;

const themeIcon = () => ICONS[{ auto: 'auto', light: 'sun', dark: 'moon' }[S.prefs.theme]];
const headerButtons = () => `<button class="icon-btn" data-action="cycle-theme" aria-label="Theme: ${S.prefs.theme}">${themeIcon()}</button>
  <a class="icon-btn" href="#settings" aria-label="Settings">${ICONS.gear}</a>`;

function plansFor(date) {
  const m = menuOf(date);
  return m ? Object.keys(m.plans) : ['regular'];
}
const planSeg = (action, date, current) => {
  const plans = plansFor(date);
  return plans.length > 1 ? seg(action, plans.map((p) => [p, PLAN_LABEL[p]]), current) : '';
};

function itemList(items) {
  return `<ul class="items card-list">${items
    .map((i) => `<li class="${i.off ? 'off' : ''}">
      <span class="diet ${i.tag === 'nonveg' ? 'nonveg' : i.tag === 'mixed' ? 'mixed' : ''}" title="${i.tag === 'nonveg' ? 'Non-veg' : i.tag === 'mixed' ? 'Veg and non-veg options' : 'Veg'}"></span>
      <span class="nm">${esc(i.name)}${i.note ? `<span class="nt">${esc(i.note)}</span>` : ''}</span><span class="dots"></span>
      <span class="kc num" data-tip="${esc(`Estimate for ${i.est.serving}\nP ${i.est.protein} g · C ${i.est.carbs} g · F ${i.est.fat} g`)}">${fmt(i.est.kcal)}<small>kcal</small></span></li>`)
    .join('')}</ul>`;
}

function noMenuCard(date) {
  const label = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return `<div class="card"><div class="empty"><p><b>No menu loaded for ${esc(label)}.</b></p>
    <p style="margin:6px 0 14px">Import that month's mess menu Excel file and it will appear here.</p>
    <button class="btn primary" data-action="import-menu">${ICONS.upload} Import Excel</button></div></div>`;
}

async function viewToday() {
  const now = S.now;
  const today = dateKey(now);
  const entries = await db.logs.forDate(today);
  const day = await db.days.get(today);
  const tot = dayTotals(entries);
  const cm = currentMeal(now, S.times);
  const auto = !S.focus;
  const focusMeal = auto ? cm.meal : S.focus.meal;
  const focusDate = auto ? cm.date : now;
  const plan = S.todayPlan || S.prefs.plan;
  const win = mealWindows(S.times).find((w) => w.meal === focusMeal);
  const mins = now.getHours() * 60 + now.getMinutes();

  const items = menuItems(focusDate, plan, focusMeal);
  const remaining = S.targets.kcal - tot.kcal;
  const hello = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const mealLogged = entries.some((e) => e.meal === focusMeal) && dateKey(focusDate) === today;

  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
  const weekLogs = await db.logs.range(dateKey(weekDays[0]), dateKey(weekDays[6]));
  const st = streak(await db.logs.all(), now);
  const live = auto && cm.state === 'now';
  const isToday = dateKey(focusDate) === today;
  const statusWord = auto ? { now: 'Now serving', next: 'Up next', tomorrow: 'Tomorrow' }[cm.state]
    : mins >= win.end ? 'Served earlier' : mins >= win.start ? 'Now serving' : `Starts in ${formatDuration(win.start - mins)}`;
  const dayNo = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(now.getFullYear(), 0, 0)) / 864e5);
  const scaleMax = S.targets.kcal * 1.25;
  const windows = mealWindows(S.times);
  const stamp = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return `${topBar('Annamaya', now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }), headerButtons())}
  ${navigator.onLine ? '' : `<div class="offline-bar">${ICONS.offline} Offline — menu and logging still work</div>`}

  <div class="week">${weekDays.map((d) => {
    const k = dateKey(d);
    return `<button class="${k === today ? 'today' : ''} ${k > today ? 'future' : ''}" data-action="open-day" data-value="${k}" aria-label="${d.toLocaleDateString('en-IN', { weekday: 'long' })}">
      <span class="wd">${d.toLocaleDateString('en-IN', { weekday: 'short' })}</span><b class="num">${d.getDate()}</b>
      <span class="pd">${MEALS.map((m) => `<i class="${weekLogs.some((e) => e.date === k && e.meal === m) ? 'on' : ''}" style="--c:var(--m-${m})"></i>`).join('')}</span></button>`;
  }).join('')}</div>

  <section class="coupon">
    <div class="cp-top"><span>Daily meal coupon</span><span>No. ${String(dayNo).padStart(3, '0')}${st > 1 ? ` · ${st}-day run` : ` / ${now.getFullYear()}`}</span></div>
    <div class="cp-main">
      <div class="cp-fig">
        <div class="big num" data-count="${Math.round(tot.kcal)}" data-count-key="today-kcal">${fmt(tot.kcal)}</div>
        <div class="unit"><b>kcal</b>eaten of ${fmt(S.targets.kcal)}</div>
        <div class="cp-left ${remaining < 0 ? 'over' : ''}">${remaining >= 0 ? `${fmt(remaining)} left` : `${fmt(-remaining)} over`}</div>
      </div>
      <div class="scale ${tot.kcal > S.targets.kcal * 1.1 ? 'over' : ''}"><i style="width:${Math.min(100, (tot.kcal / scaleMax) * 100).toFixed(1)}%"></i><u></u></div>
      <div class="scale-lab"><span>0</span><span>Target</span><span>${fmt(scaleMax)}</span></div>
      ${dayline({ now, times: S.times, mealKcal: tot.meals })}
    </div>
    <div class="perf"></div>
    <div class="stubs">${MEALS.map((m) => {
      const k = tot.meals[m] || 0;
      const taken = tot.taken.includes(m);
      const w = windows.find((x) => x.meal === m);
      return `<button data-action="focus-meal" data-value="${m}" aria-pressed="${m === focusMeal && !auto}" style="--c:var(--m-${m})">
        <span class="sn">${MEAL_LABEL[m]}</span><span class="st">${formatClock(w.startLabel)}</span>
        <span class="sk num">${k ? `${fmt(k)}<small>kcal</small>` : '—'}</span>${!k && taken ? '<span class="su">pending</span>' : ''}
        ${taken ? '<span class="stamp">Eaten</span>' : ''}</button>`;
    }).join('')}</div>
  </section>

  ${!S.profile.weightKg && !S.targets.manual ? `<a class="card row nudge" href="#settings"><span class="ic">${ICONS.target}</span>
    <span class="grow"><b>Set your own calorie target</b><br><span class="small muted">Using a general 2,200 kcal for now. Add your height and weight in Settings.</span></span>${ICONS.right}</a>` : ''}

  ${items ? `<section class="board" style="--c:var(--m-${focusMeal})">
    <header>
      <div class="grow">
        <span class="status ${statusWord === 'Now serving' ? 'live' : ''}">${statusWord}</span>
        <h2>${MEAL_LABEL[focusMeal]}</h2>
        <div class="bt">${formatClock(win.startLabel)} – ${formatClock(win.endLabel)}${isToday ? '' : ` · ${focusDate.toLocaleDateString('en-IN', { weekday: 'long' })}`}${mealLogged ? ' · logged' : ''}</div>
      </div>
      ${auto ? `<div class="bclock"><b class="num" data-live>–:––</b><span>${live ? 'left to eat' : 'until it opens'}</span></div>`
        : '<button class="link" data-action="focus-auto">Back to now</button>'}
    </header>
    ${live ? '<div class="now-progress"><i data-live-bar></i></div>' : ''}
    <div class="pad">
      ${planSeg('today-plan', focusDate, plan)}
      ${itemList(items)}
      ${isToday ? `<div class="btn-row" style="margin-top:14px">
        <button class="btn primary" data-action="log" data-mode="photo" data-meal="${focusMeal}">${ICONS.camera} Snap plate</button>
        <button class="btn" data-action="log" data-mode="menu" data-meal="${focusMeal}">${ICONS.check} Tick items</button>
      </div>` : `<button class="btn block" style="margin-top:14px" data-action="log" data-mode="menu" data-meal="dinner">${ICONS.plus} Log something from today</button>`}
    </div>
  </section>` : noMenuCard(focusDate)}

  <section class="receipt">
    <div class="r-head"><b>Annamaya</b>Eaten today · ${stamp}</div>
    ${entries.length ? entries.sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.ts - b.ts).map(entryRow).join('')
      : '<div class="empty">— nothing on the bill yet —<br>snap your plate or tick what you took</div>'}
    <div class="r-total"><span>TOTAL</span><span><b class="num">${fmt(tot.kcal)}</b> KCAL</span></div>
    <div class="r-foot">P ${fmt(tot.protein)} g · C ${fmt(tot.carbs)} g · F ${fmt(tot.fat)} g<br>${tot.taken.length} of 4 meals · estimates only</div>
    <a class="btn block" style="margin-top:14px" href="#day/${today}">${ICONS.chart} Full day statement</a>
  </section>

  <section class="card">
    <div class="card-head"><h2>Macros</h2><span class="aside">estimated</span></div>
    <div class="stack">
      ${meter('Protein', tot.protein, S.targets.protein)}
      ${meter('Carbs', tot.carbs, S.targets.carbs)}
      ${meter('Fat', tot.fat, S.targets.fat)}
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Water</h2><span class="aside">${day.water || 0} of 8 glasses</span></div>
    <div class="water">${Array.from({ length: 8 }, (_, i) => `<button data-action="water" data-value="${i + 1}" class="${i < (day.water || 0) ? 'on' : ''}" aria-label="${i + 1} glasses"></button>`).join('')}</div>
  </section>`;
}

async function viewMenu() {
  const date = S.menuDate || S.now;
  const menu = menuOf(date);
  const plan = S.menuPlan || S.prefs.plan;
  const today = dateKey(S.now);
  const months = [...S.menus.values()].sort((a, b) => a.key.localeCompare(b.key));
  const cm = currentMeal(S.now, S.times);
  const windows = mealWindows(S.times);

  let body;
  if (!menu) body = noMenuCard(date);
  else {
    const daysInMonth = new Date(menu.year, menu.month, 0).getDate();
    const strip = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(menu.year, menu.month - 1, i + 1);
      const k = dateKey(d);
      return `<button data-action="menu-day" data-value="${k}" class="${k === today ? 'today' : ''}" aria-pressed="${k === dateKey(date)}">
        <span class="dw">${d.toLocaleDateString('en-IN', { weekday: 'short' })}</span><span class="dn num">${i + 1}</span></button>`;
    }).join('');
    const cards = MEALS.map((meal) => {
      const items = menuItems(date, plan, meal) || [];
      const w = windows.find((x) => x.meal === meal);
      const isNow = dateKey(date) === today && cm.meal === meal && cm.state !== 'tomorrow';
      const kcal = items.filter((i) => !i.off).reduce((a, i) => a + i.est.kcal, 0);
      return `<section class="card meal-card ${isNow ? 'is-now' : ''}" style="--c:var(--m-${meal})">
        <div class="card-head"><h2>${MEAL_LABEL[meal]}</h2><span class="aside">${formatClock(w.startLabel)} – ${formatClock(w.endLabel)}</span></div>
        ${isNow ? `<span class="status ${cm.state === 'now' ? 'live' : ''}">${cm.state === 'now' ? 'Serving now' : 'Up next'}</span>` : ''}
        ${items.length ? itemList(items) : '<div class="empty">Nothing listed.</div>'}
        <div class="row" style="margin-top:10px"><span class="small muted grow" data-tip="If you took one serving of everything listed">Whole spread ≈ ${fmt(kcal)} kcal</span>
        <button class="btn sm" data-action="log" data-mode="menu" data-meal="${meal}" data-date="${dateKey(date)}">Log this</button></div>
      </section>`;
    }).join('');
    body = `<div class="daystrip" id="daystrip">${strip}</div>
      <div style="margin-bottom:14px">${planSeg('menu-plan', date, plan)}</div>
      ${cards}
      ${menu.notes.length ? `<details class="card"><summary>Mess service instructions</summary><ol>${menu.notes.map((n) => `<li>${esc(n.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol></details>` : ''}`;
  }

  const monthPicker = months.length > 1
    ? `<select data-change="menu-month" aria-label="Month" style="width:auto;min-height:40px">${months.map((m) => `<option value="${m.key}" ${menu && m.key === menu.key ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>`
    : '';
  return `${topBar('Menu', date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), monthPicker)}
    ${body}
    <section class="card"><div class="card-head"><h2>New month?</h2></div>
      <p class="small muted" style="margin-bottom:12px">Import the next mess menu Excel file. It is read on this device and stays here.</p>
      <button class="btn block" data-action="import-menu">${ICONS.upload} Import menu Excel</button></section>`;
}

async function viewJournal() {
  const base = S.journalMonth || new Date(S.now.getFullYear(), S.now.getMonth(), 1);
  const y = base.getFullYear();
  const m = base.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const from = dateKey(new Date(y, m, 1));
  const to = dateKey(new Date(y, m, last));
  const logs = await db.logs.range(from, to);
  const byDate = new Map();
  for (const e of logs) byDate.set(e.date, [...(byDate.get(e.date) || []), e]);
  const today = dateKey(S.now);

  let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="dow">${d}</div>`).join('');
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  cells += '<div class="blank"></div>'.repeat(lead);
  let loggedDays = 0;
  let sum = 0;
  let mealsTaken = 0;
  for (let d = 1; d <= last; d++) {
    const key = dateKey(new Date(y, m, d));
    const t = dayTotals(byDate.get(key) || []);
    const ratio = S.targets.kcal ? t.kcal / S.targets.kcal : 0;
    if (t.taken.length) {
      loggedDays++;
      sum += t.kcal;
      mealsTaken += t.taken.length;
    }
    const tip = t.taken.length ? `${fmt(t.kcal)} kcal · ${t.taken.map((x) => MEAL_LABEL[x]).join(', ')}` : 'Nothing logged';
    cells += `<button data-action="open-day" data-value="${key}" class="${t.taken.length ? '' : 'none'} ${ratio > 1.1 ? 'over' : ''} ${key === today ? 'today' : ''} ${key > today ? 'future' : ''}" aria-label="${d}: ${esc(tip)}" data-tip="${esc(tip)}">
      <b class="num">${d}</b>${t.kcal ? `<small class="num">${(t.kcal / 1000).toFixed(1)}k</small>` : ''}
      <span class="pd">${MEALS.map((meal) => `<i class="${t.taken.includes(meal) ? 'on' : ''}" style="--c:var(--m-${meal})"></i>`).join('')}</span></button>`;
  }
  cells += '<div class="blank"></div>'.repeat((7 - ((lead + last) % 7)) % 7);
  const s = streak(await db.logs.all(), S.now);

  return `${topBar('Journal', 'Mess attendance register', headerButtons())}
  <section class="card">
    <div class="cal-head">
      <button class="icon-btn" data-action="journal-prev" aria-label="Previous month">${ICONS.left}</button>
      <h2>${base.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
      <button class="icon-btn" data-action="journal-next" aria-label="Next month">${ICONS.right}</button>
    </div>
    <div class="cal">${cells}</div>
    <div class="legend">
      ${MEALS.map((meal) => `<span class="key"><span class="sw dot" style="--c:var(--m-${meal})"></span>${MEAL_LABEL[meal]}</span>`).join('')}
      <span class="key"><span class="sw tri"></span>Over target</span>
    </div>
  </section>
  <div class="tiles">
    <div class="tile"><div class="eyebrow">Days logged</div><div class="v num">${loggedDays}<small> / ${last}</small></div><div class="d">${mealsTaken} meals recorded</div></div>
    <div class="tile"><div class="eyebrow">Daily average</div><div class="v num">${loggedDays ? fmt(sum / loggedDays) : '—'}<small> kcal</small></div><div class="d">${fmt(sum)} kcal this month</div></div>
    <div class="tile"><div class="eyebrow">Current streak</div><div class="v num">${s}<small> ${s === 1 ? 'day' : 'days'}</small></div><div class="d">${s ? 'Keep it going' : 'Log today to start one'}</div></div>
    <div class="tile"><div class="eyebrow">Target</div><div class="v num">${fmt(S.targets.kcal)}<small> kcal</small></div><div class="d"><a class="link" href="#settings">Adjust</a></div></div>
  </div>`;
}

function rangeBounds() {
  const now = S.now;
  const to = dateKey(now);
  if (S.range === 'month') return { from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), to, label: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
  if (S.range === 'all') return { from: '2000-01-01', to, label: 'All time' };
  const n = Number(S.range);
  return { from: dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n + 1)), to, label: `Last ${n} days` };
}

async function viewInsights() {
  const all = await db.logs.all();
  const { from, to, label } = rangeBounds();
  const s = summarise({ logs: all, from, to, now: S.now, targets: S.targets, times: S.times });
  const head = `${topBar('Insights', label, headerButtons())}
    <div style="margin-bottom:14px">${seg('range', [['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['all', 'All']], S.range)}</div>`;
  if (!s.active.length) {
    return `${head}<section class="card"><div class="empty"><p><b>No meals logged in this period yet.</b></p><p style="margin-top:6px">Log a few days and patterns, trends and a personal review will show up here.</p></div></section>`;
  }

  const span = S.range === '7' || S.range === '30' ? eachDay(from, to) : s.days.map((d) => d.date);
  const map = new Map(s.days.map((d) => [d.date, d]));
  const chartDays = span.slice(-62).map((k) => {
    const d = map.get(k) || { kcal: 0, meals: {} };
    const dt = parseDateKey(k);
    return { kcal: d.kcal, meals: Object.fromEntries(MEALS.map((m) => [m, d.meals[m] || 0])), label: span.length > 10 ? String(dt.getDate()) : dt.toLocaleDateString('en-IN', { weekday: 'short' }), tipLabel: dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) };
  });
  const width = Math.min(560, document.documentElement.clientWidth) - 66;
  const delta = s.avgKcal - S.targets.kcal;
  const st = streak(all, S.now);
  const maxWk = Math.max(1, ...s.weekday.map((w) => w.kcal));
  const maxDish = Math.max(1, ...s.topDishes.map((d) => d.count));
  const fnd = findings(s, S.targets);
  const coach = S.coach[`${from}:${to}`];

  return `${head}
  <div class="tiles">
    <div class="tile"><div class="eyebrow">Average day</div><div class="v num">${fmt(s.avgKcal)}<small> kcal</small></div><div class="d">${Math.abs(delta) < 50 ? 'On target' : `${fmt(Math.abs(delta))} ${delta > 0 ? 'over' : 'under'} target`}</div></div>
    <div class="tile"><div class="eyebrow">On target</div><div class="v num">${s.onTarget}<small> / ${s.active.length} days</small></div><div class="d">${s.over} over · ${s.under} under</div></div>
    <div class="tile"><div class="eyebrow">Mess meals eaten</div><div class="v num">${Math.round(s.utilisation * 100)}<small>%</small></div><div class="d">${s.takenTotal} of ${s.offeredTotal} served</div></div>
    <div class="tile"><div class="eyebrow">Streak</div><div class="v num">${st}<small> ${st === 1 ? 'day' : 'days'}</small></div><div class="d">${s.photoLogs} photo ${s.photoLogs === 1 ? 'log' : 'logs'}</div></div>
  </div>

  <section class="card">
    <div class="card-head"><h2>Daily calories</h2><button class="link" data-action="toggle-table">${S.showTable ? 'Show chart' : 'Show table'}</button></div>
    ${S.showTable
      ? `<div style="max-height:300px;overflow:auto"><table class="data"><thead><tr><th>Day</th>${MEALS.map((m) => `<th>${MEAL_LABEL[m]}</th>`).join('')}<th>Total</th></tr></thead><tbody>
        ${chartDays.map((d) => `<tr><td>${esc(d.tipLabel)}</td>${MEALS.map((m) => `<td>${d.meals[m] ? fmt(d.meals[m]) : '–'}</td>`).join('')}<td><b>${fmt(d.kcal)}</b></td></tr>`).join('')}</tbody></table></div>`
      : dailyBars({ days: chartDays, target: S.targets.kcal, width })}
    <div class="legend">${MEALS.map((m) => `<span class="key"><span class="sw" style="--c:var(--m-${m})"></span>${MEAL_LABEL[m]}</span>`).join('')}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2>What the data says</h2></div>
    ${fnd.map((f, i) => `<div class="finding"><div class="n num">${pad(i + 1)}</div><div><b>${esc(f.title)}</b><span>${esc(f.text)}</span></div></div>`).join('')}
  </section>

  <section class="card">
    <div class="card-head"><h2>Meal attendance</h2><span class="aside">days eaten / days served</span></div>
    ${MEALS.map((m) => { const a = s.attendance[m]; return `<div class="hbar" style="--c:var(--m-${m})"><span>${MEAL_LABEL[m]}</span><div class="bar"><i style="width:${(a.rate * 100).toFixed(0)}%"></i></div><span class="val num">${a.taken}/${a.offered}${a.avgKcal ? ` · ~${fmt(a.avgKcal)} kcal` : ''}</span></div>`; }).join('')}
  </section>

  <section class="card">
    <div class="card-head"><h2>Macros per day</h2><span class="aside">average vs target</span></div>
    <div class="stack">${meter('Protein', s.macros.protein, S.targets.protein)}${meter('Carbs', s.macros.carbs, S.targets.carbs)}${meter('Fat', s.macros.fat, S.targets.fat)}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2>By weekday</h2><span class="aside">average kcal</span></div>
    <div class="wk">${[1, 2, 3, 4, 5, 6, 0].map((i) => { const w = s.weekday[i]; return `<div class="col" data-tip="${w.label}: ${w.n ? `${fmt(w.kcal)} kcal average over ${w.n} ${w.n === 1 ? 'day' : 'days'}` : 'no data'}"><span class="v num">${w.n ? fmt(w.kcal) : ''}</span><div class="b" style="height:${w.n ? ((w.kcal / maxWk) * 100).toFixed(0) : 0}%"></div></div>`; }).join('')}</div>
    <div class="wk-l">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<span>${s.weekday[i].label}</span>`).join('')}</div>
  </section>

  ${s.topDishes.length ? `<section class="card">
    <div class="card-head"><h2>Most eaten</h2><span class="aside">times logged</span></div>
    ${s.topDishes.map((d) => `<div class="hbar dish"><span>${esc(d.name)}</span><div class="bar"><i style="width:${((d.count / maxDish) * 100).toFixed(0)}%"></i></div><span class="val num">${d.count}×</span></div>`).join('')}
  </section>` : ''}

  <section class="card">
    <div class="card-head"><h2>Coach review</h2><span class="aside">AI · needs internet</span></div>
    ${coach ? `<div class="coach">${esc(coach)}</div><button class="btn sm" style="margin-top:12px" data-action="coach">Refresh</button>`
      : `<p class="small muted" style="margin-bottom:12px">A written review of this period from your own numbers. Only the summary statistics are sent — never your photos.</p>
         <button class="btn primary block" data-action="coach">${ICONS.sparkle} Write my review</button>`}
  </section>

  <button class="btn primary block" data-action="export-pdf" style="margin-bottom:10px">${ICONS.download} Export full report as PDF</button>
  <button class="btn block" data-action="export-csv">${ICONS.download} Export this period as CSV</button>`;
}

const MACRO_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

async function viewDay() {
  const key = S.dayKey || dateKey(S.now);
  const date = parseDateKey(key);
  const entries = await db.logs.forDate(key);
  const from = dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7));
  const until = dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
  const prior = await db.logs.range(from, until);
  const calc = computeTargets(S.profile);
  const offered = {};
  for (const meal of MEALS) {
    const plan = entries.find((e) => e.meal === meal)?.plan || S.prefs.plan;
    offered[meal] = (menuItems(date, plan, meal) || []).filter((i) => !i.off).map((i) => ({ line: i.line, est: i.est }));
  }
  const r = dayReport({ entries, dateK: key, now: S.now, targets: S.targets, tdee: calc?.tdee || null, weightKg: S.profile.weightKg || null, times: S.times, offered, prior });
  const t = r.totals;
  const scaleMax = S.targets.kcal * 1.25;
  const prev = dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
  const next = dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
  const head = `<header class="top"><a class="icon-btn" href="#${r.isToday ? 'today' : 'journal'}" aria-label="Close">${ICONS.x}</a>
    <div class="brand"><div class="grow"><h1>Day statement</h1><div class="sub">${date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div></div>
    <a class="icon-btn" href="#day/${prev}" aria-label="Previous day">${ICONS.left}</a>
    ${next <= dateKey(S.now) ? `<a class="icon-btn" href="#day/${next}" aria-label="Next day">${ICONS.right}</a>` : ''}</header>`;

  if (!r.entries) {
    return `${head}<section class="card"><div class="empty">— nothing logged on this day —</div>
      ${key <= dateKey(S.now) ? `<div class="chips" style="justify-content:center">${MEALS.map((m) => `<button class="chip" data-action="log" data-mode="menu" data-meal="${m}" data-date="${key}" style="--c:var(--m-${m})"><span class="dot"></span>${MEAL_LABEL[m]}</button>`).join('')}</div>` : ''}</section>`;
  }

  const maxGroup = Math.max(1, ...r.groups.map((g) => g.kcal));
  const review = S.coach[`day:${key}`];
  const stateWord = { eaten: 'Eaten', missed: 'Missed', upcoming: 'To come', pending: 'Photo pending' };

  return `${head}
  <section class="coupon">
    <div class="cp-top"><span>Daily statement</span><span>${r.entries} ${r.entries === 1 ? 'entry' : 'entries'} · ${r.items.length} items</span></div>
    <div class="cp-main">
      <div class="cp-fig">
        <div class="big num">${fmt(t.kcal)}</div>
        <div class="unit"><b>kcal</b>of ${fmt(S.targets.kcal)} target</div>
        <div class="stamp verdict">${r.verdict}</div>
      </div>
      <div class="scale ${r.ratio > 1.1 ? 'over' : ''}"><i style="width:${Math.min(100, (t.kcal / scaleMax) * 100).toFixed(1)}%"></i><u></u></div>
      <div class="scale-lab"><span>0</span><span>Target</span><span>${fmt(scaleMax)}</span></div>
      ${dayline({ now: S.now, times: S.times, mealKcal: t.meals, showNow: r.isToday })}
    </div>
  </section>

  <div class="tiles">
    <div class="tile"><div class="eyebrow">Against target</div><div class="v num">${signed(r.balance)}<small> kcal</small></div><div class="d">${Math.round(r.ratio * 100)}% of ${fmt(S.targets.kcal)}</div></div>
    <div class="tile"><div class="eyebrow">Against maintenance</div><div class="v num">${r.vsMaintenance == null ? '—' : signed(r.vsMaintenance)}<small>${r.vsMaintenance == null ? '' : ' kcal'}</small></div><div class="d">${r.vsMaintenance == null ? '<a class="link" href="#settings">Add height and weight</a>' : `≈ ${r.weeklyKg > 0 ? '+' : r.weeklyKg < 0 ? '−' : ''}${Math.abs(r.weeklyKg).toFixed(2)} kg a week if every day looked like this`}</div></div>
    <div class="tile"><div class="eyebrow">Protein</div><div class="v num">${fmt(t.protein)}<small> g</small></div><div class="d">${r.proteinPerKg ? `${r.proteinPerKg.toFixed(1)} g per kg · ` : ''}target ${fmt(S.targets.protein)} g</div></div>
    <div class="tile"><div class="eyebrow">Eating window</div><div class="v num">${r.clock.length > 1 ? formatDuration(r.eatingWindow) : '—'}</div><div class="d">${r.clock.length ? `${r.clock[0].at} → ${r.clock[r.clock.length - 1].at}` : ''}${r.longestGap ? ` · longest gap ${formatDuration(r.longestGap)}` : ''}</div></div>
  </div>

  <section class="card">
    <div class="card-head"><h2>Meal by meal</h2><span class="aside">share of the day</span></div>
    <div class="stackbar">${r.meals.filter((m) => m.kcal).map((m) => `<i style="width:${(m.share * 100).toFixed(1)}%;--c:var(--m-${m.meal})" data-tip="${MEAL_LABEL[m.meal]}: ${fmt(m.kcal)} kcal (${Math.round(m.share * 100)}%)"></i>`).join('')}</div>
    <table class="data" style="margin-top:12px"><thead><tr><th>Meal</th><th>kcal</th><th>%</th><th>P</th><th>C</th><th>F</th></tr></thead><tbody>
      ${r.meals.map((m) => `<tr><td><span class="sq" style="--c:var(--m-${m.meal})"></span><b>${MEAL_LABEL[m.meal]}</b><br><span class="muted">${m.state === 'eaten' ? `${new Date(m.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · ${m.items} items` : stateWord[m.state]}</span></td>
        <td>${m.kcal ? fmt(m.kcal) : '–'}</td><td>${m.kcal ? Math.round(m.share * 100) : '–'}</td><td>${m.kcal ? fmt(m.protein) : '–'}</td><td>${m.kcal ? fmt(m.carbs) : '–'}</td><td>${m.kcal ? fmt(m.fat) : '–'}</td></tr>`).join('')}
      <tr class="sum"><td><b>Total</b></td><td>${fmt(t.kcal)}</td><td>100</td><td>${fmt(t.protein)}</td><td>${fmt(t.carbs)}</td><td>${fmt(t.fat)}</td></tr>
    </tbody></table>
  </section>

  <section class="card">
    <div class="card-head"><h2>Macro split</h2><span class="aside">% of energy</span></div>
    <div class="stack">${Object.entries(r.split).map(([k, v]) => `<div class="macro">
      <div class="lab"><b>${MACRO_LABEL[k]}</b><span class="num">${fmt(v.grams)} g · ${fmt(v.kcal)} kcal · <b class="${v.verdict}">${Math.round(v.pct)}%</b></span></div>
      <div class="rangebar"><i style="width:${Math.min(100, v.pct).toFixed(1)}%"></i><u style="left:${v.lo}%;width:${v.hi - v.lo}%"></u></div>
      <div class="rl">usual range ${v.lo}–${v.hi}% · ${v.verdict === 'ok' ? 'within range' : v.verdict === 'low' ? 'below range' : 'above range'} · target ${fmt(S.targets[k])} g</div></div>`).join('')}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Food groups</h2><span class="aside">where the kcal came from</span></div>
    ${r.groups.map((g) => `<div class="hbar dish"><span>${esc(g.name)}</span><div class="bar"><i style="width:${((g.kcal / maxGroup) * 100).toFixed(0)}%"></i></div><span class="val num">${fmt(g.kcal)} · ${Math.round(g.share * 100)}%</span></div>`).join('')}
  </section>

  <section class="card">
    <div class="card-head"><h2>Itemised</h2><span class="aside">largest first</span></div>
    <table class="data"><thead><tr><th>Item</th><th>kcal</th><th>%</th><th>P</th><th>C</th><th>F</th></tr></thead><tbody>
      ${r.items.map((i) => `<tr><td><span class="sq" style="--c:var(--m-${i.meal})"></span>${esc(i.name)}${i.portion ? `<br><span class="muted">${esc(i.portion)}${i.qty && i.qty !== 1 ? ` × ${i.qty}` : ''}</span>` : ''}</td><td><b>${fmt(i.kcal)}</b></td><td>${Math.round(i.share * 100)}</td><td>${fmt(i.protein)}</td><td>${fmt(i.carbs)}</td><td>${fmt(i.fat)}</td></tr>`).join('')}
    </tbody></table>
  </section>

  <section class="card">
    <div class="card-head"><h2>Clock</h2><span class="aside">when you ate</span></div>
    ${r.clock.map((c) => `${c.gap != null ? `<div class="gap">${formatDuration(c.gap)} gap</div>` : ''}<div class="tick-row" style="--c:var(--m-${c.meal})"><span class="at num">${c.at}</span><span class="sq"></span><b>${MEAL_LABEL[c.meal]}</b><span class="num">${fmt(c.kcal)} kcal</span></div>`).join('')}
  </section>

  ${r.notes.length ? `<section class="card">
    <div class="card-head"><h2>What stands out</h2><span class="aside">${r.notes.length} notes</span></div>
    ${r.notes.map((f, i) => `<div class="finding"><div class="n num">${pad(i + 1)}</div><div><b>${esc(f.title)}</b><span>${esc(f.text)}</span></div></div>`).join('')}
  </section>` : ''}

  ${r.recent ? `<section class="card">
    <div class="card-head"><h2>Against your week</h2><span class="aside">last ${r.recent.n} logged ${r.recent.n === 1 ? 'day' : 'days'}</span></div>
    ${[['Calories · this day', t.kcal, 'kcal'], ['Calories · average', r.recent.kcal, 'kcal'], ['Protein · this day', t.protein, 'g'], ['Protein · average', r.recent.protein, 'g']].map(([label, value, unit], i) => {
      const max = i < 2 ? Math.max(t.kcal, r.recent.kcal, 1) : Math.max(t.protein, r.recent.protein, 1);
      return `<div class="hbar dish"><span>${label}</span><div class="bar"><i style="width:${((value / max) * 100).toFixed(0)}%"></i></div><span class="val num">${fmt(value)} ${unit}</span></div>`;
    }).join('')}
  </section>` : ''}

  <section class="card">
    <div class="card-head"><h2>Written review</h2><span class="aside">AI · needs internet</span></div>
    ${review ? `<div class="coach">${esc(review)}</div><button class="btn sm" style="margin-top:12px" data-action="day-review">Rewrite</button>`
      : `<p class="small muted" style="margin-bottom:12px">A written review of this day from the numbers above. Only the figures are sent — never your photos.</p>
         <button class="btn primary block" data-action="day-review">${ICONS.sparkle} Review this day</button>`}
  </section>
  <button class="btn block" data-action="export-day-pdf" style="margin-bottom:12px">${ICONS.download} Export this day as PDF</button>
  <p class="small muted" style="text-align:center">All figures are estimates.</p>`;
}

function viewSettings() {
  const p = S.profile;
  const calc = computeTargets(p);
  const sel = (name, options, value) => `<select data-set="${name}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const menus = [...S.menus.values()].sort((a, b) => a.key.localeCompare(b.key));
  return `<header class="top"><a class="icon-btn" href="#today" aria-label="Back">${ICONS.left}</a><div class="brand"><div class="grow"><h1>Settings</h1><div class="sub">Everything is stored on this device</div></div></div></header>

  <div class="set-group"><h3>You</h3><section class="card stack">
    <div class="grid2">
      <label class="field">Sex${sel('profile.sex', [['male', 'Male'], ['female', 'Female']], p.sex || 'male')}</label>
      <label class="field">Age<input type="number" inputmode="numeric" data-set="profile.age" value="${p.age || ''}" placeholder="years"></label>
      <label class="field">Height (cm)<input type="number" inputmode="decimal" data-set="profile.heightCm" value="${p.heightCm || ''}"></label>
      <label class="field">Weight (kg)<input type="number" inputmode="decimal" data-set="profile.weightKg" value="${p.weightKg || ''}"></label>
    </div>
    <label class="field">Activity${sel('profile.activity', [['sedentary', 'Mostly sitting'], ['light', 'Light — walking to class'], ['moderate', 'Moderate — sport 3-5×/week'], ['active', 'Very active — daily training']], p.activity || 'light')}</label>
    <label class="field">Goal${sel('profile.goal', [['lose', 'Lose weight'], ['maintain', 'Maintain'], ['gain', 'Gain weight']], p.goal || 'maintain')}</label>
    ${calc ? `<div class="note">Resting burn ≈ ${fmt(calc.bmr)} kcal · maintenance ≈ ${fmt(calc.tdee)} kcal · suggested target ${fmt(calc.kcal)} kcal. Estimates from the Mifflin–St Jeor equation, not medical advice.</div>` : '<div class="note">Fill in age, height and weight to get a calculated calorie target.</div>'}
  </section></div>

  <div class="set-group"><h3>Daily targets</h3><section class="card stack">
    <div class="grid2">
      <label class="field">Calories (kcal)<input type="number" inputmode="numeric" data-set="targets.kcal" value="${S.targets.kcal}"></label>
      <label class="field">Protein (g)<input type="number" inputmode="numeric" data-set="targets.protein" value="${S.targets.protein}"></label>
      <label class="field">Carbs (g)<input type="number" inputmode="numeric" data-set="targets.carbs" value="${S.targets.carbs}"></label>
      <label class="field">Fat (g)<input type="number" inputmode="numeric" data-set="targets.fat" value="${S.targets.fat}"></label>
    </div>
    ${S.targets.manual && calc ? '<button class="link" data-action="targets-auto" style="justify-self:start">Use the calculated targets instead</button>' : ''}
  </section></div>

  <div class="set-group"><h3>Mess</h3><section class="card stack">
    <label class="field">I eat${seg('set-diet', [['nonveg', 'Veg + Non-veg'], ['veg', 'Veg only']], S.prefs.diet)}</label>
    <label class="field">Default menu${seg('set-plan', [['regular', PLAN_LABEL.regular], ['special', PLAN_LABEL.special]], S.prefs.plan)}</label>
    <div class="small muted">Meal timings — the app shows the meal for the current time.</div>
    ${MEALS.map((m) => `<div class="grid3" style="align-items:center"><b style="color:var(--ink)">${MEAL_LABEL[m]}</b>
      <input type="time" data-set="times.${m}.0" value="${S.times[m][0]}" aria-label="${MEAL_LABEL[m]} starts">
      <input type="time" data-set="times.${m}.1" value="${S.times[m][1]}" aria-label="${MEAL_LABEL[m]} ends"></div>`).join('')}
    <div class="small muted">Loaded menus</div>
    ${menus.map((m) => `<div class="row"><span class="grow"><b>${esc(m.label)}</b><br><span class="small muted">${Object.keys(m.plans).map((k) => PLAN_LABEL[k]).join(' + ')}</span></span><button class="icon-btn" data-action="remove-menu" data-value="${m.key}" aria-label="Remove ${esc(m.label)}">${ICONS.trash}</button></div>`).join('') || '<div class="small muted">None yet.</div>'}
    <button class="btn" data-action="import-menu">${ICONS.upload} Import menu Excel</button>
  </section></div>

  <div class="set-group"><h3>Photo calorie estimates</h3><section class="card stack">
    <div class="note">Add a key for one or more services. If the first one fails or runs out of quota, the app moves on to the next automatically. Keys stay on this device and are sent only to their own service. Without any key, tick-from-menu logging still works fully offline.</div>
    <label class="field">Try first${sel('ai.first', ai.PROVIDER_IDS.map((id) => [id, ai.PROVIDERS[id].label]), S.ai.first)}</label>
    ${ai.PROVIDER_IDS.map((id) => {
      const p = ai.PROVIDERS[id];
      const st = S.aiStatus[id];
      return `<div class="provider ${S.ai.keys[id] ? 'has-key' : ''}">
        <div class="row"><b class="grow">${p.label}</b><span class="pstatus ${st ? (st.ok ? 'ok' : 'bad') : ''}">${st ? esc(st.text) : S.ai.keys[id] ? 'Key saved' : 'No key'}</span></div>
        <label class="field">API key<input type="password" data-set="ai.keys.${id}" value="${esc(S.ai.keys[id])}" placeholder="Paste your ${p.label} key" autocomplete="off" spellcheck="false"></label>
        <label class="field">Model<input type="text" list="models-${id}" data-set="ai.models.${id}" value="${esc(S.ai.models[id] || p.models[0])}" spellcheck="false"><datalist id="models-${id}">${p.models.map((m) => `<option value="${m}">`).join('')}</datalist></label>
        <div class="row"><span class="small muted grow">Get a key at ${p.keyUrl.replace('https://', '')}</span><button class="btn sm" data-action="test-key" data-value="${id}">Test</button></div>
      </div>`;
    }).join('')}
    <button class="btn" data-action="test-all-keys">Test all keys</button>
  </section></div>

  <div class="set-group"><h3>Appearance</h3><section class="card">${seg('set-theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], S.prefs.theme)}</section></div>

  <div class="set-group"><h3>Your data</h3><section class="card stack">
    <div class="small muted" id="storage-line">Stored on this device only.</div>
    <div class="btn-row"><button class="btn" data-action="backup">${ICONS.download} Backup</button><button class="btn" data-action="restore">${ICONS.upload} Restore</button></div>
    <button class="btn" data-action="export-all-pdf">${ICONS.download} Full report of everything as PDF</button>
    <button class="btn" data-action="export-all-csv">${ICONS.download} Export all logs as CSV</button>
    <button class="btn danger" data-action="wipe">${ICONS.trash} Delete all logs</button>
  </section></div>

  ${S.installEvt ? `<div class="set-group"><h3>Install</h3><section class="card"><button class="btn primary block" data-action="install">${ICONS.download} Install Annamaya on this device</button></section></div>` : ''}
  <p class="small muted" style="text-align:center">Annamaya ${VERSION} · calorie figures are estimates</p>`;
}

const VIEWS = { today: viewToday, menu: viewMenu, journal: viewJournal, insights: viewInsights, settings: viewSettings, day: viewDay };
let renderSeq = 0;

export async function render({ animate = false } = {}) {
  const seq = ++renderSeq;
  const view = $('#view');
  const html = await VIEWS[S.tab]();
  if (seq !== renderSeq) return;
  view.innerHTML = html;
  view.classList.toggle('view-in', animate);
  for (const a of $$('#nav a')) a.toggleAttribute('aria-current', false);
  const current = $(`#nav a[data-tab="${S.tab}"]`);
  if (current) current.setAttribute('aria-current', 'page');
  hydratePhotos(view);
  fx.countUp(view);
  tickLive();
  if (S.tab === 'menu') $('#daystrip [aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  if (S.tab === 'settings') showStorage();
}

function route() {
  const [tab, arg] = (location.hash.replace('#', '') || 'today').split('/');
  if (tab === 'day') S.dayKey = /^\d{4}-\d\d-\d\d$/.test(arg || '') ? arg : dateKey(S.now);
  S.tab = VIEWS[tab] ? tab : 'today';
  closeSheet({ rerender: false });
  window.scrollTo(0, 0);
  render({ animate: true });
}

const clock = (secs) => {
  const s = Math.max(0, secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

function tickLive() {
  const el = $('[data-live]');
  if (!el) return;
  const now = new Date();
  const cm = currentMeal(now, S.times);
  const secs = cm.minutes * 60 - now.getSeconds();
  el.textContent = clock(secs);
  const bar = $('[data-live-bar]');
  if (bar && cm.state === 'now') bar.style.width = `${Math.min(100, (1 - secs / ((cm.window.end - cm.window.start) * 60)) * 100).toFixed(2)}%`;
}

async function showStorage() {
  const el = $('#storage-line');
  if (!el || !navigator.storage?.estimate) return;
  const { usage = 0 } = await navigator.storage.estimate();
  const count = (await db.logs.all()).length;
  el.textContent = `${count} log ${count === 1 ? 'entry' : 'entries'} · ${(usage / 1048576).toFixed(1)} MB used on this device.`;
}

function applyTheme() {
  const t = S.prefs.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('annamaya.theme', t);
  } catch {}
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of $$('meta[name="theme-color"]')) m.content = dark ? '#141210' : '#f1e7d6';
  if (NATIVE) window.AnnamayaNative.setBars(dark);
}

function recalcTargets() {
  if (S.targets.manual) return;
  const calc = computeTargets(S.profile);
  if (calc) S.targets = { kcal: calc.kcal, protein: calc.protein, carbs: calc.carbs, fat: calc.fat, manual: false };
}

async function saveSetting(path, raw) {
  const [group, key, idx] = path.split('.');
  if (group === 'profile') {
    S.profile[key] = ['age', 'heightCm', 'weightKg'].includes(key) ? Number(raw) || null : raw;
    recalcTargets();
    await db.kv.set('profile', S.profile);
    await db.kv.set('targets', S.targets);
  } else if (group === 'targets') {
    const n = Math.round(Number(raw));
    if (!n || n < 0) return toast('Enter a positive number.');
    S.targets[key] = n;
    S.targets.manual = true;
    await db.kv.set('targets', S.targets);
  } else if (group === 'times') {
    if (!/^\d\d:\d\d$/.test(raw)) return;
    const next = [...S.times[key]];
    next[Number(idx)] = raw;
    if (next[0] >= next[1]) return toast('A meal must end after it starts.');
    S.times[key] = next;
    await db.kv.set('times', S.times);
  } else if (group === 'ai') {
    if (key === 'first') S.ai.first = raw;
    else S.ai[key][idx] = raw.trim();
    delete S.aiStatus[idx];
    await db.kv.set('ai', S.ai);
  }
  if (group !== 'ai' || key === 'keys') render();
}

async function importMenuFile(file) {
  try {
    const wb = await readXlsx(await file.arrayBuffer());
    const menu = parseMenuWorkbook(wb, { fileName: file.name, now: S.now });
    await db.menus.put(menu);
    S.menus.set(menu.key, menu);
    const days = Object.keys(menu.plans.regular.days).length;
    toast(`Loaded ${menu.label} — ${days} days, ${Object.keys(menu.plans).length} menu${Object.keys(menu.plans).length > 1 ? 's' : ''}`, 3800);
    if (menu.warnings.length) console.warn('Menu import warnings', menu.warnings);
    S.menuDate = menu.key === monthKey(S.now) ? S.now : new Date(menu.year, menu.month - 1, 1);
    render();
  } catch (err) {
    toast(err.message || 'That file could not be read.', 4200);
  }
}

export function pickFile(accept, { capture } = {}) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    if (capture) input.setAttribute('capture', capture);
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

async function loadBundledMenus() {
  const done = await db.kv.get('bundled.v2', []);
  for (const path of BUNDLED_MENUS) {
    if (done.includes(path)) continue;
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const menu = parseMenuWorkbook(await readXlsx(await res.arrayBuffer()), { fileName: path.split('/').pop(), now: S.now });
      await db.menus.put(menu);
      done.push(path);
    } catch (err) {
      console.warn('Could not load bundled menu', path, err);
    }
  }
  await db.kv.set('bundled.v2', done);
  for (const m of await db.menus.all()) S.menus.set(m.key, m);
}

async function exportPdf(from, to, periodName = '', coachText = '') {
  toast('Preparing your PDF…', 6000);
  const logs = await db.logs.all();
  const calc = computeTargets(S.profile);
  const { manual, ...targets } = S.targets;
  const { bytes, name, pages } = await buildReport({
    logs, from, to, now: S.now, targets, profile: S.profile, tdee: calc?.tdee || null, times: S.times, periodName, coachText,
    offeredFor: (date, plan, meal) => (menuItems(date, plan || S.prefs.plan, meal) || []).filter((i) => !i.off).map((i) => ({ line: i.line, est: i.est })),
  });
  await download(name, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf');
  if (!NATIVE) toast(`PDF ready · ${pages} ${pages === 1 ? 'page' : 'pages'}`);
}

function toCsv(logs) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'meal', 'source', 'item', 'portion', 'kcal', 'protein_g', 'carbs_g', 'fat_g']];
  for (const e of [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts)) {
    for (const i of e.items || []) rows.push([e.date, e.meal, e.source, i.name, i.portion || (i.qty ? `${i.qty}×` : ''), i.kcal, i.protein, i.carbs, i.fat]);
  }
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}

const ACTIONS = {
  'cycle-theme': async () => {
    S.prefs.theme = { auto: 'light', light: 'dark', dark: 'auto' }[S.prefs.theme];
    applyTheme();
    await db.kv.set('prefs', S.prefs);
    toast(`Theme: ${S.prefs.theme}`);
    render();
  },
  'set-theme': async (el) => {
    S.prefs.theme = el.dataset.value;
    applyTheme();
    await db.kv.set('prefs', S.prefs);
    render();
  },
  'set-diet': async (el) => {
    S.prefs.diet = el.dataset.value;
    await db.kv.set('prefs', S.prefs);
    render();
  },
  'set-plan': async (el) => {
    S.prefs.plan = el.dataset.value;
    S.todayPlan = S.menuPlan = null;
    await db.kv.set('prefs', S.prefs);
    render();
  },
  'focus-meal': (el) => {
    S.focus = { meal: el.dataset.value };
    render();
  },
  'focus-auto': () => {
    S.focus = null;
    render();
  },
  'today-plan': (el) => {
    S.todayPlan = el.dataset.value;
    render();
  },
  'menu-plan': (el) => {
    S.menuPlan = el.dataset.value;
    render();
  },
  'menu-day': (el) => {
    S.menuDate = parseDateKey(el.dataset.value);
    render();
  },
  log: (el) => {
    const date = el.dataset.date ? parseDateKey(el.dataset.date) : S.now;
    openLog({ date, meal: el.dataset.meal, mode: el.dataset.mode, plan: S.tab === 'menu' ? S.menuPlan || S.prefs.plan : S.todayPlan || S.prefs.plan });
  },
  'open-entry': (el) => openEntry(el.dataset.id),
  'open-day': (el) => openDay(el.dataset.value),
  water: async (el) => {
    const key = dateKey(S.now);
    const day = await db.days.get(key);
    const n = Number(el.dataset.value);
    day.water = day.water === n ? n - 1 : n;
    await db.days.put(day);
    render();
  },
  'journal-prev': () => {
    const b = S.journalMonth || new Date(S.now.getFullYear(), S.now.getMonth(), 1);
    S.journalMonth = new Date(b.getFullYear(), b.getMonth() - 1, 1);
    render();
  },
  'journal-next': () => {
    const b = S.journalMonth || new Date(S.now.getFullYear(), S.now.getMonth(), 1);
    S.journalMonth = new Date(b.getFullYear(), b.getMonth() + 1, 1);
    render();
  },
  range: (el) => {
    S.range = el.dataset.value;
    render();
  },
  'toggle-table': () => {
    S.showTable = !S.showTable;
    render();
  },
  'import-menu': async () => {
    const file = await pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (file) importMenuFile(file);
  },
  'remove-menu': async (el) => {
    if (!confirm('Remove this month\'s menu? Your logs are kept.')) return;
    await db.menus.remove(el.dataset.value);
    S.menus.delete(el.dataset.value);
    render();
  },
  'targets-auto': async () => {
    S.targets.manual = false;
    recalcTargets();
    await db.kv.set('targets', S.targets);
    render();
  },
  'test-key': async (el) => {
    await testKey(el.dataset.value);
    render();
  },
  'test-all-keys': async (el) => {
    el.disabled = true;
    el.textContent = 'Testing…';
    for (const id of ai.PROVIDER_IDS) await testKey(id);
    render();
  },
  coach: async (el) => {
    const { from, to, label } = rangeBounds();
    el.disabled = true;
    el.textContent = 'Writing your review…';
    try {
      const s = summarise({ logs: await db.logs.all(), from, to, now: S.now, targets: S.targets, times: S.times });
      const { manual, ...targets } = S.targets;
      S.coach[`${from}:${to}`] = await ai.coachReport(S.ai, coachPayload(s, targets, label));
      await db.kv.set('coach', S.coach);
    } catch (err) {
      toast(err.message, 5000);
    }
    render();
  },
  'day-review': async (el) => {
    const key = S.dayKey;
    el.disabled = true;
    el.textContent = 'Reading your day…';
    try {
      const date = parseDateKey(key);
      const entries = await db.logs.forDate(key);
      const prior = await db.logs.range(dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7)), dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)));
      const calc = computeTargets(S.profile);
      const offered = {};
      for (const meal of MEALS) offered[meal] = (menuItems(date, entries.find((e) => e.meal === meal)?.plan || S.prefs.plan, meal) || []).filter((i) => !i.off).map((i) => ({ line: i.line, est: i.est }));
      const r = dayReport({ entries, dateK: key, now: S.now, targets: S.targets, tdee: calc?.tdee || null, weightKg: S.profile.weightKg || null, times: S.times, offered, prior });
      const { manual, ...targets } = S.targets;
      S.coach[`day:${key}`] = await ai.dayReview(S.ai, dayPayload(r, targets));
      await db.kv.set('coach', S.coach);
    } catch (err) {
      toast(err.message, 5000);
    }
    render();
  },
  'export-pdf': async () => {
    const { from, to, label } = rangeBounds();
    const first = (await db.logs.all()).map((e) => e.date).sort()[0];
    const start = first && first > from ? first : from;
    await exportPdf(start > to ? to : start, to, label, S.coach[`${from}:${to}`] || '').catch((err) => toast(err.message || 'Could not build the PDF.', 5000));
  },
  'export-day-pdf': async () => {
    const key = S.dayKey || dateKey(S.now);
    await exportPdf(key, key, '', S.coach[`day:${key}`] || '').catch((err) => toast(err.message || 'Could not build the PDF.', 5000));
  },
  'export-all-pdf': async () => {
    const dates = (await db.logs.all()).map((e) => e.date).sort();
    if (!dates.length) return toast('Nothing logged yet.');
    await exportPdf(dates[0], dateKey(S.now), 'All time').catch((err) => toast(err.message || 'Could not build the PDF.', 5000));
  },
  'export-csv': async () => {
    const { from, to } = rangeBounds();
    const logs = (await db.logs.all()).filter((e) => e.date >= from && e.date <= to);
    download(`annamaya-${from}-to-${to}.csv`, toCsv(logs), 'text/csv');
  },
  'export-all-csv': async () => download(`annamaya-all-${dateKey(S.now)}.csv`, toCsv(await db.logs.all()), 'text/csv'),
  backup: async () => {
    toast('Preparing backup…');
    download(`annamaya-backup-${dateKey(S.now)}.json`, JSON.stringify(await db.exportAll()), 'application/json');
  },
  restore: async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const { logs } = await db.importAll(JSON.parse(await file.text()));
      await loadState();
      toast(`Restored ${logs} log entries.`);
      render();
    } catch (err) {
      toast(err.message || 'That backup could not be read.', 4200);
    }
  },
  wipe: async () => {
    if (!confirm('Delete every logged meal, photo and water record on this device? This cannot be undone.')) return;
    await db.wipeAll();
    toast('All logs deleted.');
    render();
  },
  install: async () => {
    S.installEvt.prompt();
    await S.installEvt.userChoice;
    S.installEvt = null;
    render();
  },
};

function bindEvents() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.closest('#sheet-root')) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) fn(el);
  });
  $('#view').addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.set) saveSetting(el.dataset.set, el.value);
    if (el.dataset.change === 'menu-month') {
      const [y, m] = el.value.split('-').map(Number);
      S.menuDate = el.value === monthKey(S.now) ? S.now : new Date(y, m - 1, 1);
      render();
    }
  });
  $('#fab').addEventListener('click', () => {
    const cm = currentMeal(S.now, S.times);
    openLog({ date: S.now, meal: cm.state === 'tomorrow' ? 'dinner' : cm.meal, mode: 'photo', plan: S.prefs.plan });
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => {
    processPending();
    if (S.tab === 'today') render();
  });
  window.addEventListener('offline', () => S.tab === 'today' && render());
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    S.installEvt = ev;
    if (S.tab === 'settings') render();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  const tip = $('#tip');
  const place = (ev) => {
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, ev.clientX - r.width / 2))}px`;
    tip.style.top = `${Math.max(8, ev.clientY - r.height - 14)}px`;
  };
  document.addEventListener('pointermove', (ev) => {
    const el = ev.target.closest?.('[data-tip]');
    if (!el) return tip.classList.remove('show');
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    place(ev);
  });
  document.addEventListener('pointerdown', (ev) => {
    const el = ev.target.closest?.('[data-tip]');
    if (!el) return tip.classList.remove('show');
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    place(ev);
    if (el.dataset.meal && S.tab === 'today') ACTIONS['focus-meal']({ dataset: { value: el.dataset.meal } });
  });
  document.addEventListener('scroll', () => tip.classList.remove('show'), true);

  setInterval(tickLive, 1000);
  setInterval(() => {
    S.now = new Date();
    if (S.tab === 'today' && !$('#sheet-root').children.length && document.visibilityState === 'visible') render();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      S.now = new Date();
      render();
    }
  });
}

window.__annamayaBack = () => {
  if ($('#sheet-root').children.length) {
    closeSheet();
    return true;
  }
  if (S.tab !== 'today') {
    location.hash = '#today';
    return true;
  }
  return false;
};

async function testKey(id) {
  if (!(S.ai.keys[id] || '').trim()) {
    delete S.aiStatus[id];
    return;
  }
  S.aiStatus[id] = { ok: false, text: 'Testing…' };
  try {
    await ai.ping(S.ai, id);
    S.aiStatus[id] = { ok: true, text: 'Working' };
  } catch (err) {
    S.aiStatus[id] = { ok: false, text: err.message };
  }
}

async function loadState() {
  S.prefs = { ...S.prefs, ...(await db.kv.get('prefs', {})) };
  S.profile = await db.kv.get('profile', {});
  S.targets = { ...S.targets, ...(await db.kv.get('targets', {})) };
  S.times = { ...structuredClone(DEFAULT_TIMES), ...(await db.kv.get('times', {})) };
  S.ai = ai.normaliseConfig(await db.kv.get('ai', null));
  S.coach = await db.kv.get('coach', {});
}

async function boot() {
  for (const el of $$('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon];
  const started = performance.now();
  await loadState();
  applyTheme();
  await loadBundledMenus();
  bindEvents();
  route();
  db.requestPersistence();
  if (!NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  await new Promise((r) => setTimeout(r, Math.max(0, (reduce ? 400 : 2550) - (performance.now() - started))));
  const splash = $('#splash');
  splash.classList.add('out');
  setTimeout(() => splash.remove(), 700);
  processPending();
}

boot().catch((err) => {
  console.error(err);
  $('#splash')?.remove();
  $('#view').innerHTML = `<div class="card"><h2>Annamaya could not start</h2><p class="small muted" style="margin-top:8px">${esc(err.message)}</p></div>`;
});
