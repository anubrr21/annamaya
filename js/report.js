import { Pdf, PAGE, textWidth, wrap, fit } from './pdf.js';
import { MEALS, MEAL_LABEL, parseDateKey, dateKey, formatDuration } from './menu.js';
import { summarise, findings, dayReport, streak, MACRO_RANGE } from './insights.js';
import { groupFor } from './nutrition.js';

const M = 42;
const CW = PAGE.w - M * 2;
const BOTTOM = PAGE.h - 56;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const INK = hex('#17140f');
const INK2 = hex('#4a443a');
const MUTED = hex('#857b6a');
const RULE = hex('#cfc7b6');
const SLIP = hex('#f4eee1');
const RED = hex('#cf3a28');
const WHITE = [1, 1, 1];
const MEAL_COLOR = { breakfast: hex('#eda100'), lunch: hex('#2a78d6'), snacks: hex('#e87ba4'), dinner: hex('#4a3aa7') };

const num = (v) => Math.round(v || 0).toLocaleString('en-IN');
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${num(Math.abs(v))}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const longDate = (k) => parseDateKey(k).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dayHeading = (k) => parseDateKey(k).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const clock = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function drawSeal(doc, cx, cy, R, color) {
  const u = R / 56;
  const tilt = (-7 * Math.PI) / 180;
  doc.circle(cx, cy, 56 * u, { color, width: 3.5 * u });
  doc.circle(cx, cy, 37.5 * u, { color, width: 1.5 * u });
  const label = 'ANNAMAYA • MESS JOURNAL • EAT WELL • ';
  const step = (Math.PI * 2) / label.length;
  const size = 10.5 * u;
  [...label].forEach((ch, i) => {
    if (ch === ' ') return;
    const a = -Math.PI + (i + 0.5) * step + tilt;
    const half = textWidth(ch, 'bold', size) / 2;
    const rb = 42.8 * u;
    const x = cx + rb * Math.cos(a) + half * Math.sin(a);
    const y = cy + rb * Math.sin(a) - half * Math.cos(a);
    doc.text(x, y, ch, { font: 'bold', size, color, angle: -(a + Math.PI / 2) });
  });
  for (let k = 0; k < 4; k++) {
    const a0 = ((-81 + 90 * k) * Math.PI) / 180 + tilt;
    doc.arc(cx, cy, 27 * u, a0, a0 + (73.8 * Math.PI) / 180, { color, width: 5.5 * u });
  }
  doc.ellipse(cx, cy, 8.5 * u, 16.5 * u, (32 * Math.PI) / 180 + tilt, color);
}

