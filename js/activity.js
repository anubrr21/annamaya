import { dateKey, parseDateKey } from './menu.js';
import * as db from './db.js';
import { distanceKm, walkKcal, floorKcal, workoutKcal, burn, dayFraction } from './body.js';

const HOUR = 3600e3;
const MAX_STEPS_PER_SEC = 4;
const NIGHT_WEIGHT = 0.15;
const LOOKBACK_DAYS = 400;

export const nativeMotion = () => typeof window.AnnamayaNative?.motionStatus === 'function';

export function status() {
  if (!nativeMotion()) return { native: false };
  try {
    return { native: true, ...JSON.parse(window.AnnamayaNative.motionStatus()) };
  } catch {
    return { native: false };
  }
}

export const requestPermission = () => nativeMotion() && window.AnnamayaNative.requestMotionPermission();
export const openSettings = () => nativeMotion() && window.AnnamayaNative.openAppSettings();
export const refresh = () => nativeMotion() && window.AnnamayaNative.refreshSteps();
export const setTracking = (on) => nativeMotion() && window.AnnamayaNative.setTracking(Boolean(on));

function readJson(fn, since) {
  try {
    return JSON.parse(fn(String(Math.floor(since))));
  } catch {
    return [];
  }
}

function hourStart(t) {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function spread(into, t0, t1, amount) {
  if (amount <= 0 || t1 <= t0) {
    if (amount > 0) add(into, t1, amount);
    return;
  }
  const slices = [];
  let total = 0;
  const sparse = t1 - t0 > 2 * HOUR;
  for (let h = hourStart(t0); h < t1; h += HOUR) {
    const a = Math.max(t0, h);
    const b = Math.min(t1, h + HOUR);
    if (b <= a) continue;
    const hour = new Date(h).getHours();
    const w = (b - a) * (sparse && hour < 6 ? NIGHT_WEIGHT : 1);
    slices.push([h, w]);
    total += w;
  }
  for (const [h, w] of slices) add(into, h, (amount * w) / total);
}

function add(into, t, amount) {
  const d = new Date(t);
  const key = dateKey(d);
  if (!into.has(key)) into.set(key, { steps: 0, hours: Array(24).fill(0), floors: 0, floorHours: Array(24).fill(0) });
  const day = into.get(key);
  day.steps += amount;
  day.hours[d.getHours()] += amount;
}

export function aggregate(samples, floors = []) {
  const days = new Map();
  const sorted = [...samples].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    const [t0, c0] = sorted[i - 1];
    const [t1, c1] = sorted[i];
    let delta = c1 >= c0 ? c1 - c0 : c1;
    const cap = Math.max(1, (t1 - t0) / 1000) * MAX_STEPS_PER_SEC;
    if (delta > cap) delta = cap;
    spread(days, t0, t1, delta);
  }
  for (const t of floors) {
    const d = new Date(t);
    const key = dateKey(d);
    if (!days.has(key)) days.set(key, { steps: 0, hours: Array(24).fill(0), floors: 0, floorHours: Array(24).fill(0) });
    days.get(key).floors += 1;
    days.get(key).floorHours[d.getHours()] += 1;
  }
  for (const day of days.values()) {
    day.steps = Math.round(day.steps);
    day.hours = day.hours.map((v) => Math.round(v));
  }
  return days;
}

export function stepsBetween(samples, t0, t1) {
  const sorted = [...samples].sort((a, b) => a[0] - b[0]);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const [a, ca] = sorted[i - 1];
    const [b, cb] = sorted[i];
    if (b <= t0 || a >= t1) continue;
    const delta = cb >= ca ? cb - ca : cb;
    const overlap = Math.min(b, t1) - Math.max(a, t0);
    total += b > a ? (delta * overlap) / (b - a) : delta;
  }
  return Math.round(total);
}

let lastSync = 0;

