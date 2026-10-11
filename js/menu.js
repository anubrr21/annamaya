export const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'];
export const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', snacks: 'Snacks', dinner: 'Dinner' };
export const PLAN_LABEL = { regular: 'Veg / Non-Veg', special: 'Special' };

export const DEFAULT_TIMES = {
  breakfast: ['07:30', '09:00'],
  lunch: ['12:30', '14:15'],
  snacks: ['16:45', '18:00'],
  dinner: ['19:30', '21:00'],
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NONVEG_WORDS = /\b(chicken|mutton|fish|prawn|egg|omlet|omelet|omelette)\b/i;
const EGGLESS = /egg\s*-?\s*less/i;

export const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const parseDateKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const clean = (s) => s.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();

export function resolveVariant(text, day) {
  const groups = [...text.matchAll(/\(\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*\)/g)];
  if (!groups.length) return clean(text);
  const segments = [];
  let cursor = 0;
  for (const g of groups) {
    segments.push({
      label: text.slice(cursor, g.index),
      days: g[1].split(',').map((n) => Number(n.trim())),
    });
    cursor = g.index + g[0].length;
  }
  let tail = text.slice(cursor);
  if (/^\s*,/.test(tail) && tail.replace(/[\s,]/g, '').length) tail = '';
  const tidy = (s) => clean(s.replace(/^[\s,]+/, '').replace(/[\s,]+$/, ''));
  const hit = segments.find((s) => s.days.includes(day)) || segments[0];
  let label = tidy(hit.label);
  const and = /^and\s+(.*)$/i.exec(label);
  if (and) {
    const first = tidy(segments[0].label);
    const withAt = first.toLowerCase().lastIndexOf(' with ');
    label = withAt > 0 ? `${first.slice(0, withAt)} with ${and[1]}` : and[1];
  }
  return clean(`${label} ${tail.replace(/^[\s,]+/, '')}`);
}

const DRINK_OPTION = /^(?:(?:masala|ginger)\s+)?(?:tea|coffee|milk)$/i;
const TAG_AT_END = /\((non[\s-]?veg|nv|veg)\)\s*$/i;

export function splitLine(text) {
  const out = [];
  for (const part of text.split(/\s*,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean)) {
    const tagged = TAG_AT_END.exec(part);
    const body = tagged ? part.slice(0, tagged.index).trim() : part;
    const options = body.split(/\s*\/\s*/).filter(Boolean);
    const alternatives = options.length > 1 && (
      tagged
      || (options.some((o) => NONVEG_WORDS.test(o)) && options.some((o) => !NONVEG_WORDS.test(o)))
      || options.every((o) => DRINK_OPTION.test(o))
    );
    if (!alternatives) {
      out.push(part);
      continue;
    }
    const suffix = tagged ? ` (${/veg/i.test(tagged[1]) && !/non/i.test(tagged[1]) ? 'Veg' : 'Non-Veg'})` : '';
    for (const option of options) out.push(`${option}${suffix}`);
  }
  return out;
}

export function describeItem(raw) {
  let text = clean(raw);
  const hasNV = /\((?:non[\s-]?veg|nv)\)/i.test(text);
  const hasVeg = /\(veg\)/i.test(text);
  let tag = null;
  if (hasNV && hasVeg) tag = 'mixed';
  else if (hasNV) tag = 'nonveg';
  else if (hasVeg) tag = 'veg';
  if (tag && tag !== 'mixed') text = clean(text.replace(/\((?:non[\s-]?veg|nv|veg)\)/gi, ''));
  if (!tag && NONVEG_WORDS.test(text) && !EGGLESS.test(text)) {
    const options = text.split('/').map((s) => s.trim()).filter(Boolean);
    tag = options.length > 1 && options.some((o) => !NONVEG_WORDS.test(o)) ? 'mixed' : 'nonveg';
  }
  let name = text;
  let note = '';
  if (tag !== 'mixed') {
    const dash = /^(.*?)\s+-\s+(.*)$/.exec(text);
    const paren = /^([^()]+?)\s*\(([^()]+)\)\s*$/.exec(text);
    if (dash) [, name, note] = dash;
    else if (paren) [, name, note] = paren;
  }
  return { raw: clean(raw), name: clean(name), note: clean(note), tag };
}

function parseSheet(sheet, year, monthHint) {
  const byRow = new Map();
  for (const c of sheet.cells) {
    if (!byRow.has(c.row)) byRow.set(c.row, new Map());
    byRow.get(c.row).set(c.col, c.value);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);

  let headerRow = null;
  const mealCol = {};
  let dayCol = 0;
  for (const r of rows) {
    const cols = byRow.get(r);
    const found = {};
    for (const [col, v] of cols) {
      const t = v.trim().toLowerCase();
      if (t.startsWith('breakfast')) found.breakfast = col;
      else if (t.startsWith('lunch')) found.lunch = col;
      else if (t.startsWith('snack')) found.snacks = col;
      else if (t.startsWith('dinner')) found.dinner = col;
      else if (t === 'day' || t === 'date') dayCol = col;
    }
    if (Object.keys(found).length >= 3) {
      headerRow = r;
      Object.assign(mealCol, found);
      break;
    }
  }
  if (headerRow == null) throw new Error(`Sheet "${sheet.name}" has no Breakfast / Lunch / Dinner header row.`);

  let title = '';
  for (const r of rows) {
    if (r >= headerRow) break;
    for (const v of byRow.get(r).values()) if (v.length > title.length) title = v;
  }
  let month = monthHint;
  const tl = title.toLowerCase();
  MONTHS.forEach((m, i) => {
    if (tl.includes(m)) month = i + 1;
  });

  const blocks = [];
  let endRow = Infinity;
  const notes = [];
  for (const r of rows) {
    if (r <= headerRow) continue;
    const cols = byRow.get(r);
    for (const v of cols.values()) {
      if (/instructions/i.test(v) && v.length < 80 && endRow === Infinity) endRow = r;
      else if (r > endRow && v.length > 80) notes.push(...v.split(/\n+/).map((s) => s.trim()).filter(Boolean));
    }
    if (r >= endRow) continue;
    const dayCell = cols.get(dayCol);
    if (dayCell && /\d/.test(dayCell)) {
      const dowName = (/[a-z]{3}/i.exec(dayCell) || [''])[0].toLowerCase();
      const dates = (dayCell.match(/\d{1,2}/g) || []).map(Number).filter((n) => n >= 1 && n <= 31);
      blocks.push({ row: r, dow: DOW.indexOf(dowName), dates, meals: { breakfast: [], lunch: [], snacks: [], dinner: [] } });
    }
    const block = blocks[blocks.length - 1];
    if (!block) continue;
    for (const meal of MEALS) {
      const v = mealCol[meal] != null ? cols.get(mealCol[meal]) : null;
      if (v && v.trim()) block.meals[meal].push(v.trim());
    }
  }

  const days = {};
  const warnings = [];
  for (const b of blocks) {
    for (const d of b.dates) {
      if (month && year && b.dow >= 0) {
        const actual = new Date(year, month - 1, d).getDay();
        if (actual !== b.dow) warnings.push(`${d} is listed under ${DOW[b.dow]} but falls on a ${DOW[actual]}.`);
      }
      const entry = {};
      for (const meal of MEALS) entry[meal] = b.meals[meal].flatMap((raw) => splitLine(resolveVariant(raw, d))).map(describeItem);
      days[d] = entry;
    }
  }
  return { title: clean(title), month, days, notes, warnings };
}

export function parseMenuWorkbook(workbook, { fileName = '', now = new Date() } = {}) {
  const yearInName = /(20\d{2})/.exec(fileName);
  const year = yearInName ? Number(yearInName[1]) : now.getFullYear();
  let monthHint = null;
  const fl = fileName.toLowerCase();
  MONTHS.forEach((m, i) => {
    if (fl.includes(m) || fl.includes(m.slice(0, 3))) monthHint = i + 1;
  });
  const numeric = /20\d{2}[-_.](\d{1,2})(?!\d)/.exec(fileName);
  if (!monthHint && numeric) monthHint = Number(numeric[1]);

  const plans = {};
  let month = monthHint;
  const notes = [];
  const warnings = [];
  for (const sheet of workbook.sheets) {
    let parsed;
    try {
      parsed = parseSheet(sheet, year, monthHint);
    } catch (err) {
      warnings.push(err.message);
      continue;
    }
    if (!Object.keys(parsed.days).length) continue;
    const isSpecial = /special/i.test(sheet.name) || /special/i.test(parsed.title);
    const plan = isSpecial ? 'special' : 'regular';
    if (plans[plan]) continue;
    plans[plan] = { title: parsed.title, sheet: sheet.name, days: parsed.days };
    month = parsed.month || month;
    if (!notes.length) notes.push(...parsed.notes);
    warnings.push(...parsed.warnings.map((w) => `${sheet.name}: ${w}`));
  }
  if (!plans.regular && plans.special) {
    plans.regular = plans.special;
    delete plans.special;
  }
  if (!plans.regular) throw new Error(warnings[0] || 'No menu table found in this workbook.');
  if (!month) month = now.getMonth() + 1;
  return {
    key: `${year}-${pad(month)}`,
    year,
    month,
    label: `${MONTHS[month - 1][0].toUpperCase()}${MONTHS[month - 1].slice(1)} ${year}`,
    plans,
    notes,
    warnings,
    fileName,
    importedAt: Date.now(),
  };
}

export function menuFor(menu, date, plan = 'regular') {
  if (!menu || menu.year !== date.getFullYear() || menu.month !== date.getMonth() + 1) return null;
  const p = menu.plans[plan] || menu.plans.regular;
  return p.days[date.getDate()] || null;
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function mealWindows(times = DEFAULT_TIMES) {
  return MEALS.map((meal) => {
    const [s, e] = times[meal] || DEFAULT_TIMES[meal];
    return { meal, start: toMinutes(s), end: toMinutes(e), startLabel: s, endLabel: e };
  });
}

export function currentMeal(now, times) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const windows = mealWindows(times);
  for (const w of windows) {
    if (mins >= w.start && mins < w.end) return { meal: w.meal, state: 'now', date: now, minutes: w.end - mins, window: w };
    if (mins < w.start) return { meal: w.meal, state: 'next', date: now, minutes: w.start - mins, window: w };
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const first = windows[0];
  return { meal: first.meal, state: 'tomorrow', date: tomorrow, minutes: 1440 - mins + first.start, window: first };
}

export function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

export function formatClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad(m)} ${ap}` : `${h12} ${ap}`;
}
