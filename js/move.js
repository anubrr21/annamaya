import { S, $, esc, fmt, toast, render, NATIVE, topBar, headerButtons, seg, meter, updateProfile } from './app.js';
import { sheet, closeSheet } from './log.js';
import { dateKey, parseDateKey, formatDuration, pad } from './menu.js';
import { dayTotals } from './insights.js';
import { ICONS } from './charts.js';
import * as db from './db.js';
import * as motion from './activity.js';
import { WORKOUTS, WORKOUT, INTENSITY, needs, ready, workoutKcal, trend, KCAL_PER_KG, stepLengthM, GOALS } from './body.js';
import { stamp, haptic } from './fx.js';

export const MOVE_DEFAULTS = { stepGoal: 8000, active: null };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
const km = (n) => (n >= 10 ? n.toFixed(1) : n.toFixed(2));
const shortDay = (k) => parseDateKey(k).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const addDays = (k, n) => {
  const d = parseDateKey(k);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};

let pendingRender = null;
function softRender() {
  if (pendingRender) return;
  pendingRender = setTimeout(async () => {
    pendingRender = null;
    if (!['move', 'today'].includes(S.tab) || $('#sheet-root').children.length || document.visibilityState !== 'visible') return;
    await motion.sync();
    render();
  }, 3000);
}

export function initMove() {
  window.__annamayaStep = () => softRender();
  window.__annamayaMotion = async () => {
    await motion.sync({ full: true });
    render();
  };
  if (motion.nativeMotion()) {
    motion.sync({ full: true }).then(() => {
      if (['move', 'today', 'insights'].includes(S.tab) && !$('#sheet-root').children.length) render();
    });
  }
}

export function onResumeMove() {
  if (!motion.nativeMotion()) return;
  motion.refresh();
}

async function maybeSync() {
  if (!motion.nativeMotion()) return;
  if (Date.now() - motion.lastSyncedAt() > 20000) await motion.sync({ full: motion.lastSyncedAt() === 0 });
}

const clock = (secs) => {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

export function tickMove() {
  const el = $('[data-workout-timer]');
  if (el && S.move.active) el.textContent = clock((Date.now() - S.move.active.start) / 1000);
}

function niceMax(v) {
  const steps = [1, 2, 2.5, 5, 10];
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  for (const s of steps) if (s * mag >= v) return s * mag;
  return 10 * mag;
}
const short = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));

function barsSvg(values, { width = 320, height = 120, goal = null, goalLabel = 'Goal', labels = [], tips = [], highlight = -1 } = {}) {
  const W = Math.max(260, width);
  const H = height;
  const p = { l: 30, r: 6, t: 14, b: 18 };
  const max = niceMax(Math.max(goal ? goal * 1.12 : 0, ...values, 1));
  const ph = H - p.t - p.b;
  const y = (v) => p.t + ph - (v / max) * ph;
  const slot = (W - p.l - p.r) / Math.max(1, values.length);
  const bw = Math.max(2, Math.min(22, slot * 0.7));
  let grid = '';
  for (let i = 0; i <= 2; i++) {
    const v = (max / 2) * i;
    grid += `<line class="grid" x1="${p.l}" x2="${W - p.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="axis" x="${p.l - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${short(v)}</text>`;
  }
  const bars = values.map((v, i) => {
    const x = p.l + i * slot + (slot - bw) / 2;
    const h = Math.max(v > 0 ? 1.5 : 0, y(0) - y(v));
    const lab = labels[i] ? `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(labels[i])}</text>` : '';
    return `<g class="col" data-tip="${esc(tips[i] || '')}"><rect class="hit" x="${(p.l + i * slot).toFixed(1)}" y="${p.t}" width="${slot.toFixed(1)}" height="${ph}"/>
      <rect class="${i === highlight ? 'bar hot' : 'bar'}" x="${x.toFixed(1)}" y="${(y(0) - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>${lab}</g>`;
  }).join('');
  const goalLine = goal ? `<line class="target" x1="${p.l}" x2="${W - p.r}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"/><text class="target-label" x="${W - p.r}" y="${(y(goal) - 4).toFixed(1)}" text-anchor="end">${esc(goalLabel)} ${fmt(goal)}</text>` : '';
  return `<svg class="chart bars" viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}<line class="base" x1="${p.l}" x2="${W - p.r}" y1="${y(0)}" y2="${y(0)}"/>${goalLine}</svg>`;
}

