import { MEALS, MEAL_LABEL, dateKey, parseDateKey, mealWindows, formatDuration } from './menu.js';
import { groupFor } from './nutrition.js';

const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n) => Math.round(n * 100);

export function dayTotals(entries) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, meals: {}, count: 0, pending: 0 };
  for (const m of MEALS) t.meals[m] = 0;
  for (const e of entries) {
    if (e.pending) {
      t.pending++;
      continue;
    }
    t.kcal += e.kcal || 0;
    t.protein += e.protein || 0;
    t.carbs += e.carbs || 0;
    t.fat += e.fat || 0;
    t.meals[e.meal] = (t.meals[e.meal] || 0) + (e.kcal || 0);
    t.count++;
  }
  t.taken = MEALS.filter((m) => entries.some((e) => e.meal === m));
  return t;
}

export function eachDay(from, to) {
  const out = [];
  const end = parseDateKey(to);
  for (let d = parseDateKey(from); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(dateKey(d));
  return out;
}

export function summarise({ logs, from, to, now = new Date(), targets, times }) {
  const today = dateKey(now);
  const byDate = new Map();
  for (const e of logs) {
    if (e.date < from || e.date > to) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const logged = [...byDate.keys()].sort();
  const firstLogged = logged[0];
  const lastDay = to > today ? today : to;
  const span = firstLogged && firstLogged <= lastDay ? eachDay(from < firstLogged ? firstLogged : from, lastDay) : [];
  const days = span.map((date) => ({ date, ...dayTotals(byDate.get(date) || []) }));
  const active = days.filter((d) => d.count > 0);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const windows = mealWindows(times);
  const offered = (day, meal) => day.date < today || day.taken.includes(meal) || nowMin >= windows.find((w) => w.meal === meal).end;

  const attendance = {};
  let offeredTotal = 0;
  let takenTotal = 0;
  for (const meal of MEALS) {
    const off = days.filter((d) => offered(d, meal));
    const took = off.filter((d) => d.taken.includes(meal));
    attendance[meal] = { offered: off.length, taken: took.length, rate: off.length ? took.length / off.length : 0, avgKcal: Math.round(avg(took.map((d) => d.meals[meal]).filter(Boolean))) };
    offeredTotal += off.length;
    takenTotal += took.length;
  }

  const avgKcal = Math.round(avg(active.map((d) => d.kcal)));
  const macros = {
    protein: Math.round(avg(active.map((d) => d.protein))),
    carbs: Math.round(avg(active.map((d) => d.carbs))),
    fat: Math.round(avg(active.map((d) => d.fat))),
  };
  const onTarget = active.filter((d) => d.kcal >= targets.kcal * 0.9 && d.kcal <= targets.kcal * 1.1).length;
  const over = active.filter((d) => d.kcal > targets.kcal * 1.1).length;
  const under = active.length - onTarget - over;

  const weekday = DOW_LABEL.map((label, i) => {
    const ds = active.filter((d) => parseDateKey(d.date).getDay() === i);
    return { label, n: ds.length, kcal: Math.round(avg(ds.map((d) => d.kcal))) };
  });

  let worstSkip = null;
  for (const meal of MEALS) {
    for (let i = 0; i < 7; i++) {
      const off = days.filter((d) => parseDateKey(d.date).getDay() === i && offered(d, meal));
      if (off.length < 2) continue;
      const rate = off.filter((d) => !d.taken.includes(meal)).length / off.length;
      if (rate >= 0.5 && (!worstSkip || rate > worstSkip.rate || (rate === worstSkip.rate && off.length > worstSkip.n))) {
        worstSkip = { meal, dow: i, rate, n: off.length };
      }
    }
  }

  const dishes = new Map();
  for (const e of logs) {
    if (e.date < from || e.date > to || e.pending) continue;
    for (const it of e.items || []) {
      const key = it.name.trim().toLowerCase();
      if (!key) continue;
      const d = dishes.get(key) || { name: it.name.trim(), count: 0, kcal: 0 };
      d.count++;
      d.kcal += it.kcal || 0;
      dishes.set(key, d);
    }
  }
  const dishList = [...dishes.values()];
  const topDishes = [...dishList].sort((a, b) => b.count - a.count || b.kcal - a.kcal).slice(0, 6);
  const topCalories = [...dishList].sort((a, b) => b.kcal - a.kcal).slice(0, 6);

  const totalKcal = active.reduce((a, d) => a + d.kcal, 0);
  const mealShare = {};
  for (const meal of MEALS) mealShare[meal] = totalKcal ? active.reduce((a, d) => a + d.meals[meal], 0) / totalKcal : 0;

  const recent = active.slice(-7);
  const before = active.slice(-14, -7);
  const trend = recent.length >= 3 && before.length >= 3 ? Math.round(avg(recent.map((d) => d.kcal)) - avg(before.map((d) => d.kcal))) : null;

  const highest = [...active].sort((a, b) => b.kcal - a.kcal)[0] || null;
  const lowest = [...active].sort((a, b) => a.kcal - b.kcal)[0] || null;

  return {
    from, to, days, active, avgKcal, macros, onTarget, over, under,
    attendance, offeredTotal, takenTotal, utilisation: offeredTotal ? takenTotal / offeredTotal : 0,
    weekday, worstSkip, topDishes, topCalories, mealShare, trend, highest, lowest, totalKcal,
    photoLogs: logs.filter((e) => e.date >= from && e.date <= to && e.source === 'photo').length,
  };
}

export function streak(allLogs, now = new Date()) {
  const dates = new Set(allLogs.map((e) => e.date));
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!dates.has(dateKey(d))) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  let n = 0;
  while (dates.has(dateKey(d))) {
    n++;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  }
  return n;
}

const fmtDay = (key) => parseDateKey(key).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export function findings(s, targets) {
  const out = [];
  if (!s.active.length) return out;
  const diff = s.avgKcal - targets.kcal;
  if (Math.abs(diff) <= targets.kcal * 0.1) {
    out.push({ icon: 'target', title: 'Right around your target', text: `You average ${s.avgKcal.toLocaleString('en-IN')} kcal on logged days against a ${targets.kcal.toLocaleString('en-IN')} kcal target.` });
  } else {
    out.push({
      icon: 'target',
      title: diff > 0 ? `About ${Math.abs(diff)} kcal over target on average` : `About ${Math.abs(diff)} kcal under target on average`,
      text: `Logged days average ${s.avgKcal.toLocaleString('en-IN')} kcal. ${s.onTarget} of ${s.active.length} days landed within 10% of ${targets.kcal.toLocaleString('en-IN')}.`,
    });
  }
  const pGap = targets.protein - s.macros.protein;
  if (pGap > 10) {
    out.push({ icon: 'flame', title: `Protein is short by about ${pGap} g a day`, text: 'Sprouts, curd, dal, eggs, paneer and chana are the densest protein on this menu — an extra cup of dal and a curd closes most of that.' });
  } else if (s.macros.protein) {
    out.push({ icon: 'flame', title: 'Protein is on track', text: `${s.macros.protein} g a day on average against a ${targets.protein} g target.` });
  }
  if (s.offeredTotal >= 4) {
    const missed = s.offeredTotal - s.takenTotal;
    out.push({ icon: 'plate', title: `You ate ${pct(s.utilisation)}% of the mess meals on offer`, text: `${s.takenTotal} of ${s.offeredTotal} meals logged${missed ? `; ${missed} missed or unlogged` : ''}.` });
  }
  const weakest = MEALS.map((m) => ({ m, ...s.attendance[m] })).filter((a) => a.offered >= 3).sort((a, b) => a.rate - b.rate)[0];
  if (weakest && weakest.rate < 0.7) {
    out.push({ icon: 'clock', title: `${MEAL_LABEL[weakest.m]} is the meal you miss most`, text: `Logged on ${weakest.taken} of ${weakest.offered} days (${pct(weakest.rate)}%).` });
  }
  if (s.worstSkip) {
    const w = s.worstSkip;
    out.push({ icon: 'calendar', title: `${DOW_LABEL[w.dow]} ${MEAL_LABEL[w.meal].toLowerCase()} keeps getting skipped`, text: `Missed on ${pct(w.rate)}% of the ${w.n} ${DOW_LABEL[w.dow]}s in this period.` });
  }
  const wk = s.weekday.filter((w) => w.n);
  if (wk.length >= 3) {
    const hi = [...wk].sort((a, b) => b.kcal - a.kcal)[0];
    const lo = [...wk].sort((a, b) => a.kcal - b.kcal)[0];
    if (hi.kcal - lo.kcal > 250) out.push({ icon: 'chart', title: `${hi.label} is your heaviest day, ${lo.label} the lightest`, text: `${hi.kcal.toLocaleString('en-IN')} kcal vs ${lo.kcal.toLocaleString('en-IN')} kcal on average.` });
  }
  const bigMeal = MEALS.map((m) => ({ m, share: s.mealShare[m] })).sort((a, b) => b.share - a.share)[0];
  if (bigMeal.share > 0.42) out.push({ icon: 'plate', title: `${MEAL_LABEL[bigMeal.m]} carries ${pct(bigMeal.share)}% of your calories`, text: 'Spreading some of that to the other meals usually keeps energy steadier through the day.' });
  if (s.trend != null && Math.abs(s.trend) >= 100) {
    out.push({ icon: 'trend', title: `Intake is trending ${s.trend > 0 ? 'up' : 'down'} by ${Math.abs(s.trend)} kcal a day`, text: 'Last 7 logged days compared with the 7 before.' });
  }
  if (s.topCalories[0]) {
    const d = s.topCalories[0];
    out.push({ icon: 'sparkle', title: `${d.name} is your biggest calorie source`, text: `${Math.round(d.kcal).toLocaleString('en-IN')} kcal across ${d.count} ${d.count === 1 ? 'serving' : 'servings'} in this period.` });
  }
  if (s.highest && s.active.length >= 3) {
    out.push({ icon: 'chart', title: `Highest day: ${fmtDay(s.highest.date)}`, text: `${Math.round(s.highest.kcal).toLocaleString('en-IN')} kcal. Lowest was ${fmtDay(s.lowest.date)} at ${Math.round(s.lowest.kcal).toLocaleString('en-IN')} kcal.` });
  }
  return out;
}

export function coachPayload(s, targets, label) {
  return {
    period: label,
    days_logged: s.active.length,
    targets,
    average_per_logged_day: { kcal: s.avgKcal, ...s.macros },
    days_on_target: s.onTarget, days_over: s.over, days_under: s.under,
    meal_attendance_percent: Object.fromEntries(MEALS.map((m) => [m, pct(s.attendance[m].rate)])),
    calorie_share_by_meal_percent: Object.fromEntries(MEALS.map((m) => [m, pct(s.mealShare[m])])),
    average_kcal_by_weekday: Object.fromEntries(s.weekday.filter((w) => w.n).map((w) => [w.label, w.kcal])),
    most_eaten_dishes: s.topDishes.map((d) => ({ dish: d.name, times: d.count })),
    biggest_calorie_sources: s.topCalories.map((d) => ({ dish: d.name, kcal: Math.round(d.kcal) })),
    daily_kcal: s.active.map((d) => ({ date: d.date, kcal: Math.round(d.kcal), protein_g: Math.round(d.protein) })),
  };
}

export const MACRO_RANGE = { protein: [10, 35], carbs: [45, 65], fat: [20, 35] };
const MACRO_KCAL = { protein: 4, carbs: 4, fat: 9 };
const sumOf = (xs, k) => xs.reduce((a, x) => a + (Number(x[k]) || 0), 0);
const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export function dayReport({ entries, dateK, now = new Date(), targets, tdee = null, weightKg = null, times, offered = {}, prior = [] }) {
  const done = entries.filter((e) => !e.pending);
  const t = dayTotals(entries);
  const today = dateKey(now);
  const isToday = dateK === today;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const windows = mealWindows(times);
  const safe = t.kcal || 1;

  const meals = MEALS.map((meal) => {
    const es = done.filter((e) => e.meal === meal);
    const w = windows.find((x) => x.meal === meal);
    const state = es.length ? 'eaten'
      : entries.some((e) => e.meal === meal) ? 'pending'
      : dateK < today || (isToday && nowMin >= w.end) ? 'missed' : dateK > today || isToday ? 'upcoming' : 'missed';
    const kcal = sumOf(es, 'kcal');
    return {
      meal, state, kcal, protein: sumOf(es, 'protein'), carbs: sumOf(es, 'carbs'), fat: sumOf(es, 'fat'),
      share: kcal / safe, items: es.reduce((a, e) => a + (e.items || []).length, 0), at: es.length ? Math.min(...es.map((e) => e.ts)) : null,
    };
  });

  const energy = { protein: t.protein * 4, carbs: t.carbs * 4, fat: t.fat * 9 };
  const eSum = energy.protein + energy.carbs + energy.fat || 1;
  const split = Object.fromEntries(Object.keys(energy).map((k) => {
    const pct = (energy[k] / eSum) * 100;
    const [lo, hi] = MACRO_RANGE[k];
    return [k, { grams: t[k], kcal: energy[k], pct, lo, hi, verdict: !t.kcal ? 'none' : pct < lo ? 'low' : pct > hi ? 'high' : 'ok' }];
  }));

  const items = done
    .flatMap((e) => (e.items || []).map((i) => ({ ...i, meal: e.meal, group: groupFor(i.name), share: (i.kcal || 0) / safe })))
    .sort((a, b) => (b.kcal || 0) - (a.kcal || 0));

  const groupMap = new Map();
  for (const i of items) {
    const g = groupMap.get(i.group) || { name: i.group, kcal: 0, protein: 0, count: 0 };
    g.kcal += i.kcal || 0;
    g.protein += i.protein || 0;
    g.count++;
    groupMap.set(i.group, g);
  }
  const groups = [...groupMap.values()].sort((a, b) => b.kcal - a.kcal).map((g) => ({ ...g, share: g.kcal / safe }));
  const group = (name) => groupMap.get(name) || { kcal: 0, protein: 0, count: 0 };

  const sorted = [...done].sort((a, b) => a.ts - b.ts);
  const clock = sorted.map((e, i) => ({ ts: e.ts, at: hhmm(e.ts), meal: e.meal, kcal: e.kcal, gap: i ? Math.round((e.ts - sorted[i - 1].ts) / 60000) : null }));
  const eatingWindow = sorted.length > 1 ? Math.round((sorted[sorted.length - 1].ts - sorted[0].ts) / 60000) : 0;
  const longestGap = Math.max(0, ...clock.map((c) => c.gap || 0));

  const balance = t.kcal - targets.kcal;
  const vsMaintenance = tdee ? t.kcal - tdee : null;
  const ratio = targets.kcal ? t.kcal / targets.kcal : 0;
  const stillOpen = isToday && meals.some((m) => m.state === 'upcoming');
  const verdict = !done.length ? 'No entries' : stillOpen && ratio < 0.9 ? 'In progress' : ratio < 0.9 ? 'Under' : ratio > 1.1 ? 'Over' : 'On target';

  const loggedNames = items.map((i) => i.name.toLowerCase());
  const passedOver = MEALS.filter((m) => meals.find((x) => x.meal === m).state === 'eaten')
    .flatMap((m) => (offered[m] || []).map((o) => ({ ...o, meal: m })))
    .filter((o) => o.est.protein >= 7 && !loggedNames.some((n) => n.includes(o.line.toLowerCase()) || o.line.toLowerCase().includes(n)))
    .sort((a, b) => b.est.protein - a.est.protein)
    .slice(0, 3);

  const priorDays = new Map();
  for (const e of prior) {
    if (e.pending) continue;
    const d = priorDays.get(e.date) || { kcal: 0, protein: 0 };
    d.kcal += e.kcal || 0;
    d.protein += e.protein || 0;
    priorDays.set(e.date, d);
  }
  const pd = [...priorDays.values()];
  const recent = pd.length ? { n: pd.length, kcal: Math.round(avg(pd.map((d) => d.kcal))), protein: Math.round(avg(pd.map((d) => d.protein))) } : null;

  const photo = done.filter((e) => e.source === 'photo');
  const r = {
    dateK, isToday, totals: t, meals, split, items, groups, clock, eatingWindow, longestGap,
    balance, vsMaintenance, weeklyKg: vsMaintenance == null ? null : (vsMaintenance * 7) / 7700,
    proteinPerKg: weightKg ? t.protein / weightKg : null, ratio, verdict, passedOver, recent,
    entries: done.length, photoEntries: photo.length, lowConfidence: photo.filter((e) => e.confidence === 'low').length,
    fried: group('Fried snacks'), sweets: group('Sweets'), drinks: group('Drinks'), fruit: group('Fruit'),
  };
  r.notes = dayNotes(r, targets);
  return r;
}

function dayNotes(r, targets) {
  const out = [];
  const t = r.totals;
  if (!r.entries) return out;
  const k = (n) => Math.round(n).toLocaleString('en-IN');
  const eaten = r.meals.filter((m) => m.state === 'eaten');
  const big = [...eaten].sort((a, b) => b.kcal - a.kcal)[0];

  if (r.verdict === 'Over') out.push([`${k(r.balance)} kcal over target`, `You ate ${k(t.kcal)} against ${k(targets.kcal)}. ${big ? `${MEAL_LABEL[big.meal]} alone was ${k(big.kcal)} kcal.` : ''}`]);
  else if (r.verdict === 'Under') out.push([`${k(-r.balance)} kcal under target`, `You ate ${k(t.kcal)} against ${k(targets.kcal)}. Regularly eating this far under makes it hard to hold energy and muscle.`]);
  else if (r.verdict === 'On target') out.push(['Landed on target', `${k(t.kcal)} kcal against ${k(targets.kcal)} — within 10%.`]);
  else if (r.verdict === 'In progress') out.push([`${k(-r.balance)} kcal still to go`, 'The day is not over; meals are still to come.']);

  if (big && big.share > 0.45 && eaten.length > 1) out.push([`${MEAL_LABEL[big.meal]} carried ${pct(big.share)}% of the day`, 'A flatter spread across meals usually keeps energy steadier than one heavy sitting.']);
  const top = r.items[0];
  if (top && top.share >= 0.22) out.push([`${top.name} was your single biggest item`, `${k(top.kcal)} kcal — ${pct(top.share)}% of everything you ate.`]);

  const pGap = targets.protein - t.protein;
  const perKg = r.proteinPerKg ? ` That is ${r.proteinPerKg.toFixed(1)} g per kg of body weight.` : '';
  if (pGap > 10) out.push([`Protein short by ${k(pGap)} g`, `${k(t.protein)} g of a ${k(targets.protein)} g target.${perKg}`]);
  else out.push(['Protein target met', `${k(t.protein)} g against ${k(targets.protein)} g.${perKg}`]);
  const thin = eaten.filter((m) => m.protein < 15 && m.meal !== 'snacks');
  if (thin.length) out.push([`${thin.map((m) => MEAL_LABEL[m.meal]).join(' and ')} ${thin.length > 1 ? 'were' : 'was'} light on protein`, `Under 15 g ${thin.length > 1 ? 'each' : 'in that meal'}. Roughly 20–30 g per main meal is a common aim.`]);
  if (r.passedOver.length) out.push(['Protein you walked past', `On the counter but not on your plate: ${r.passedOver.map((o) => `${o.line} (~${k(o.est.protein)} g)`).join(', ')}.`]);

  for (const key of ['carbs', 'fat', 'protein']) {
    const s = r.split[key];
    if (s.verdict === 'high') out.push([`${key[0].toUpperCase()}${key.slice(1)} share is high`, `${Math.round(s.pct)}% of energy came from ${key}; the usual range is ${s.lo}–${s.hi}%.`]);
    if (s.verdict === 'low' && key !== 'protein') out.push([`${key[0].toUpperCase()}${key.slice(1)} share is low`, `${Math.round(s.pct)}% of energy came from ${key}; the usual range is ${s.lo}–${s.hi}%.`]);
  }
  if (r.fried.kcal >= 150) out.push([`Fried food added ${k(r.fried.kcal)} kcal`, `${r.fried.count} fried ${r.fried.count === 1 ? 'item' : 'items'} — ${pct(r.fried.kcal / (t.kcal || 1))}% of the day.`]);
  if (r.sweets.kcal >= 120) out.push([`Sweets added ${k(r.sweets.kcal)} kcal`, `${pct(r.sweets.kcal / (t.kcal || 1))}% of the day.`]);
  if (r.drinks.kcal >= 180) out.push([`${k(r.drinks.kcal)} kcal came from drinks`, 'Tea, coffee, juice and milk drinks add up without filling you.']);
  if (!r.fruit.count && eaten.length >= 2) out.push(['No fruit logged', 'The mess usually puts fruit out at dinner.']);

  const missed = r.meals.filter((m) => m.state === 'missed');
  if (missed.length) out.push([`Missed ${missed.map((m) => MEAL_LABEL[m.meal].toLowerCase()).join(', ')}`, `${4 - missed.length} of 4 mess meals eaten.`]);
  if (r.longestGap >= 360) out.push([`${formatDuration(r.longestGap)} between two meals`, 'Long gaps tend to end in a bigger next meal.']);
  if (r.recent && Math.abs(t.kcal - r.recent.kcal) >= 200 && r.verdict !== 'In progress') {
    out.push([`${k(Math.abs(t.kcal - r.recent.kcal))} kcal ${t.kcal > r.recent.kcal ? 'above' : 'below'} your recent average`, `Your last ${r.recent.n} logged ${r.recent.n === 1 ? 'day' : 'days'} averaged ${k(r.recent.kcal)} kcal.`]);
  }
  if (r.lowConfidence) out.push([`${r.lowConfidence} photo ${r.lowConfidence === 1 ? 'estimate was' : 'estimates were'} low-confidence`, 'Open those entries and correct portions if they look off.']);
  return out.map(([title, text]) => ({ title, text }));
}

export function dayPayload(r, targets) {
  const n = (x) => Math.round(x);
  return {
    date: r.dateK, day_complete: r.verdict !== 'In progress', targets,
    totals: { kcal: n(r.totals.kcal), protein_g: n(r.totals.protein), carbs_g: n(r.totals.carbs), fat_g: n(r.totals.fat) },
    energy_share_percent: Object.fromEntries(Object.entries(r.split).map(([k, v]) => [k, n(v.pct)])),
    meals: r.meals.map((m) => ({ meal: m.meal, status: m.state, time: m.at ? hhmm(m.at) : null, kcal: n(m.kcal), protein_g: n(m.protein) })),
    items: r.items.map((i) => ({ item: i.name, meal: i.meal, kcal: n(i.kcal), protein_g: n(i.protein), group: i.group })),
    kcal_by_food_group: Object.fromEntries(r.groups.map((g) => [g.name, n(g.kcal)])),
    kcal_vs_maintenance: r.vsMaintenance == null ? null : n(r.vsMaintenance),
    protein_g_per_kg: r.proteinPerKg ? Number(r.proteinPerKg.toFixed(2)) : null,
    high_protein_dishes_served_but_not_taken: r.passedOver.map((o) => o.line),
    recent_daily_average: r.recent,
  };
}