export async function sync({ full = false } = {}) {
  if (!nativeMotion()) return false;
  const now = Date.now();
  const since = full ? now - LOOKBACK_DAYS * 864e5 : new Date(new Date().setHours(0, 0, 0, 0) - 864e5).getTime();
  const samples = readJson((s) => window.AnnamayaNative.motionSamples(s), since - 6 * HOUR);
  const floors = readJson((s) => window.AnnamayaNative.floorEvents(s), since);
  const days = aggregate(samples, floors);
  const fromKey = dateKey(new Date(since));
  for (const [date, sensor] of days) {
    if (date < fromKey) continue;
    const existing = (await db.activity.get(date)) || { date };
    await db.activity.put({ ...existing, date, sensor: { ...sensor, updatedAt: now } });
  }
  lastSync = now;
  return true;
}

export const lastSyncedAt = () => lastSync;

export async function samplesAround(t0, t1) {
  if (!nativeMotion()) return [];
  return readJson((s) => window.AnnamayaNative.motionSamples(s), t0 - 6 * HOUR).filter((s) => s[0] <= t1 + 6 * HOUR);
}

export function effective(record) {
  const sensor = record?.sensor || null;
  const manual = record?.manual || null;
  const steps = manual?.steps != null ? manual.steps : sensor?.steps || 0;
  const floors = manual?.floors != null ? manual.floors : sensor?.floors || 0;
  return {
    steps,
    floors,
    hours: manual?.steps != null ? null : sensor?.hours || null,
    floorHours: manual?.floors != null ? null : sensor?.floorHours || null,
    kmOverride: manual?.km ?? null,
    source: manual?.steps != null ? 'manual' : sensor ? 'sensor' : 'none',
    has: Boolean(sensor || manual),
  };
}

export async function dayEnergy(date, { profile, intake = 0, now = new Date() }) {
  const record = await db.activity.get(date);
  const act = effective(record);
  const workouts = await db.workouts.forDate(date);
  const fraction = dayFraction(date, now);
  const b = burn({ profile, steps: act.steps, floors: act.floors, workouts, intake, fraction });
  const km = act.kmOverride != null ? act.kmOverride : distanceKm(act.steps, profile);
  const walking = act.kmOverride != null ? Math.round(walkKcal(km, profile)) : b.walking;
  const total = b.total - b.walking + walking;
  const fullDay = fraction < 1 ? burn({ profile, steps: act.steps, floors: act.floors, workouts, intake, fraction: 1 }).total - b.walking + walking : total;
  return { ...b, walking, total, fullDay, km, steps: act.steps, floors: act.floors, hours: act.hours, floorHours: act.floorHours, source: act.source, has: act.has, workouts, fraction };
}

export async function rangeEnergy(from, to, { profile, intakeByDate = new Map(), now = new Date() }) {
  const out = [];
  const end = parseDateKey(to);
  for (let d = parseDateKey(from); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const key = dateKey(d);
    out.push({ date: key, ...(await dayEnergy(key, { profile, intake: intakeByDate.get(key) || 0, now })) });
  }
  return out;
}

export async function saveWorkout(w, profile) {
  let overlapSteps = 0;
  const onFootTypes = ['walking', 'running', 'stairs', 'hiking'];
  if (w.phoneCounted && onFootTypes.includes(w.type) && nativeMotion()) {
    const t0 = w.start;
    const t1 = w.start + w.minutes * 60e3;
    overlapSteps = stepsBetween(await samplesAround(t0, t1), t0, t1);
  }
  const kcal = workoutKcal({ ...w, overlapSteps: w.phoneCounted ? overlapSteps : 0 }, profile);
  const record = { ...w, date: dateKey(new Date(w.start)), overlapSteps, met: kcal.met, kcal: kcal.net, grossKcal: kcal.gross, stepCredit: kcal.stepCredit };
  await db.workouts.put(record);
  return record;
}

export async function saveManual(date, manual) {
  const existing = (await db.activity.get(date)) || { date };
  const clean = Object.fromEntries(Object.entries(manual).filter(([, v]) => v != null && v !== '' && !Number.isNaN(v)));
  await db.activity.put({ ...existing, date, manual: Object.keys(clean).length ? clean : undefined });
}

export const floorKcalFor = floorKcal;
