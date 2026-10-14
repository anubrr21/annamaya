import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readXlsx } from '../js/xlsx.js';
import { parseMenuWorkbook, menuFor, DEFAULT_TIMES, MEALS } from '../js/menu.js';
import { estimateItem, totals, computeTargets } from '../js/nutrition.js';
import { buildReport } from '../js/report.js';

const buf = await readFile(new URL('../menu/2026-10.xlsx', import.meta.url));
const menu = parseMenuWorkbook(await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), { fileName: '2026-10.xlsx' });
const offeredFor = (date, plan, meal) => (menuFor(menu, date, plan || 'regular')?.[meal] || []).map((i) => ({ line: i.name, est: estimateItem(i.raw) }));

const logs = [];
const pick = { breakfast: [0, 1, 5, 7], lunch: [1, 2, 3, 4, 8], snacks: [0, 2], dinner: [1, 2, 3, 5, 7] };
const hour = { breakfast: 8, lunch: 13, snacks: 17, dinner: 20 };
for (let d = 1; d <= 11; d++) {
  for (const meal of MEALS) {
    if ((meal === 'breakfast' && d % 4 === 0) || (meal === 'snacks' && d % 3 === 0) || (d === 6 && meal !== 'lunch')) continue;
    const served = offeredFor(new Date(2026, 9, d), 'regular', meal);
    const items = pick[meal].filter((i) => served[i]).map((i) => {
      const e = served[i].est;
      const qty = (d + i) % 5 === 0 ? 1.5 : 1;
      return { name: served[i].line, portion: e.serving, qty, kcal: Math.round(e.kcal * qty), protein: e.protein * qty, carbs: e.carbs * qty, fat: e.fat * qty };
    });
    const photo = d % 5 === 0 && meal === 'lunch';
    logs.push({ id: `${d}${meal}`, date: `2026-10-${String(d).padStart(2, '0')}`, meal, plan: 'regular', ts: new Date(2026, 9, d, hour[meal], 10 + d).getTime(), source: photo ? 'photo' : 'menu', confidence: photo ? 'medium' : undefined, notes: photo ? 'Curd bowl partly hidden by the rice.' : '', items, ...totals(items), pending: false });
  }
}

const profile = { sex: 'male', age: 19, heightCm: 172, weightKg: 65, activity: 'light', goal: 'maintain' };
const calc = computeTargets(profile);
const targets = { kcal: calc.kcal, protein: calc.protein, carbs: calc.carbs, fat: calc.fat };
const base = { logs, now: new Date(2026, 9, 11, 22, 30), targets, profile, tdee: calc.tdee, times: DEFAULT_TIMES, offeredFor };

await mkdir(new URL('../samples/', import.meta.url), { recursive: true });
for (const [file, opts] of [
  ['sample-report.pdf', { from: '2026-10-01', to: '2026-10-11', periodName: 'This month', coachText: 'A steady stretch overall.\n\nLunch is doing most of the work on protein; breakfast is the meal to build up.' }],
  ['sample-day.pdf', { from: '2026-10-11', to: '2026-10-11' }],
]) {
  const { bytes, pages, name } = await buildReport({ ...base, ...opts });
  await writeFile(new URL(`../samples/${file}`, import.meta.url), bytes);
  console.log(file, '->', name, `${pages} pages, ${(bytes.length / 1024).toFixed(1)} KB`);
}

const activityDays = [];
for (let d = 1; d <= 11; d++) {
  const key = `2026-10-${String(d).padStart(2, '0')}`;
  const steps = 4000 + ((d * 1371) % 7000);
  const eaten = logs.filter((e) => e.date === key).reduce((a, e) => a + e.kcal, 0);
  const km = (steps * 0.714) / 1000;
  const walking = Math.round(0.5 * 65 * km);
  const workouts = d % 3 === 0 ? [{ type: 'Running', minutes: 30, intensity: 'moderate', kcal: 240, start: new Date(2026, 9, d, 18, 0).getTime() }] : [];
  const exercise = workouts.reduce((a, w) => a + w.kcal, 0);
  activityDays.push({ date: key, steps, km, floors: d % 4, resting: 1635, digestion: Math.round(eaten * 0.1), walking, stairs: (d % 4) * 2, exercise, total: 1635 + Math.round(eaten * 0.1) + walking + (d % 4) * 2 + exercise, eaten, source: 'sensor', workouts });
}
const activity = { days: activityDays, weights: [{ date: '2026-10-02', kg: 65.4 }, { date: '2026-10-09', kg: 65.9 }], stepGoal: 8000, profileReady: true };
const { bytes, pages } = await buildReport({ ...base, from: '2026-10-01', to: '2026-10-11', periodName: 'This month', activity });
await writeFile(new URL('../samples/sample-activity.pdf', import.meta.url), bytes);
console.log('sample-activity.pdf', `${pages} pages`);