function pairSvg(rows, { width = 320, height = 150 } = {}) {
  const W = Math.max(260, width);
  const H = height;
  const p = { l: 30, r: 6, t: 12, b: 18 };
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => [r.a, r.b])));
  const ph = H - p.t - p.b;
  const y = (v) => p.t + ph - (v / max) * ph;
  const slot = (W - p.l - p.r) / Math.max(1, rows.length);
  const bw = Math.max(2, Math.min(12, slot * 0.36));
  const every = Math.ceil(rows.length / 10);
  let grid = '';
  for (let i = 0; i <= 2; i++) {
    const v = (max / 2) * i;
    grid += `<line class="grid" x1="${p.l}" x2="${W - p.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="axis" x="${p.l - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${short(v)}</text>`;
  }
  const bars = rows.map((r, i) => {
    const x = p.l + i * slot + slot / 2 - bw - 1;
    return `<g class="col" data-tip="${esc(r.tip)}"><rect class="hit" x="${(p.l + i * slot).toFixed(1)}" y="${p.t}" width="${slot.toFixed(1)}" height="${ph}"/>
      <rect class="bar eaten" x="${x.toFixed(1)}" y="${y(r.a).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(r.a)).toFixed(1)}"/>
      <rect class="bar burned" x="${(x + bw + 2).toFixed(1)}" y="${y(r.b).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(r.b)).toFixed(1)}"/>
      ${i % every === 0 ? `<text class="axis" x="${(p.l + i * slot + slot / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(r.label)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="chart bars" viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}<line class="base" x1="${p.l}" x2="${W - p.r}" y1="${y(0)}" y2="${y(0)}"/></svg>`;
}

const chartWidth = () => Math.min(560, document.documentElement.clientWidth) - 66;

async function intakeFor(date) {
  return dayTotals(await db.logs.forDate(date)).kcal;
}

function permissionCard(st) {
  if (!st.native) {
    return `<section class="card note-card"><div class="card-head"><h2>Step counting</h2><span class="aside">app only</span></div>
      <p class="small">Automatic step, distance and stair counting uses your phone's motion sensors, which only the Android app can read. Here you can enter steps from another app (for example Apple Health) and log workouts and weight.</p>
      <button class="btn block" style="margin-top:12px" data-action="manual-steps">${ICONS.plus} Enter today's steps</button></section>`;
  }
  if (!st.stepCounter) {
    return `<section class="card note-card"><div class="card-head"><h2>No step sensor</h2></div>
      <p class="small">This phone does not have a hardware step counter, so steps cannot be counted automatically. You can still enter steps by hand, log workouts and track weight.</p>
      <button class="btn block" style="margin-top:12px" data-action="manual-steps">${ICONS.plus} Enter today's steps</button></section>`;
  }
  if (st.permission === 'granted') return '';
  const blocked = st.permission === 'blocked';
  return `<section class="card note-card"><div class="card-head"><h2>Count your steps</h2><span class="aside">no internet needed</span></div>
    <p class="small">Annamaya reads your phone's built-in step counter. It keeps counting while the app is closed, uses almost no battery, and nothing leaves your phone.</p>
    ${blocked ? '<p class="small" style="margin-top:8px"><b>Permission was turned off.</b> Open settings → Permissions → Physical activity → Allow.</p>' : ''}
    <button class="btn primary block" style="margin-top:12px" data-action="${blocked ? 'move-settings' : 'move-perm'}">${blocked ? 'Open app settings' : 'Allow step counting'}</button></section>`;
}

export async function viewMove() {
  await maybeSync();
  const now = S.now;
  const today = dateKey(now);
  const st = motion.status();
  const intake = await intakeFor(today);
  const e = await motion.dayEnergy(today, { profile: S.profile, intake, now });
  const goal = S.move.stepGoal || 8000;
  const left = goal - e.steps;
  const scaleMax = goal * 1.25;
  const weights = await db.weights.all();
  const latest = weights[weights.length - 1];
  const tr = trend(weights, 30, now);
  const weekStart = addDays(today, -((now.getDay() + 6) % 7));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(weekStart, i);
    week.push({ k, ...motion.effective(await db.activity.get(k)) });
  }
  const maxWeek = Math.max(goal, ...week.map((w) => w.steps));
  const nowHour = now.getHours();
  const prof = ready(S.profile);
  const active = S.move.active;

  return `${topBar('Move', now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }), headerButtons())}
  ${permissionCard(st)}

  <section class="coupon">
    <div class="cp-top"><span>Daily movement slip</span><span>Goal ${fmt(goal)} steps</span></div>
    <div class="cp-main">
      <div class="cp-fig">
        <div class="big num" data-count="${e.steps}" data-count-key="move-steps">${fmt(e.steps)}</div>
        <div class="unit"><b>steps</b>${e.source === 'manual' ? 'entered by hand' : st.native && st.permission === 'granted' ? 'from your phone' : 'today'}</div>
        ${left <= 0 ? '<div class="stamp verdict">Goal met</div>' : `<div class="cp-left">${fmt(left)} to go</div>`}
      </div>
      <div class="scale"><i style="width:${Math.min(100, (e.steps / scaleMax) * 100).toFixed(1)}%"></i><u></u></div>
      <div class="scale-lab"><span>0</span><span>Goal</span><span>${fmt(scaleMax)}</span></div>
      <div class="statgrid">
        <div><span>Distance</span><b class="num">${km(e.km)}</b><small>km</small></div>
        <div><span>Floors</span><b class="num">${fmt(e.floors)}</b><small>${st.barometer || e.source === 'manual' ? 'climbed' : 'no sensor'}</small></div>
        <div><span>Active</span><b class="num">${fmt(e.active)}</b><small>kcal</small></div>
        <div><span>Burned</span><b class="num">${prof ? fmt(e.total) : '—'}</b><small>${prof ? 'kcal so far' : 'add profile'}</small></div>
      </div>
      ${e.hours ? `<div class="eyebrow" style="margin:16px 0 4px">Steps by hour</div>${barsSvg(e.hours, { width: chartWidth(), height: 104, labels: e.hours.map((_, i) => (i % 6 === 0 ? `${i % 12 || 12}${i < 12 ? 'a' : 'p'}` : '')), tips: e.hours.map((v, i) => `${i}:00–${i + 1}:00 · ${fmt(v)} steps`), highlight: nowHour })}` : ''}
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Energy today</h2><span class="aside">${prof ? 'so far' : 'needs your profile'}</span></div>
    ${prof ? `<table class="data energy">
      <tr><td>Resting (BMR, ${Math.round(e.fraction * 100)}% of the day)</td><td>${fmt(e.resting)}</td></tr>
      <tr><td>Digesting food (10% of ${fmt(intake)} eaten)</td><td>${fmt(e.digestion)}</td></tr>
      <tr><td>Walking · ${fmt(e.steps)} steps, ${km(e.km)} km</td><td>${fmt(e.walking)}</td></tr>
      <tr><td>Stairs · ${fmt(e.floors)} floors</td><td>${fmt(e.stairs)}</td></tr>
      <tr><td>Workouts · ${e.workouts.length}</td><td>${fmt(e.exercise)}</td></tr>
      <tr class="sum"><td>Burned so far</td><td>${fmt(e.total)}</td></tr>
      <tr><td>Eaten so far</td><td>${fmt(intake)}</td></tr>
      <tr class="sum"><td>Balance so far</td><td class="${intake - e.total > 0 ? 'pos' : 'neg'}">${signed(intake - e.total)}</td></tr>
    </table>
    <p class="small muted" style="margin-top:10px">If the rest of today is like now, you will burn about <b>${fmt(e.fullDay)} kcal</b> by midnight. <a class="link" href="#day/${today}">Full day statement</a></p>`
      : '<p class="small">Add your age, height and weight in <a class="link" href="#settings">Settings</a> to see calories burned.</p>'}
  </section>

  <section class="card">
    <div class="card-head"><h2>Workouts</h2><span class="aside">${e.workouts.length ? `${e.workouts.length} today · ${fmt(e.exercise)} kcal` : 'none today'}</span></div>
    ${active ? `<div class="live-workout"><div class="grow"><span class="status live">${esc(WORKOUT[active.type]?.label || 'Workout')} · ${active.intensity}</span><b class="num" data-workout-timer>${clock((Date.now() - active.start) / 1000)}</b></div>
      <button class="btn primary" data-action="workout-stop">Stop &amp; save</button></div>` : ''}
    ${e.workouts.map((w) => `<button class="entry" data-action="workout-open" data-id="${w.id}" style="--c:var(--red)"><span class="grow"><span class="ttl"><i></i>${esc(WORKOUT[w.type]?.label || w.type)} <em>${new Date(w.start).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</em></span>
      <span class="sub">${w.minutes} min · ${w.intensity} · MET ${w.met}${w.overlapSteps ? ` · ${fmt(w.overlapSteps)} steps already counted` : ''}</span></span><span class="kc num">${fmt(w.kcal)}</span></button>`).join('')}
    <div class="btn-row" style="margin-top:12px">
      ${active ? '' : `<button class="btn primary" data-action="workout-start">${ICONS.clock} Start workout</button>`}
      <button class="btn" data-action="workout-log" ${active ? 'style="grid-column:1/-1"' : ''}>${ICONS.plus} Log past workout</button>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>This week</h2><span class="aside">steps · goal ${fmt(goal)}</span></div>
    <div class="wk">${week.map((w) => `<div class="col" data-tip="${shortDay(w.k)}: ${fmt(w.steps)} steps"><span class="v num">${w.steps ? short(w.steps) : ''}</span><div class="b ${w.steps >= goal ? 'met' : ''}" style="height:${((w.steps / maxWeek) * 100).toFixed(0)}%"></div></div>`).join('')}</div>
    <div class="wk-l">${week.map((w) => `<span>${DOW[parseDateKey(w.k).getDay()]}</span>`).join('')}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Weight</h2><span class="aside">${latest ? `last logged ${shortDay(latest.date)}` : 'not logged yet'}</span></div>
    ${latest ? `<div class="cp-fig"><div class="big num" style="font-size:54px">${latest.kg.toFixed(1)}</div><div class="unit"><b>kg</b>${tr ? `${tr.perWeek >= 0 ? '+' : '−'}${Math.abs(tr.perWeek).toFixed(2)} kg / week over ${tr.points} entries` : 'log again to see a trend'}</div></div>
      ${weights.length > 1 ? barsSvg(weights.slice(-20).map((w) => w.kg), { width: chartWidth(), height: 90, tips: weights.slice(-20).map((w) => `${shortDay(w.date)}: ${w.kg.toFixed(1)} kg`) }) : ''}` : '<p class="small muted">Weigh yourself at the same time of day, ideally in the morning, for a trend you can trust.</p>'}
    <button class="btn block" style="margin-top:12px" data-action="weight-log">${ICONS.plus} Log weight</button>
  </section>

  ${st.native && st.stepCounter && st.permission === 'granted' ? `<section class="card">
    <div class="card-head"><h2>Continuous tracking</h2><span class="aside">${st.tracking ? 'on' : 'off'}</span></div>
    <p class="small">Steps are always counted in the background. Turn this on to also count <b>floors climbed</b>${st.barometer ? '' : ' (this phone has no barometer, so only steps)'} and get exact hour-by-hour steps. Android shows a small notification while it runs.</p>
    <button class="btn ${st.tracking ? '' : 'primary'} block" style="margin-top:12px" data-action="move-track" data-value="${st.tracking ? 'off' : 'on'}">${st.tracking ? 'Turn off continuous tracking' : 'Turn on continuous tracking'}</button>
  </section>` : ''}

  <button class="btn block" data-action="manual-steps" style="margin-bottom:10px">${ICONS.edit} ${e.source === 'manual' ? 'Edit' : 'Enter or correct'} today's steps by hand</button>
  <p class="small muted" style="text-align:center">Distance uses a step length of ${Math.round(stepLengthM(S.profile) * 100)} cm${S.profile.stepCm ? ' (yours)' : ' from your height'}. Calories are estimates.</p>`;
}

export async function todayMoveStrip() {
  const today = dateKey(S.now);
  const e = await motion.dayEnergy(today, { profile: S.profile, intake: await intakeFor(today), now: S.now });
  if (!e.has && !e.workouts.length && !motion.nativeMotion()) return '';
  return `<a class="movestrip" href="#move"><span class="eyebrow">Move</span><b class="num">${fmt(e.steps)}</b><span>steps</span><span class="dot">·</span><b class="num">${km(e.km)}</b><span>km</span><span class="dot">·</span><b class="num">${fmt(e.floors)}</b><span>floors</span>${ready(S.profile) ? `<span class="dot">·</span><b class="num">${fmt(e.total)}</b><span>kcal burned</span>` : ''}${ICONS.right}</a>`;
}

export async function dayMoveCard(key, intake) {
  const e = await motion.dayEnergy(key, { profile: S.profile, intake, now: S.now });
  if (!e.has && !e.workouts.length) return '';
  const prof = ready(S.profile);
  const burned = e.fraction < 1 ? e.fullDay : e.total;
  return `<section class="card">
    <div class="card-head"><h2>Movement &amp; balance</h2><span class="aside">${e.source === 'manual' ? 'steps entered by hand' : 'from your phone'}</span></div>
    <div class="statgrid">
      <div><span>Steps</span><b class="num">${fmt(e.steps)}</b><small>goal ${fmt(S.move.stepGoal)}</small></div>
      <div><span>Distance</span><b class="num">${km(e.km)}</b><small>km</small></div>
      <div><span>Floors</span><b class="num">${fmt(e.floors)}</b><small>climbed</small></div>
      <div><span>Workouts</span><b class="num">${e.workouts.reduce((a, w) => a + w.minutes, 0)}</b><small>minutes</small></div>
    </div>
    ${prof ? `<table class="data energy" style="margin-top:12px">
      <tr><td>Resting (BMR)</td><td>${fmt(e.resting)}</td></tr>
      <tr><td>Digesting food</td><td>${fmt(e.digestion)}</td></tr>
      <tr><td>Walking</td><td>${fmt(e.walking)}</td></tr>
      <tr><td>Stairs</td><td>${fmt(e.stairs)}</td></tr>
      ${e.workouts.map((w) => `<tr><td>${esc(WORKOUT[w.type]?.label || w.type)} · ${w.minutes} min</td><td>${fmt(w.kcal)}</td></tr>`).join('')}
      <tr class="sum"><td>Burned${e.fraction < 1 ? ' so far' : ''}</td><td>${fmt(e.total)}</td></tr>
      ${e.fraction < 1 ? `<tr><td>Projected to midnight</td><td>${fmt(burned)}</td></tr>` : ''}
      <tr><td>Eaten</td><td>${fmt(intake)}</td></tr>
      <tr class="sum"><td>Energy balance${e.fraction < 1 ? ' (projected)' : ''}</td><td class="${intake - burned > 0 ? 'pos' : 'neg'}">${signed(intake - burned)}</td></tr>
    </table>
    <p class="small muted" style="margin-top:8px">${intake - burned > 0 ? 'A surplus' : 'A deficit'} of ${fmt(Math.abs(intake - burned))} kcal is about ${((Math.abs(intake - burned) / KCAL_PER_KG) * 1000).toFixed(0)} g of body weight (${fmt(KCAL_PER_KG)} kcal ≈ 1 kg).</p>` : '<p class="small">Add your profile in Settings to see calories burned and your energy balance.</p>'}
  </section>`;
}

async function earliest(from) {
  if (from > '2001-01-01') return from;
  const dates = [...(await db.logs.all()).map((e) => e.date), ...(await db.activity.all()).map((a) => a.date), ...(await db.workouts.all()).map((w) => w.date)].sort();
  return dates[0] || dateKey(S.now);
}

async function intakeMap(from, to) {
  const map = new Map();
  for (const e of await db.logs.range(from, to)) {
    if (e.pending) continue;
    map.set(e.date, (map.get(e.date) || 0) + (e.kcal || 0));
  }
  return map;
}

export async function fitnessSection(fromRaw, to) {
  await maybeSync();
  const from = await earliest(fromRaw);
  const intake = await intakeMap(from, to);
  const days = await motion.rangeEnergy(from, to, { profile: S.profile, intakeByDate: intake, now: S.now });
  const active = days.filter((d) => d.has || d.workouts.length);
  if (!active.length) {
    return `<section class="card"><div class="empty"><p><b>No movement recorded in this period yet.</b></p><p style="margin-top:6px">${motion.nativeMotion() ? 'Allow step counting on the Move tab and your steps will start appearing here.' : 'Enter steps or log workouts on the Move tab.'}</p></div></section>`;
  }
  const goal = S.move.stepGoal || 8000;
  const withSteps = active.filter((d) => d.steps > 0);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avgSteps = avg(withSteps.map((d) => d.steps));
  const goalDays = withSteps.filter((d) => d.steps >= goal).length;
  const totalKm = days.reduce((a, d) => a + d.km, 0);
  const floors = days.reduce((a, d) => a + d.floors, 0);
  const workouts = days.flatMap((d) => d.workouts);
  const wMinutes = workouts.reduce((a, w) => a + w.minutes, 0);
  const best = [...withSteps].sort((a, b) => b.steps - a.steps)[0];
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].steps >= goal) streak++;
    else if (i !== days.length - 1) break;
  }
  const span = days.slice(-62);
  const hoursDays = days.filter((d) => d.hours);
  const hourAvg = Array.from({ length: 24 }, (_, h) => avg(hoursDays.map((d) => d.hours[h])));
  const weekday = Array.from({ length: 7 }, (_, i) => {
    const ds = withSteps.filter((d) => parseDateKey(d.date).getDay() === i);
    return { n: ds.length, steps: avg(ds.map((d) => d.steps)) };
  });
  const byType = new Map();
  for (const w of workouts) {
    const t = byType.get(w.type) || { n: 0, minutes: 0, kcal: 0 };
    t.n++;
    t.minutes += w.minutes;
    t.kcal += w.kcal;
    byType.set(w.type, t);
  }
  const types = [...byType].sort((a, b) => b[1].kcal - a[1].kcal);
  const maxType = Math.max(1, ...types.map(([, t]) => t.kcal));

  const notes = [];
  notes.push(avgSteps >= goal ? [`Averaging ${fmt(avgSteps)} steps — above your goal`, `${goalDays} of ${withSteps.length} days reached ${fmt(goal)} steps.`]
    : [`Averaging ${fmt(avgSteps)} steps, ${fmt(goal - avgSteps)} short of your goal`, `${goalDays} of ${withSteps.length} days reached ${fmt(goal)}. About ${Math.round((goal - avgSteps) / 110)} more minutes of walking a day would close the gap.`]);
  if (hoursDays.length >= 2) {
    const ranked = hourAvg.map((v, h) => [h, v]).sort((a, b) => b[1] - a[1]);
    const [h1] = ranked[0];
    notes.push([`You move most around ${h1 % 12 || 12} ${h1 < 12 ? 'am' : 'pm'}`, `${fmt(ranked[0][1])} steps in that hour on an average day. The quietest daytime stretch is around ${ranked.filter(([h]) => h >= 8 && h <= 21).slice(-1)[0][0] % 12 || 12} ${ranked.filter(([h]) => h >= 8 && h <= 21).slice(-1)[0][0] < 12 ? 'am' : 'pm'}.`]);
  }
  const wk = weekday.map((w, i) => ({ ...w, i })).filter((w) => w.n);
  if (wk.length >= 3) {
    const hi = [...wk].sort((a, b) => b.steps - a.steps)[0];
    const lo = [...wk].sort((a, b) => a.steps - b.steps)[0];
    notes.push([`${DOW[hi.i]} is your most active day, ${DOW[lo.i]} the least`, `${fmt(hi.steps)} vs ${fmt(lo.steps)} steps on average.`]);
  }
  if (workouts.length) notes.push([`${workouts.length} workouts, ${formatDuration(wMinutes)} in total`, `${fmt(workouts.reduce((a, w) => a + w.kcal, 0))} kcal above resting. ${types[0] ? `${WORKOUT[types[0][0]]?.label || types[0][0]} burned the most.` : ''}`]);
  if (floors) notes.push([`${fmt(floors)} floors climbed`, `About ${fmt(floors * 3)} m of height — ${(floors / Math.max(1, active.length)).toFixed(1)} floors a day.`]);
  const recent = withSteps.slice(-7);
  const before = withSteps.slice(-14, -7);
  if (recent.length >= 3 && before.length >= 3) {
    const diff = avg(recent.map((d) => d.steps)) - avg(before.map((d) => d.steps));
    if (Math.abs(diff) >= 500) notes.push([`Steps are trending ${diff > 0 ? 'up' : 'down'} by ${fmt(Math.abs(diff))} a day`, 'Last 7 days with steps compared with the 7 before.']);
  }

  return `<div class="tiles">
    <div class="tile"><div class="eyebrow">Steps per day</div><div class="v num">${fmt(avgSteps)}</div><div class="d">${goalDays}/${withSteps.length} days at goal</div></div>
    <div class="tile"><div class="eyebrow">Distance</div><div class="v num">${km(totalKm)}<small> km</small></div><div class="d">${km(totalKm / Math.max(1, withSteps.length))} km a day</div></div>
    <div class="tile"><div class="eyebrow">Floors</div><div class="v num">${fmt(floors)}</div><div class="d">${fmt(floors * 3)} m climbed</div></div>
    <div class="tile"><div class="eyebrow">Workouts</div><div class="v num">${workouts.length}</div><div class="d">${formatDuration(wMinutes || 0)} · goal streak ${streak}d</div></div>
  </div>
  <section class="card">
    <div class="card-head"><h2>Daily steps</h2><span class="aside">${best ? `best ${fmt(best.steps)} on ${shortDay(best.date)}` : ''}</span></div>
    ${barsSvg(span.map((d) => d.steps), { width: chartWidth(), height: 150, goal, labels: span.map((d) => (span.length > 10 ? String(parseDateKey(d.date).getDate()) : DOW[parseDateKey(d.date).getDay()])), tips: span.map((d) => `${shortDay(d.date)}\n${fmt(d.steps)} steps · ${km(d.km)} km · ${d.floors} floors`) })}
  </section>
  <section class="card">
    <div class="card-head"><h2>What the data says</h2></div>
    ${notes.map(([title, text], i) => `<div class="finding"><div class="n num">${pad(i + 1)}</div><div><b>${esc(title)}</b><span>${esc(text)}</span></div></div>`).join('')}
  </section>
  ${hoursDays.length ? `<section class="card">
    <div class="card-head"><h2>Hour of day</h2><span class="aside">average steps per hour</span></div>
    ${barsSvg(hourAvg, { width: chartWidth(), height: 120, labels: hourAvg.map((_, i) => (i % 3 === 0 ? `${i % 12 || 12}${i < 12 ? 'a' : 'p'}` : '')), tips: hourAvg.map((v, i) => `${i}:00–${i + 1}:00 · ${fmt(v)} steps on average`) })}
  </section>` : ''}
  <section class="card">
    <div class="card-head"><h2>By weekday</h2><span class="aside">average steps</span></div>
    ${barsSvg([1, 2, 3, 4, 5, 6, 0].map((i) => weekday[i].steps), { width: chartWidth(), height: 120, goal, labels: [1, 2, 3, 4, 5, 6, 0].map((i) => DOW[i]), tips: [1, 2, 3, 4, 5, 6, 0].map((i) => `${DOW[i]}: ${fmt(weekday[i].steps)} steps over ${weekday[i].n} days`) })}
  </section>
  ${types.length ? `<section class="card">
    <div class="card-head"><h2>Workouts by type</h2><span class="aside">kcal above resting</span></div>
    ${types.map(([id, t]) => `<div class="hbar dish"><span>${esc(WORKOUT[id]?.label || id)}</span><div class="bar"><i style="width:${((t.kcal / maxType) * 100).toFixed(0)}%"></i></div><span class="val num">${t.n}× · ${t.minutes} min · ${fmt(t.kcal)}</span></div>`).join('')}
  </section>` : ''}
  <section class="card">
    <div class="card-head"><h2>Every day</h2></div>
    <div style="max-height:320px;overflow:auto"><table class="data"><thead><tr><th>Day</th><th>Steps</th><th>km</th><th>Floors</th><th>Active</th></tr></thead><tbody>
    ${[...days].reverse().filter((d) => d.has || d.workouts.length).map((d) => `<tr><td><a class="link" href="#day/${d.date}">${shortDay(d.date)}</a></td><td>${fmt(d.steps)}</td><td>${km(d.km)}</td><td>${d.floors}</td><td>${fmt(d.active)}</td></tr>`).join('')}
    </tbody></table></div>
  </section>`;
}