export async function buildReport({ logs, from, to, now = new Date(), targets, profile = {}, tdee = null, times, offeredFor = () => [], coachText = '', periodName = '', activity = null }) {
  const doc = new Pdf();
  let y = M;
  const s = summarise({ logs, from, to, now, targets, times });
  const inRange = logs.filter((e) => e.date >= from && e.date <= to && !e.pending);
  const single = from === to;
  const spanDays = Math.round((parseDateKey(to) - parseDateKey(from)) / 864e5) + 1;
  const period = single ? longDate(from) : `${longDate(from)} – ${longDate(to)}`;

  const ensure = (h) => {
    if (y + h <= BOTTOM) return false;
    doc.addPage();
    y = M;
    return true;
  };

  const section = (title, aside = '', keep = 60) => {
    ensure(34 + keep);
    y += 10;
    doc.text(M, y + 13, title.toUpperCase(), { font: 'bold', size: 15, scale: 0.8, color: INK });
    if (aside) doc.text(PAGE.w - M, y + 12, aside.toUpperCase(), { font: 'mono', size: 6.5, color: MUTED, align: 'right' });
    doc.line(M, y + 19, PAGE.w - M, y + 19, { color: INK, width: 1.2 });
    y += 30;
  };

  const tiles = (items) => {
    const per = 4;
    const w = CW / per;
    const h = 56;
    for (let i = 0; i < items.length; i += per) {
      ensure(h + 2);
      items.slice(i, i + per).forEach((t, j) => {
        const x = M + j * w;
        doc.rect(x, y, w, h, { stroke: INK, width: 0.8 });
        doc.text(x + 8, y + 12, t.label.toUpperCase(), { font: 'mono', size: 6.2, color: MUTED });
        const vw = doc.text(x + 8, y + 35, t.value, { font: 'bold', size: 21, scale: 0.8, color: t.color || INK });
        if (t.unit) doc.text(x + 11 + vw, y + 35, t.unit.toUpperCase(), { font: 'mono', size: 6.5, color: INK2 });
        if (t.sub) doc.text(x + 8, y + 48, fit(t.sub, w - 14, 'mono', 6.3), { font: 'mono', size: 6.3, color: INK2 });
      });
      y += h;
    }
    y += 6;
  };

  const table = (cols, rows, { rowH = 14 } = {}) => {
    const total = cols.reduce((a, c) => a + c.w, 0);
    const k = CW / total;
    const xs = [];
    let x = M;
    for (const c of cols) {
      xs.push(x);
      x += c.w * k;
    }
    const header = () => {
      cols.forEach((c, i) => {
        const w = c.w * k;
        doc.text(c.align === 'right' ? xs[i] + w - 3 : xs[i] + 2, y + 8, c.label.toUpperCase(), { font: 'mono', size: 6.2, color: MUTED, align: c.align === 'right' ? 'right' : 'left' });
      });
      doc.line(M, y + 12, PAGE.w - M, y + 12, { color: INK, width: 0.8 });
      y += 15;
    };
    ensure(15 + rowH * Math.min(rows.length, 3));
    header();
    for (const row of rows) {
      if (ensure(rowH)) header();
      if (row.rule) doc.line(M, y - 1, PAGE.w - M, y - 1, { color: INK, width: 0.8 });
      row.cells.forEach((cell, i) => {
        const c = cols[i];
        const w = c.w * k;
        if (cell && typeof cell === 'object' && 'bar' in cell) {
          doc.rect(xs[i] + 3, y + 2, w - 8, 7, { stroke: RULE, width: 0.5 });
          doc.rect(xs[i] + 3, y + 2, Math.max(0, Math.min(1, cell.bar)) * (w - 8), 7, { fill: cell.color || INK });
          return;
        }
        const obj = cell && typeof cell === 'object' ? cell : { text: cell };
        const font = obj.font || (row.bold ? (c.font === 'helv' ? 'bold' : 'monob') : c.font || 'mono');
        const size = c.size || 8;
        const str = fit(obj.text == null ? '' : String(obj.text), w - 5, font, size);
        doc.text(c.align === 'right' ? xs[i] + w - 3 : xs[i] + 2, y + 9, str, { font, size, color: obj.color || (row.muted ? MUTED : INK), align: c.align === 'right' ? 'right' : 'left' });
        if (obj.swatch) doc.rect(xs[i] + 2, y + 3, 6, 6, { fill: obj.swatch });
      });
      doc.line(M, y + rowH - 1.5, PAGE.w - M, y + rowH - 1.5, { color: RULE, width: 0.4 });
      y += rowH;
    }
    y += 6;
  };

  const paragraph = (text, { font = 'helv', size = 9, color = INK2, indent = 0, lead = 1.38 } = {}) => {
    for (const line of wrap(text, CW - indent, font, size)) {
      ensure(size * lead);
      doc.text(M + indent, y + size, line, { font, size, color });
      y += size * lead;
    }
  };

  drawSeal(doc, M + 36, y + 36, 36, RED);
  doc.text(M + 86, y + 32, 'ANNAMAYA', { font: 'bold', size: 34, scale: 0.78, color: INK });
  doc.text(M + 87, y + 47, single ? 'DAILY STATEMENT' : 'MESS JOURNAL REPORT', { font: 'mono', size: 8.5, color: INK2 });
  doc.text(M + 87, y + 59, 'Your mess, plate by plate.', { font: 'helv', size: 8, color: MUTED });
  const rx = PAGE.w - M;
  doc.text(rx, y + 12, 'REPORT PERIOD', { font: 'mono', size: 6.5, color: MUTED, align: 'right' });
  doc.text(rx, y + 29, period, { font: 'bold', size: single ? 15 : 12.5, scale: 0.88, color: INK, align: 'right' });
  doc.text(rx, y + 42, `${periodName ? `${periodName} · ` : ''}${spanDays} ${spanDays === 1 ? 'day' : 'days'} · ${s.active.length} logged`.toUpperCase(), { font: 'mono', size: 7, color: INK2, align: 'right' });
  doc.text(rx, y + 53, `From ${longDate(from)} to ${longDate(to)}`, { font: 'mono', size: 6.8, color: INK2, align: 'right' });
  doc.text(rx, y + 64, `Generated ${now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, ${clock(now.getTime())}`, { font: 'mono', size: 6.5, color: MUTED, align: 'right' });
  y += 80;
  doc.line(M, y, PAGE.w - M, y, { color: INK, width: 1.6 });
  doc.line(M, y + 3, PAGE.w - M, y + 3, { color: INK, width: 0.5 });
  y += 15;
  doc.text(M, y, `DAILY TARGETS   ${num(targets.kcal)} kcal · protein ${num(targets.protein)} g · carbs ${num(targets.carbs)} g · fat ${num(targets.fat)} g`, { font: 'mono', size: 7.2, color: INK });
  y += 11;
  if (profile.weightKg && profile.heightCm && profile.age) {
    doc.text(M, y, `PROFILE         ${profile.sex === 'female' ? 'Female' : 'Male'}, ${profile.age} y, ${profile.heightCm} cm, ${profile.weightKg} kg · activity ${profile.activity || 'light'} · goal ${profile.goal || 'maintain'}${tdee ? ` · maintenance about ${num(tdee)} kcal` : ''}`, { font: 'mono', size: 7.2, color: INK2 });
    y += 11;
  }
  y += 4;

  if (!s.active.length) {
    section('Nothing logged');
    paragraph('No meals were logged in this period, so there is nothing to analyse yet.');
  } else {
    const totalP = s.active.reduce((a, d) => a + d.protein, 0);
    const delta = s.avgKcal - targets.kcal;
    tiles([
      { label: single ? 'Eaten' : 'Average per logged day', value: num(s.avgKcal), unit: 'kcal', sub: Math.abs(delta) < 50 ? 'on target' : `${signed(delta)} vs ${num(targets.kcal)} target`, color: Math.abs(delta) > targets.kcal * 0.1 ? RED : INK },
      { label: 'Total in period', value: num(s.totalKcal), unit: 'kcal', sub: `${num(totalP)} g protein in total` },
      { label: 'Days on target', value: `${s.onTarget}/${s.active.length}`, sub: `${s.over} over · ${s.under} under (within 10%)` },
      { label: 'Mess meals eaten', value: pct(s.utilisation), sub: `${s.takenTotal} of ${s.offeredTotal} meals served` },
      { label: 'Protein per day', value: num(s.macros.protein), unit: 'g', sub: `target ${num(targets.protein)} g${profile.weightKg ? ` · ${(s.macros.protein / profile.weightKg).toFixed(1)} g/kg` : ''}` },
      { label: 'Carbs per day', value: num(s.macros.carbs), unit: 'g', sub: `target ${num(targets.carbs)} g` },
      { label: 'Fat per day', value: num(s.macros.fat), unit: 'g', sub: `target ${num(targets.fat)} g` },
      tdee ? { label: 'Vs maintenance', value: signed(s.avgKcal - tdee), unit: 'kcal', sub: `${s.avgKcal - tdee >= 0 ? '+' : '-'}${Math.abs(((s.avgKcal - tdee) * 7) / 7700).toFixed(2)} kg a week if kept up` }
        : { label: 'Logging streak', value: String(streak(logs, now)), unit: 'days', sub: `${s.photoLogs} photo estimates in period` },
    ]);

    if (!single) {
      section('Daily calories', 'stacked by meal · dashed line is the target');
      const map = new Map(s.days.map((d) => [d.date, d]));
      const keys = s.days.map((d) => d.date).slice(-62);
      const H = 118;
      ensure(H + 40);
      const x0 = M + 26;
      const w = CW - 26;
      const peak = Math.max(targets.kcal * 1.15, ...keys.map((k) => map.get(k).kcal));
      const stepV = peak > 3000 ? 1000 : 500;
      const max = Math.ceil(peak / stepV) * stepV;
      const py = (v) => y + H - (v / max) * H;
      for (let v = 0; v <= max; v += max / 4) {
        doc.line(x0, py(v), x0 + w, py(v), { color: RULE, width: 0.4 });
        doc.text(x0 - 4, py(v) + 2.3, v >= 1000 ? `${v / 1000}k` : String(v), { font: 'mono', size: 6.2, color: MUTED, align: 'right' });
      }
      const slot = w / keys.length;
      const bw = Math.max(2, Math.min(26, slot * 0.68));
      const every = Math.ceil(keys.length / 16);
      keys.forEach((k, i) => {
        const d = map.get(k);
        const bx = x0 + i * slot + (slot - bw) / 2;
        let acc = 0;
        for (const meal of MEALS) {
          const v = d.meals[meal] || 0;
          if (!v) continue;
          const top = py(acc + v);
          doc.rect(bx, top, bw, Math.max(0.6, py(acc) - top - (bw > 6 ? 0.8 : 0)), { fill: MEAL_COLOR[meal] });
          acc += v;
        }
        if (i % every === 0) {
          const dt = parseDateKey(k);
          doc.text(bx + bw / 2, y + H + 9, keys.length > 9 ? String(dt.getDate()) : dt.toLocaleDateString('en-IN', { weekday: 'short' }), { font: 'mono', size: 6.2, color: MUTED, align: 'center' });
        }
      });
      doc.line(x0, py(0), x0 + w, py(0), { color: INK, width: 0.8 });
      doc.line(x0, py(targets.kcal), x0 + w, py(targets.kcal), { color: RED, width: 0.9, dash: [4, 3] });
      const tl = `TARGET ${num(targets.kcal)}`;
      const tw = textWidth(tl, 'monob', 6.2);
      doc.rect(x0 + w - tw - 5, py(targets.kcal) - 11, tw + 5, 8.5, { fill: WHITE });
      doc.text(x0 + w - 2, py(targets.kcal) - 4.5, tl, { font: 'monob', size: 6.2, color: RED, align: 'right' });
      y += H + 20;
      let lx = x0;
      for (const meal of MEALS) {
        doc.rect(lx, y - 6, 7, 7, { fill: MEAL_COLOR[meal] });
        lx += 11 + doc.text(lx + 10, y, MEAL_LABEL[meal].toUpperCase(), { font: 'mono', size: 6.5, color: INK2 }) + 14;
      }
      y += 8;

      section('Day by day', 'kcal by meal, macros in grams', 90);
      table(
        [{ label: 'Date', w: 86, font: 'helv' }, { label: 'Breakfast', w: 46, align: 'right' }, { label: 'Lunch', w: 42, align: 'right' }, { label: 'Snacks', w: 42, align: 'right' }, { label: 'Dinner', w: 42, align: 'right' },
          { label: 'Total', w: 46, align: 'right' }, { label: 'P', w: 28, align: 'right' }, { label: 'C', w: 30, align: 'right' }, { label: 'F', w: 28, align: 'right' }, { label: 'Vs target', w: 46, align: 'right' }, { label: 'Result', w: 50 }],
        [
          ...s.days.map((d) => {
            const ratio = d.kcal / targets.kcal;
            const verdict = !d.count ? 'not logged' : ratio < 0.9 ? 'under' : ratio > 1.1 ? 'over' : 'on target';
            return {
              muted: !d.count,
              cells: [parseDateKey(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }),
                ...MEALS.map((m) => (d.meals[m] ? num(d.meals[m]) : '–')),
                { text: d.count ? num(d.kcal) : '–', font: 'monob' }, d.count ? num(d.protein) : '–', d.count ? num(d.carbs) : '–', d.count ? num(d.fat) : '–',
                d.count ? signed(d.kcal - targets.kcal) : '–', { text: verdict, color: verdict === 'over' || verdict === 'under' ? RED : verdict === 'on target' ? INK : MUTED }],
            };
          }),
          { bold: true, rule: true, cells: ['Average', ...MEALS.map((m) => num(s.active.reduce((a, d) => a + d.meals[m], 0) / s.active.length)), num(s.avgKcal), num(s.macros.protein), num(s.macros.carbs), num(s.macros.fat), signed(delta), ''] },
        ],
      );
    }

    section('Meals', 'attendance and contribution', 80);
    table(
      [{ label: 'Meal', w: 80, font: 'helv' }, { label: 'Eaten', w: 40, align: 'right' }, { label: 'Served', w: 40, align: 'right' }, { label: 'Attendance', w: 54, align: 'right' }, { label: '', w: 90 }, { label: 'Avg kcal', w: 50, align: 'right' }, { label: 'Share of kcal', w: 60, align: 'right' }, { label: '', w: 90 }],
      MEALS.map((m) => {
        const a = s.attendance[m];
        return { cells: [{ text: `    ${MEAL_LABEL[m]}`, swatch: MEAL_COLOR[m], font: 'bold' }, String(a.taken), String(a.offered), pct(a.rate), { bar: a.rate, color: MEAL_COLOR[m] }, a.avgKcal ? num(a.avgKcal) : '–', pct(s.mealShare[m]), { bar: s.mealShare[m], color: MEAL_COLOR[m] }] };
      }),
    );

    section('Macronutrients', 'average per logged day', 66);
    const energy = { protein: s.macros.protein * 4, carbs: s.macros.carbs * 4, fat: s.macros.fat * 9 };
    const eSum = energy.protein + energy.carbs + energy.fat || 1;
    table(
      [{ label: 'Macro', w: 70, font: 'helv' }, { label: 'Grams', w: 44, align: 'right' }, { label: 'Target g', w: 48, align: 'right' }, { label: 'Of target', w: 48, align: 'right' }, { label: 'kcal', w: 44, align: 'right' }, { label: '% of energy', w: 56, align: 'right' }, { label: '', w: 70 }, { label: 'Usual range', w: 56, align: 'right' }, { label: 'Status', w: 74 }],
      ['protein', 'carbs', 'fat'].map((k) => {
        const share = energy[k] / eSum;
        const [lo, hi] = MACRO_RANGE[k];
        const status = share * 100 < lo ? 'below range' : share * 100 > hi ? 'above range' : 'within range';
        return { cells: [{ text: k[0].toUpperCase() + k.slice(1), font: 'bold' }, num(s.macros[k]), num(targets[k]), pct(s.macros[k] / (targets[k] || 1)), num(energy[k]), pct(share), { bar: share, color: INK }, `${lo}–${hi}%`, { text: status, color: status === 'within range' ? INK : RED }] };
      }),
    );

    const items = inRange.flatMap((e) => (e.items || []).map((i) => ({ ...i, meal: e.meal, date: e.date })));
    const groups = new Map();
    for (const i of items) {
      const g = groups.get(groupFor(i.name)) || { kcal: 0, protein: 0, count: 0 };
      g.kcal += i.kcal || 0;
      g.protein += i.protein || 0;
      g.count++;
      groups.set(groupFor(i.name), g);
    }
    const groupRows = [...groups].sort((a, b) => b[1].kcal - a[1].kcal);
    const topGroup = groupRows[0] ? groupRows[0][1].kcal : 1;
    section('Food groups', 'where the calories came from', 90);
    table(
      [{ label: 'Group', w: 110, font: 'helv' }, { label: 'Items', w: 40, align: 'right' }, { label: 'kcal', w: 54, align: 'right' }, { label: 'Share', w: 44, align: 'right' }, { label: '', w: 150 }, { label: 'Protein g', w: 54, align: 'right' }, { label: 'kcal / day', w: 54, align: 'right' }],
      groupRows.map(([name, g]) => ({ cells: [name, String(g.count), num(g.kcal), pct(g.kcal / (s.totalKcal || 1)), { bar: g.kcal / topGroup, color: INK }, num(g.protein), num(g.kcal / s.active.length)] })),
    );

    const dishes = new Map();
    for (const i of items) {
      const key = i.name.trim().toLowerCase();
      const d = dishes.get(key) || { name: i.name.trim(), count: 0, kcal: 0, protein: 0 };
      d.count++;
      d.kcal += i.kcal || 0;
      d.protein += i.protein || 0;
      dishes.set(key, d);
    }
    const dishRows = [...dishes.values()].sort((a, b) => b.kcal - a.kcal).slice(0, 15);
    section('Dishes', `top ${dishRows.length} by calories · ${dishes.size} different dishes logged`, 90);
    table(
      [{ label: '#', w: 18, align: 'right' }, { label: 'Dish', w: 190, font: 'helv' }, { label: 'Times', w: 36, align: 'right' }, { label: 'Total kcal', w: 54, align: 'right' }, { label: 'Avg kcal', w: 48, align: 'right' }, { label: 'Protein g', w: 50, align: 'right' }, { label: 'Share', w: 40, align: 'right' }, { label: '', w: 70 }],
      dishRows.map((d, i) => ({ cells: [String(i + 1), d.name, `${d.count}×`, num(d.kcal), num(d.kcal / d.count), num(d.protein), pct(d.kcal / (s.totalKcal || 1)), { bar: d.kcal / dishRows[0].kcal, color: INK }] })),
    );

    if (!single && s.weekday.filter((w) => w.n).length > 1) {
      const maxWk = Math.max(1, ...s.weekday.map((w) => w.kcal));
      section('Weekday pattern', 'average kcal by day of the week', 118);
      table(
        [{ label: 'Day', w: 70, font: 'helv' }, { label: 'Days logged', w: 60, align: 'right' }, { label: 'Avg kcal', w: 60, align: 'right' }, { label: '', w: 220 }, { label: 'Vs target', w: 60, align: 'right' }],
        [1, 2, 3, 4, 5, 6, 0].map((i) => {
          const w = s.weekday[i];
          return { muted: !w.n, cells: [['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i], String(w.n), w.n ? num(w.kcal) : '–', { bar: w.n ? w.kcal / maxWk : 0, color: INK }, w.n ? signed(w.kcal - targets.kcal) : '–'] };
        }),
      );
    }

    const act = activity && activity.days.length ? activity : null;
    if (act) {
      const ad = act.days;
      const withSteps = ad.filter((d) => d.steps > 0);
      const avgOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      const workouts = ad.flatMap((d) => d.workouts.map((w) => ({ ...w, date: d.date })));
      section('Movement', `steps, distance, floors and workouts · goal ${num(act.stepGoal)} steps`, 90);
      tiles([
        { label: 'Steps per day', value: num(avgOf(withSteps.map((d) => d.steps))), sub: `${withSteps.filter((d) => d.steps >= act.stepGoal).length} of ${withSteps.length} days at goal` },
        { label: 'Distance', value: ad.reduce((a, d) => a + d.km, 0).toFixed(1), unit: 'km', sub: `${(ad.reduce((a, d) => a + d.km, 0) / Math.max(1, withSteps.length)).toFixed(2)} km a day` },
        { label: 'Floors climbed', value: num(ad.reduce((a, d) => a + d.floors, 0)), sub: `${num(ad.reduce((a, d) => a + d.floors, 0) * 3)} m of height` },
        { label: 'Workouts', value: String(workouts.length), sub: `${num(workouts.reduce((a, w) => a + w.minutes, 0))} min · ${num(workouts.reduce((a, w) => a + w.kcal, 0))} kcal` },
      ]);
      table(
        [{ label: 'Date', w: 80, font: 'helv' }, { label: 'Steps', w: 50, align: 'right' }, { label: 'km', w: 38, align: 'right' }, { label: 'Floors', w: 38, align: 'right' }, { label: '', w: 90 },
          { label: 'Walking', w: 48, align: 'right' }, { label: 'Stairs', w: 40, align: 'right' }, { label: 'Workouts', w: 52, align: 'right' }, { label: 'Source', w: 50 }],
        ad.map((d) => ({ cells: [parseDateKey(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }), num(d.steps), d.km.toFixed(2), String(d.floors),
          { bar: d.steps / Math.max(act.stepGoal, ...ad.map((x) => x.steps)), color: d.steps >= act.stepGoal ? INK : MUTED }, num(d.walking), num(d.stairs), num(d.exercise), d.source === 'manual' ? 'by hand' : d.source === 'sensor' ? 'phone' : '–'] })),
      );
      if (workouts.length) {
        section('Workouts', 'calories above resting, MET method', 60);
        table(
          [{ label: 'Date', w: 90, font: 'helv' }, { label: 'Activity', w: 130, font: 'helv' }, { label: 'Intensity', w: 64 }, { label: 'Minutes', w: 54, align: 'right' }, { label: 'kcal', w: 54, align: 'right' }],
          workouts.map((w) => ({ cells: [`${parseDateKey(w.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${clock(w.start)}`, w.type, w.intensity, String(w.minutes), num(w.kcal)] })),
        );
      }
      if (act.profileReady) {
        const eatDays = ad.filter((d) => d.eaten > 0);
        if (eatDays.length) {
          const bal = eatDays.map((d) => d.eaten - d.total);
          const sumBal = bal.reduce((a, b) => a + b, 0);
          section('Energy balance', 'eaten minus burned, kcal', 90);
          tiles([
            { label: 'Eaten per day', value: num(avgOf(eatDays.map((d) => d.eaten))), unit: 'kcal', sub: `${eatDays.length} days with meals and movement` },
            { label: 'Burned per day', value: num(avgOf(eatDays.map((d) => d.total))), unit: 'kcal', sub: 'resting + digestion + movement' },
            { label: 'Average balance', value: signed(avgOf(bal)), unit: 'kcal', sub: sumBal > 0 ? 'surplus' : 'deficit', color: Math.abs(avgOf(bal)) > 300 ? RED : INK },
            { label: 'Predicted change', value: `${sumBal >= 0 ? '+' : '-'}${Math.abs(sumBal / 7700).toFixed(2)}`, unit: 'kg', sub: act.weights.length >= 2 ? `scale: ${(act.weights[act.weights.length - 1].kg - act.weights[0].kg).toFixed(1)} kg` : 'at 7,700 kcal per kg' },
          ]);
          table(
            [{ label: 'Date', w: 80, font: 'helv' }, { label: 'Resting', w: 46, align: 'right' }, { label: 'Digestion', w: 50, align: 'right' }, { label: 'Movement', w: 52, align: 'right' },
              { label: 'Burned', w: 50, align: 'right' }, { label: 'Eaten', w: 50, align: 'right' }, { label: 'Balance', w: 52, align: 'right' }],
            [...eatDays.map((d) => ({ cells: [parseDateKey(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }), num(d.resting), num(d.digestion), num(d.walking + d.stairs + d.exercise),
              { text: num(d.total), font: 'monob' }, num(d.eaten), { text: signed(d.eaten - d.total), color: d.eaten - d.total > 0 ? RED : INK }] })),
            { bold: true, rule: true, cells: ['Average', num(avgOf(eatDays.map((d) => d.resting))), num(avgOf(eatDays.map((d) => d.digestion))), num(avgOf(eatDays.map((d) => d.walking + d.stairs + d.exercise))), num(avgOf(eatDays.map((d) => d.total))), num(avgOf(eatDays.map((d) => d.eaten))), signed(avgOf(bal))] }],
          );
          paragraph('Burned = resting energy (BMR, Mifflin–St Jeor) + digestion (10% of food eaten) + walking (0.5 kcal per kg per km) + stairs + workouts above resting. Today, if included, uses the burn projected to midnight.', { size: 7.5, color: MUTED });
          y += 4;
        }
      }
      if (act.weights.length) {
        section('Weight', `${act.weights.length} entries`, 60);
        table(
          [{ label: 'Date', w: 120, font: 'helv' }, { label: 'Weight kg', w: 70, align: 'right' }, { label: 'Change', w: 70, align: 'right' }],
          act.weights.map((w, i) => ({ cells: [longDate(w.date), w.kg.toFixed(1), i ? `${(w.kg - act.weights[i - 1].kg) >= 0 ? '+' : ''}${(w.kg - act.weights[i - 1].kg).toFixed(1)}` : '–'] })),
        );
      }
    }

    const fnd = single ? [] : findings(s, targets);
    if (fnd.length) {
      section('What the data says', `${fnd.length} findings`);
      fnd.forEach((f, i) => {
        ensure(30);
        doc.text(M, y + 11, String(i + 1).padStart(2, '0'), { font: 'bold', size: 13, scale: 0.8, color: RED });
        doc.text(M + 24, y + 10, fit(f.title, CW - 24, 'bold', 9.5), { font: 'bold', size: 9.5, color: INK });
        y += 13;
        paragraph(f.text, { size: 8.5, indent: 24 });
        y += 5;
      });
    }
    if (coachText) {
      section('Written review', 'AI-written from the figures in this report');
      for (const para of coachText.split(/\n\s*\n/)) {
        paragraph(para.trim(), { size: 9 });
        y += 5;
      }
    }

    section(single ? 'Itemised' : 'Every day in detail', 'each entry and item as logged', 120);
    for (const d of s.active) {
      const entries = logs.filter((e) => e.date === d.date);
      const date = parseDateKey(d.date);
      const offered = {};
      for (const meal of MEALS) offered[meal] = offeredFor(date, entries.find((e) => e.meal === meal)?.plan, meal) || [];
      const prev = dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
      const start = dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7));
      const r = dayReport({ entries, dateK: d.date, now, targets, tdee, weightKg: profile.weightKg || null, times, offered, prior: logs.filter((e) => e.date >= start && e.date <= prev) });

      ensure(74);
      doc.rect(M, y, CW, 20, { fill: INK });
      doc.text(M + 7, y + 13.5, dayHeading(d.date).toUpperCase(), { font: 'bold', size: 10.5, scale: 0.86, color: WHITE });
      doc.text(PAGE.w - M - 7, y + 13, `${num(r.totals.kcal)} KCAL · ${r.verdict.toUpperCase()}${r.verdict === 'Over' || r.verdict === 'Under' ? ` (${signed(r.balance)})` : ''}`, { font: 'monob', size: 7.5, color: WHITE, align: 'right' });
      y += 20;
      doc.rect(M, y, CW, 14, { fill: SLIP });
      const facts = [`P ${num(r.totals.protein)} g`, `C ${num(r.totals.carbs)} g`, `F ${num(r.totals.fat)} g`,
        ...(() => { const a = activity?.days.find((x) => x.date === d.date); return a ? [`${num(a.steps)} steps`, `burned ${num(a.total)}`] : []; })(),
        `split P ${Math.round(r.split.protein.pct)}/C ${Math.round(r.split.carbs.pct)}/F ${Math.round(r.split.fat.pct)}%`,
        r.clock.length > 1 ? `eating window ${formatDuration(r.eatingWindow)}` : '', r.vsMaintenance != null ? `${signed(r.vsMaintenance)} vs maintenance` : ''].filter(Boolean);
      doc.text(M + 7, y + 9.5, fit(facts.join('  ·  '), CW - 14, 'mono', 6.8), { font: 'mono', size: 6.8, color: INK2 });
      y += 19;

      const col = { name: M + 16, portion: M + 262, kcal: M + 400, p: M + 437, c: M + 474, f: PAGE.w - M - 2 };
      const heads = () => {
        doc.text(col.name, y + 6, 'ITEM', { font: 'mono', size: 5.8, color: MUTED });
        doc.text(col.portion, y + 6, 'PORTION', { font: 'mono', size: 5.8, color: MUTED });
        [['KCAL', col.kcal], ['P', col.p], ['C', col.c], ['F', col.f]].forEach(([t, x]) => doc.text(x, y + 6, t, { font: 'mono', size: 5.8, color: MUTED, align: 'right' }));
        y += 10;
      };
      heads();
      for (const m of r.meals) {
        const es = entries.filter((e) => e.meal === m.meal).sort((a, b) => a.ts - b.ts);
        if (ensure(15)) heads();
        doc.rect(M + 2, y + 2, 7, 7, { fill: MEAL_COLOR[m.meal] });
        doc.text(col.name, y + 9, MEAL_LABEL[m.meal].toUpperCase(), { font: 'bold', size: 8.6, scale: 0.9, color: INK });
        const status = m.state === 'eaten' ? `${clock(m.at)} · ${pct(m.share)} of the day` : m.state === 'missed' ? 'missed' : m.state === 'pending' ? 'photo waiting to be analysed' : 'still to come';
        doc.text(col.name + 62, y + 9, status, { font: 'mono', size: 6.6, color: m.state === 'missed' ? RED : MUTED });
        if (m.kcal) {
          doc.text(col.kcal, y + 9, num(m.kcal), { font: 'monob', size: 7.8, color: INK, align: 'right' });
          [[m.protein, col.p], [m.carbs, col.c], [m.fat, col.f]].forEach(([v, x]) => doc.text(x, y + 9, num(v), { font: 'monob', size: 7.2, color: INK2, align: 'right' }));
        }
        doc.line(M, y + 12.5, PAGE.w - M, y + 12.5, { color: RULE, width: 0.4 });
        y += 14;
        for (const e of es) {
          if (e.pending) continue;
          for (const it of e.items || []) {
            if (ensure(11)) heads();
            doc.text(col.name, y + 7.5, fit(it.name, 238, 'helv', 8), { font: 'helv', size: 8, color: INK });
            doc.text(col.portion, y + 7.5, fit(`${it.portion || ''}${it.qty && it.qty !== 1 ? ` × ${it.qty}` : ''}`, 104, 'mono', 6.5), { font: 'mono', size: 6.5, color: MUTED });
            doc.text(col.kcal, y + 7.5, num(it.kcal), { font: 'mono', size: 7.5, color: INK, align: 'right' });
            [[it.protein, col.p], [it.carbs, col.c], [it.fat, col.f]].forEach(([v, x]) => doc.text(x, y + 7.5, num(v), { font: 'mono', size: 7, color: INK2, align: 'right' }));
            y += 10.5;
          }
          if (e.source === 'photo') {
            if (ensure(9)) heads();
            doc.text(col.name, y + 6.5, fit(`Photo estimate${e.confidence ? `, ${e.confidence} confidence` : ''}${e.notes ? ` — ${e.notes}` : ''}`, CW - 20, 'helv', 6.8), { font: 'helv', size: 6.8, color: MUTED });
            y += 9;
          }
        }
        y += 2;
      }
      if (r.notes.length) {
        y += 2;
        for (const note of r.notes.slice(0, 6)) {
          const lines = wrap(`${note.title}. ${note.text}`, CW - 24, 'helv', 7.8);
          ensure(lines.length * 10 + 2);
          doc.rect(M + 4, y + 3, 3, 3, { fill: RED });
          lines.forEach((ln, i) => doc.text(M + 14, y + 7.5 + i * 10, ln, { font: 'helv', size: 7.8, color: INK2 }));
          y += lines.length * 10 + 1.5;
        }
      }
      y += 14;
    }
  }

  const pages = doc.pageCount;
  for (let i = 0; i < pages; i++) {
    doc.onPage(i, () => {
      const fy = PAGE.h - 34;
      doc.line(M, fy - 10, PAGE.w - M, fy - 10, { color: INK, width: 0.6 });
      doc.text(M, fy, `ANNAMAYA · ${period.toUpperCase()}`, { font: 'mono', size: 6.3, color: INK2 });
      doc.text(PAGE.w / 2, fy, 'Calorie and nutrient figures are estimates.', { font: 'mono', size: 6.3, color: MUTED, align: 'center' });
      doc.text(PAGE.w - M, fy, `PAGE ${i + 1} OF ${pages}`, { font: 'mono', size: 6.3, color: INK2, align: 'right' });
    });
  }

  const bytes = await doc.build({ title: `Annamaya report ${period}` });
  return { bytes, pages, name: single ? `annamaya-${from}.pdf` : `annamaya-report-${from}-to-${to}.pdf` };
}