export async function balanceSection(fromRaw, to) {
  await maybeSync();
  if (!ready(S.profile)) {
    return `<section class="card"><div class="empty"><p><b>Add your age, height and weight first.</b></p><p style="margin-top:6px">Calories burned depend on your body. <a class="link" href="#settings">Open Settings</a></p></div></section>`;
  }
  const from = await earliest(fromRaw);
  const intake = await intakeMap(from, to);
  const days = await motion.rangeEnergy(from, to, { profile: S.profile, intakeByDate: intake, now: S.now });
  const rows = days.filter((d) => intake.get(d.date) > 0).map((d) => {
    const eaten = intake.get(d.date);
    const burned = d.fraction < 1 ? d.fullDay : d.total;
    return { ...d, eaten, burned, balance: eaten - burned };
  });
  if (!rows.length) return '<section class="card"><div class="empty"><p><b>No meals logged in this period.</b></p><p style="margin-top:6px">Balance compares what you eat with what you burn, so it needs food logs.</p></div></section>';
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sumBal = rows.reduce((a, r) => a + r.balance, 0);
  const predicted = sumBal / KCAL_PER_KG;
  const weights = (await db.weights.all()).filter((w) => w.date >= from && w.date <= to);
  const measured = weights.length >= 2 ? weights[weights.length - 1].kg - weights[0].kg : null;
  const sensorDays = rows.filter((r) => r.source === 'sensor' && r.fraction === 1);
  const measuredMaint = sensorDays.length >= 3 ? avg(sensorDays.map((r) => r.burned - r.digestion)) : null;
  const goal = S.move.stepGoal || 8000;
  const activeDays = rows.filter((r) => r.steps >= goal);
  const lazyDays = rows.filter((r) => r.steps < goal);
  const n = needs(S.profile);
  const goalShift = (GOALS.find(([id]) => id === n.goal.id) || [0, 0, 0])[2];
  const notes = [];
  const deficit = rows.filter((r) => r.balance < -100).length;
  const surplus = rows.filter((r) => r.balance > 100).length;
  notes.push([`${avg(rows.map((r) => r.balance)) > 0 ? 'A surplus' : 'A deficit'} of ${fmt(Math.abs(avg(rows.map((r) => r.balance))))} kcal a day on average`, `${deficit} days in deficit, ${surplus} in surplus, ${rows.length - deficit - surplus} roughly even (within 100 kcal).`]);
  notes.push([`The energy numbers predict ${predicted >= 0 ? '+' : '−'}${Math.abs(predicted).toFixed(2)} kg over these ${rows.length} days`, `Using about ${fmt(KCAL_PER_KG)} kcal per kg of body weight.`]);
  if (measured != null) {
    const gap = Math.abs(measured - predicted);
    notes.push([`Your scale moved ${measured >= 0 ? '+' : '−'}${Math.abs(measured).toFixed(1)} kg`, gap < 0.5 ? 'That agrees with the prediction, so your logging looks trustworthy.' : `That is ${gap.toFixed(1)} kg off the prediction. Water, salt and timing move the scale day to day; if the gap persists over weeks, portions are probably being ${measured > predicted ? 'under' : 'over'}-estimated.`]);
  }
  if (activeDays.length >= 2 && lazyDays.length >= 2) {
    const ea = avg(activeDays.map((r) => r.eaten));
    const el = avg(lazyDays.map((r) => r.eaten));
    notes.push([`On days you reach ${fmt(goal)} steps you eat ${fmt(Math.abs(ea - el))} kcal ${ea > el ? 'more' : 'less'}`, `${fmt(ea)} vs ${fmt(el)} kcal. Burn on those days is ${fmt(avg(activeDays.map((r) => r.burned)) - avg(lazyDays.map((r) => r.burned)))} kcal higher.`]);
  }
  if (goalShift) {
    const avgBal = avg(rows.map((r) => r.balance));
    notes.push([`Your goal needs a daily balance of about ${signed(goalShift)} kcal`, `You are averaging ${signed(avgBal)}. ${Math.abs(avgBal - goalShift) < 150 ? 'You are on track.' : avgBal > goalShift ? `Eating about ${fmt(avgBal - goalShift)} kcal less or moving more would get you there.` : `You are ${fmt(goalShift - avgBal)} kcal further than planned; make sure you are eating enough.`}`]);
  }
  if (measuredMaint) notes.push([`Your measured maintenance is about ${fmt(measuredMaint)} kcal`, `Average burn on ${sensorDays.length} fully tracked days, compared with ${fmt(n.maintenance)} kcal from your activity setting.`]);
  const top = [...rows].sort((a, b) => b.balance - a.balance)[0];
  const low = [...rows].sort((a, b) => a.balance - b.balance)[0];
  if (rows.length >= 3) notes.push([`Biggest surplus: ${shortDay(top.date)} (${signed(top.balance)})`, `Biggest deficit: ${shortDay(low.date)} (${signed(low.balance)}).`]);
  const span = rows.slice(-31);

  return `<div class="tiles">
    <div class="tile"><div class="eyebrow">Eaten per day</div><div class="v num">${fmt(avg(rows.map((r) => r.eaten)))}<small> kcal</small></div><div class="d">${rows.length} days with meals</div></div>
    <div class="tile"><div class="eyebrow">Burned per day</div><div class="v num">${fmt(avg(rows.map((r) => r.burned)))}<small> kcal</small></div><div class="d">resting + digestion + movement</div></div>
    <div class="tile"><div class="eyebrow">Average balance</div><div class="v num">${signed(avg(rows.map((r) => r.balance)))}</div><div class="d">${sumBal > 0 ? 'surplus' : 'deficit'} · ${signed(sumBal)} in total</div></div>
    <div class="tile"><div class="eyebrow">Weight change</div><div class="v num">${predicted >= 0 ? '+' : '−'}${Math.abs(predicted).toFixed(2)}<small> kg</small></div><div class="d">${measured != null ? `scale: ${measured >= 0 ? '+' : '−'}${Math.abs(measured).toFixed(1)} kg` : 'predicted · log weight to compare'}</div></div>
  </div>
  <section class="card">
    <div class="card-head"><h2>Eaten vs burned</h2><span class="aside">kcal per day</span></div>
    ${pairSvg(span.map((r) => ({ a: r.eaten, b: r.burned, label: span.length > 10 ? String(parseDateKey(r.date).getDate()) : DOW[parseDateKey(r.date).getDay()], tip: `${shortDay(r.date)}\nEaten ${fmt(r.eaten)} · burned ${fmt(r.burned)}\nBalance ${signed(r.balance)}` })), { width: chartWidth() })}
    <div class="legend"><span class="key"><span class="sw" style="--c:var(--m-lunch)"></span>Eaten</span><span class="key"><span class="sw" style="--c:var(--m-breakfast)"></span>Burned</span></div>
  </section>
  <section class="card">
    <div class="card-head"><h2>What the data says</h2></div>
    ${notes.map(([title, text], i) => `<div class="finding"><div class="n num">${pad(i + 1)}</div><div><b>${esc(title)}</b><span>${esc(text)}</span></div></div>`).join('')}
  </section>
  <section class="card">
    <div class="card-head"><h2>Every day</h2><span class="aside">kcal</span></div>
    <div style="max-height:360px;overflow:auto"><table class="data"><thead><tr><th>Day</th><th>Eaten</th><th>Burned</th><th>Balance</th><th>Steps</th></tr></thead><tbody>
    ${[...rows].reverse().map((r) => `<tr><td><a class="link" href="#day/${r.date}">${shortDay(r.date)}</a></td><td>${fmt(r.eaten)}</td><td>${fmt(r.burned)}</td><td class="${r.balance > 0 ? 'pos' : 'neg'}">${signed(r.balance)}</td><td>${fmt(r.steps)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted" style="margin-top:10px">Burned = resting (BMR) + digestion (10% of food) + walking + stairs + workouts. Today uses the burn projected to midnight.</p>
  </section>`;
}

export function needsCard() {
  const n = needs(S.profile);
  if (!n) return '<div class="note">Fill in sex, age, height and weight to see your calorie needs, healthy weight range and more.</div>';
  const b = n.bmi;
  return `<div class="needs">
    <div class="needs-head"><div><span class="eyebrow">Eat each day</span><b class="num">${fmt(n.goal.low)}–${fmt(n.goal.high)}</b><small>kcal · ${esc(n.goal.label.toLowerCase())}</small></div>
      <div><span class="eyebrow">BMI</span><b class="num">${b.value.toFixed(1)}</b><small>${b.category}</small></div></div>
    <table class="data">
      <tr><td>Resting burn (BMR, Mifflin–St Jeor)</td><td>${fmt(n.bmr)} kcal</td></tr>
      ${n.levels.map((l) => `<tr class="${l.current ? 'hl' : ''}"><td>Maintenance if ${esc(l.label.split(' — ')[0].toLowerCase())}${l.current ? ' (you)' : ''}</td><td>${fmt(l.kcal)} kcal</td></tr>`).join('')}
      ${n.goals.map((g) => `<tr class="${g.id === n.goal.id ? 'hl' : ''}"><td>${esc(g.label)}</td><td>${fmt(g.low)}–${fmt(g.high)}${g.belowFloor ? '*' : ''}</td></tr>`).join('')}
      <tr><td>Healthy weight for your height</td><td>${b.healthy[0].toFixed(0)}–${b.healthy[1].toFixed(0)} kg</td></tr>
      <tr><td>Protein: minimum (ICMR RDA) / active range</td><td>${n.protein.rda} g / ${n.protein.low}–${n.protein.high} g</td></tr>
      <tr><td>Water</td><td>about ${n.waterL} L (${Math.round((n.waterL * 1000) / 250)} glasses)</td></tr>
    </table>
    <p class="small muted">BMI bands use the Asian cut-offs recommended for Indians (healthy 18.5–22.9). Ranges are ±5% around each target${n.goals.some((g) => g.belowFloor) ? `; * held at a safe minimum of ${fmt(n.floor)} kcal` : ''}. Estimates for healthy adults, not medical advice.</p>
  </div>`;
}

export function movementSettings() {
  const st = motion.status();
  return `<div class="set-group"><h3>Movement</h3><section class="card stack">
    <div class="grid2">
      <label class="field">Daily step goal<input type="number" inputmode="numeric" data-set="move.stepGoal" value="${S.move.stepGoal}"></label>
      <label class="field">Step length (cm)<input type="number" inputmode="numeric" data-set="profile.stepCm" value="${S.profile.stepCm || ''}" placeholder="${Math.round(stepLengthM(S.profile) * 100)} from height"></label>
    </div>
    <div class="small muted">To measure your step length: walk 20 normal steps, measure the distance in cm and divide by 20.</div>
    ${st.native ? `<div class="small">Step sensor: <b>${st.stepCounter ? 'available' : 'not on this phone'}</b> · Barometer: <b>${st.barometer ? 'available' : 'not on this phone'}</b> · Permission: <b>${st.permission}</b> · Continuous tracking: <b>${st.tracking ? 'on' : 'off'}</b></div>` : '<div class="small">Automatic step counting works in the Android app. Here, enter steps by hand on the Move tab.</div>'}
  </section></div>`;
}

export async function activityForReport(fromRaw, to) {
  const from = await earliest(fromRaw);
  const intake = await intakeMap(from, to);
  const days = await motion.rangeEnergy(from, to, { profile: S.profile, intakeByDate: intake, now: S.now });
  const out = days.filter((d) => d.has || d.workouts.length).map((d) => ({
    date: d.date, steps: d.steps, km: d.km, floors: d.floors, resting: d.resting, digestion: d.digestion, walking: d.walking, stairs: d.stairs, exercise: d.exercise,
    total: d.fraction < 1 ? d.fullDay : d.total, eaten: intake.get(d.date) || 0, source: d.source,
    workouts: d.workouts.map((w) => ({ type: WORKOUT[w.type]?.label || w.type, minutes: w.minutes, intensity: w.intensity, kcal: w.kcal, start: w.start })),
  }));
  const weights = (await db.weights.all()).filter((w) => w.date >= from && w.date <= to);
  return { days: out, weights, stepGoal: S.move.stepGoal, profileReady: ready(S.profile) };
}

async function saveMove() {
  await db.kv.set('move', S.move);
}

export function openWorkout({ mode = 'log', prefill = {} } = {}) {
  const now = Date.now();
  const W = {
    type: prefill.type || 'walking',
    intensity: prefill.intensity || 'moderate',
    minutes: prefill.minutes || 30,
    start: prefill.start || now - 30 * 60e3,
    phoneCounted: prefill.phoneCounted ?? NATIVE,
    note: '',
  };
  const sh = sheet({
    type: (el) => {
      W.type = el.dataset.v;
      draw();
    },
    int: (el) => {
      W.intensity = el.dataset.v;
      draw();
    },
    min: (el) => {
      W.minutes = Math.max(1, W.minutes + Number(el.dataset.d));
      draw();
    },
    counted: () => {
      W.phoneCounted = !W.phoneCounted;
      draw();
    },
    start: async () => {
      S.move.active = { type: W.type, intensity: W.intensity, start: Date.now(), phoneCounted: W.phoneCounted };
      await saveMove();
      haptic(15);
      toast(`${WORKOUT[W.type].label} started`);
      closeSheet();
    },
    save: async () => {
      if (!ready(S.profile)) toast('Add weight in Settings for calories; the workout is saved anyway.', 3600);
      await motion.saveWorkout({ id: db.uid(), type: W.type, intensity: W.intensity, minutes: Math.round(W.minutes), start: W.start, phoneCounted: W.phoneCounted && WORKOUT[W.type].onFoot, note: W.note.trim() }, S.profile);
      if (prefill.fromTimer) {
        S.move.active = null;
        await saveMove();
      }
      haptic([12, 40, 18]);
      closeSheet();
      stamp('Logged');
    },
  });
  sh.panel.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.f === 'minutes') W.minutes = Math.max(1, Number(t.value) || 1);
    if (t.dataset.f === 'note') W.note = t.value;
    if (t.dataset.f === 'date' || t.dataset.f === 'time') {
      const d = $('[data-f="date"]', sh.panel).value;
      const tm = $('[data-f="time"]', sh.panel).value;
      if (d && tm) W.start = new Date(`${d}T${tm}`).getTime();
    }
    if (t.dataset.f === 'minutes') preview();
  });
  function preview() {
    const k = workoutKcal({ type: W.type, intensity: W.intensity, minutes: W.minutes }, S.profile);
    const el = $('[data-preview]', sh.panel);
    if (el) el.innerHTML = ready(S.profile) ? `<b class="num">${fmt(k.net)}</b> kcal above resting · ${fmt(k.gross)} kcal in total · MET ${k.met}` : 'Add your weight in Settings to calculate calories.';
  }
  function draw() {
    const w = WORKOUT[W.type];
    const st = new Date(W.start);
    sh.title.textContent = mode === 'start' ? 'Start a workout' : 'Log a workout';
    sh.body.innerHTML = `<div class="eyebrow" style="margin-bottom:8px">Activity</div>
      <div class="picker">${WORKOUTS.map(([id, label]) => `<button class="chip" data-s="type" data-v="${id}" aria-pressed="${id === W.type}">${esc(label)}</button>`).join('')}</div>
      <div class="eyebrow" style="margin:14px 0 8px">Intensity</div>
      <div class="seg">${INTENSITY.map((i) => `<button data-s="int" data-v="${i}" aria-pressed="${i === W.intensity}">${i}</button>`).join('')}</div>
      ${mode === 'log' ? `<div class="grid2" style="margin-top:14px">
        <label class="field">Started (date)<input type="date" data-f="date" value="${dateKey(st)}"></label>
        <label class="field">Started (time)<input type="time" data-f="time" value="${pad(st.getHours())}:${pad(st.getMinutes())}"></label>
      </div>
      <label class="field" style="margin-top:12px">Minutes<div class="row"><button class="btn sm" data-s="min" data-d="-5">−5</button><input type="number" inputmode="numeric" data-f="minutes" value="${Math.round(W.minutes)}" style="text-align:center"><button class="btn sm" data-s="min" data-d="5">+5</button></div></label>` : ''}
      ${w.onFoot && NATIVE ? `<button class="toggle" data-s="counted" aria-pressed="${W.phoneCounted}" style="margin-top:14px"><span class="check">${ICONS.check}</span><span class="grow"><b>My phone was on me</b><br><span class="small muted">Steps it counted during this ${mode === 'start' ? 'workout' : 'time'} are subtracted so walking isn't counted twice.</span></span></button>` : ''}
      ${mode === 'log' ? `<label class="field" style="margin-top:12px">Note (optional)<input type="text" data-f="note" value="${esc(W.note)}" placeholder="e.g. evening run around campus"></label>` : ''}
      <p class="small muted" style="margin-top:12px">Calories use MET values from the Compendium of Physical Activities for ${esc(w.label.toLowerCase())}: ${w.mets.join(' / ')} (light / moderate / vigorous).</p>`;
    sh.foot.hidden = false;
    sh.foot.innerHTML = `${mode === 'log' ? '<div class="note" data-preview style="margin-bottom:10px"></div>' : ''}<button class="btn primary block" data-s="${mode === 'start' ? 'start' : 'save'}">${mode === 'start' ? `${ICONS.clock} Start ${esc(w.label.toLowerCase())}` : `${ICONS.check} Save workout`}</button>`;
    if (mode === 'log') preview();
  }
  draw();
}

export async function stopWorkout() {
  const a = S.move.active;
  if (!a) return;
  const minutes = Math.max(1, Math.round((Date.now() - a.start) / 60e3));
  openWorkout({ mode: 'log', prefill: { ...a, minutes, fromTimer: true } });
}

export async function openWorkoutDetail(id) {
  const w = (await db.workouts.all()).find((x) => x.id === id);
  if (!w) return;
  const sh = sheet({
    delete: async () => {
      if (!confirm('Delete this workout?')) return;
      await db.workouts.remove(id);
      toast('Workout deleted.');
      closeSheet();
    },
  });
  sh.title.textContent = WORKOUT[w.type]?.label || w.type;
  sh.body.innerHTML = `<table class="data energy">
    <tr><td>Started</td><td>${new Date(w.start).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td></tr>
    <tr><td>Duration</td><td>${w.minutes} min</td></tr>
    <tr><td>Intensity</td><td>${w.intensity} · MET ${w.met}</td></tr>
    <tr><td>Total energy</td><td>${fmt(w.grossKcal)} kcal</td></tr>
    ${w.stepCredit ? `<tr><td>Already counted from ${fmt(w.overlapSteps)} steps</td><td>−${fmt(w.stepCredit)} kcal</td></tr>` : ''}
    <tr class="sum"><td>Added to your burn</td><td>${fmt(w.kcal)} kcal</td></tr>
  </table>${w.note ? `<p class="small" style="margin-top:10px">${esc(w.note)}</p>` : ''}
  <p class="small muted" style="margin-top:10px">Resting energy for the same time is already part of your daily BMR, so only the extra is added.</p>`;
  sh.foot.hidden = false;
  sh.foot.innerHTML = `<button class="btn danger block" data-s="delete">${ICONS.trash} Delete workout</button>`;
}

export async function openWeight() {
  const all = await db.weights.all();
  const W = { date: dateKey(S.now), kg: S.profile.weightKg || all[all.length - 1]?.kg || '', useForProfile: true };
  const sh = sheet({
    save: async () => {
      const kg = Number(W.kg);
      if (!(kg > 20 && kg < 300)) return toast('Enter a weight in kg.');
      await db.weights.put({ date: W.date, kg: Math.round(kg * 10) / 10 });
      const latest = (await db.weights.all()).slice(-1)[0];
      if (W.useForProfile && latest?.date === W.date) await updateProfile({ weightKg: Math.round(kg * 10) / 10 });
      haptic(12);
      closeSheet();
      stamp('Logged');
    },
    use: () => {
      W.useForProfile = !W.useForProfile;
      draw();
    },
    del: async (el) => {
      await db.weights.remove(el.dataset.v);
      openWeight();
    },
  });
  sh.panel.addEventListener('input', (ev) => {
    if (ev.target.dataset.f === 'kg') W.kg = ev.target.value;
    if (ev.target.dataset.f === 'date') W.date = ev.target.value;
  });
  function draw() {
    sh.title.textContent = 'Log weight';
    sh.body.innerHTML = `<div class="grid2">
        <label class="field">Weight (kg)<input type="number" inputmode="decimal" step="0.1" data-f="kg" value="${esc(W.kg)}"></label>
        <label class="field">Date<input type="date" data-f="date" value="${W.date}"></label>
      </div>
      <button class="toggle" data-s="use" aria-pressed="${W.useForProfile}" style="margin-top:12px"><span class="check">${ICONS.check}</span><span class="grow"><b>Update my profile weight</b><br><span class="small muted">Recalculates your calorie targets and burn.</span></span></button>
      ${all.length ? `<div class="eyebrow" style="margin:16px 0 6px">History</div><table class="data">${[...all].reverse().slice(0, 30).map((w) => `<tr><td>${shortDay(w.date)}</td><td>${w.kg.toFixed(1)} kg</td><td><button class="link" data-s="del" data-v="${w.date}">delete</button></td></tr>`).join('')}</table>` : ''}`;
    sh.foot.hidden = false;
    sh.foot.innerHTML = `<button class="btn primary block" data-s="save">${ICONS.check} Save weight</button>`;
  }
  draw();
}

export async function openManual(date = dateKey(S.now)) {
  const rec = await db.activity.get(date);
  const m = rec?.manual || {};
  const sensor = rec?.sensor;
  const F = { steps: m.steps ?? '', floors: m.floors ?? '', km: m.km ?? '' };
  const sh = sheet({
    save: async () => {
      const num = (v) => (v === '' || v == null ? null : Math.max(0, Number(v)));
      await motion.saveManual(date, { steps: num(F.steps), floors: num(F.floors), km: num(F.km) });
      closeSheet();
      stamp('Saved');
    },
    clear: async () => {
      await motion.saveManual(date, {});
      toast('Manual entry removed.');
      closeSheet();
    },
  });
  sh.panel.addEventListener('input', (ev) => {
    if (ev.target.dataset.f) F[ev.target.dataset.f] = ev.target.value;
  });
  sh.title.textContent = 'Steps by hand';
  sh.body.innerHTML = `<p class="small" style="margin-bottom:12px">${shortDay(date)}. Use this for steps from another device or app. It replaces the phone's own count for this day${sensor ? ` (currently ${fmt(sensor.steps)} steps from the sensor)` : ''}.</p>
    <div class="grid3">
      <label class="field">Steps<input type="number" inputmode="numeric" data-f="steps" value="${esc(F.steps)}"></label>
      <label class="field">Floors<input type="number" inputmode="numeric" data-f="floors" value="${esc(F.floors)}"></label>
      <label class="field">km (optional)<input type="number" inputmode="decimal" step="0.01" data-f="km" value="${esc(F.km)}"></label>
    </div>
    <p class="small muted" style="margin-top:10px">Leave distance empty to calculate it from your step length.</p>`;
  sh.foot.hidden = false;
  sh.foot.innerHTML = `<div class="btn-row">${rec?.manual ? `<button class="btn danger" data-s="clear">${ICONS.trash} Remove</button>` : '<span></span>'}<button class="btn primary" data-s="save">${ICONS.check} Save</button></div>`;
}

export const MOVE_ACTIONS = {
  'move-perm': () => motion.requestPermission(),
  'move-settings': () => motion.openSettings(),
  'move-track': async (el) => {
    motion.setTracking(el.dataset.value === 'on');
    toast(el.dataset.value === 'on' ? 'Continuous tracking on' : 'Continuous tracking off');
    setTimeout(render, 600);
  },
  'workout-log': () => openWorkout({ mode: 'log' }),
  'workout-start': () => openWorkout({ mode: 'start' }),
  'workout-stop': () => stopWorkout(),
  'workout-open': (el) => openWorkoutDetail(el.dataset.id),
  'weight-log': () => openWeight(),
  'manual-steps': () => openManual(),
  'insights-view': (el) => {
    S.insightsView = el.dataset.value;
    render();
  },
};
