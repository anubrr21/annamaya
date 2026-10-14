import { S, $, esc, fmt, toast, render, menuItems, photoUrl, pickFile, entryRow } from './app.js';
import { MEALS, MEAL_LABEL, PLAN_LABEL, dateKey, parseDateKey, monthKey } from './menu.js';
import { estimateItem, totals } from './nutrition.js';
import { dayTotals } from './insights.js';
import { ICONS } from './charts.js';
import * as db from './db.js';
import * as ai from './ai.js';
import { stamp, haptic } from './fx.js';

let current = null;

export function closeSheet({ rerender = true } = {}) {
  const root = $('#sheet-root');
  if (!current) return;
  const { scrim, panel } = current;
  current = null;
  scrim.classList.remove('open');
  panel.classList.remove('open');
  setTimeout(() => {
    scrim.remove();
    panel.remove();
  }, 320);
  if (rerender) render();
  root.onclick = root.oninput = root.onchange = null;
}

export function sheet(on = {}) {
  if (current) closeSheet({ rerender: false });
  const root = $('#sheet-root');
  const scrim = Object.assign(document.createElement('div'), { className: 'scrim' });
  const panel = Object.assign(document.createElement('section'), { className: 'sheet' });
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `<div class="sheet-head"><h2></h2><button class="icon-btn" data-s="close" aria-label="Close">${ICONS.x}</button></div>
    <div class="sheet-body"></div><div class="sheet-foot" hidden></div>`;
  root.append(scrim, panel);
  const api = { scrim, panel, title: $('h2', panel), body: $('.sheet-body', panel), foot: $('.sheet-foot', panel), on };
  current = api;
  scrim.onclick = () => closeSheet();
  root.onclick = (ev) => {
    const el = ev.target.closest('[data-s], [data-action="open-entry"]');
    if (!el) return;
    if (el.dataset.action === 'open-entry') return openEntry(el.dataset.id);
    if (el.dataset.s === 'close') return closeSheet();
    api.on[el.dataset.s]?.(el, ev);
  };
  requestAnimationFrame(() => {
    scrim.classList.add('open');
    panel.classList.add('open');
  });
  return api;
}

const dayLabel = (date) => {
  const key = dateKey(date);
  if (key === dateKey(S.now)) return 'Today';
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

const round1 = (n) => Math.round(n * 10) / 10;
const scaled = (it) => ({
  name: it.name,
  portion: it.portion || '',
  qty: it.qty,
  kcal: Math.round(it.base.kcal * it.qty),
  protein: round1(it.base.protein * it.qty),
  carbs: round1(it.base.carbs * it.qty),
  fat: round1(it.base.fat * it.qty),
});
const toEditable = (i) => ({
  name: i.name,
  portion: i.portion || '',
  qty: i.qty || 1,
  base: { kcal: (i.kcal || 0) / (i.qty || 1), protein: (i.protein || 0) / (i.qty || 1), carbs: (i.carbs || 0) / (i.qty || 1), fat: (i.fat || 0) / (i.qty || 1) },
});

const qtyLabel = (q) => (q === 0.5 ? '½' : q === 1.5 ? '1½' : q === 2.5 ? '2½' : String(q));
const stepper = (i, q) => `<span class="qty"><button type="button" data-s="qty" data-i="${i}" data-d="-0.5" aria-label="Less">−</button><span class="num">${qtyLabel(q)}×</span><button type="button" data-s="qty" data-i="${i}" data-d="0.5" aria-label="More">+</button></span>`;

export function openLog({ date = S.now, meal, mode = 'photo', plan, edit = null }) {
  const L = {
    date, meal, mode, plan: plan || S.prefs.plan,
    picked: new Map(),
    items: edit ? edit.items.map(toEditable) : [],
    photo: null, preview: null, hint: '', phase: 'idle', result: null, error: null, canDefer: false,
    form: { name: '', kcal: '' },
  };
  if (edit) L.mode = 'edit';

  const sh = sheet({
    meal: (el) => {
      L.meal = el.dataset.v;
      L.picked.clear();
      draw();
    },
    mode: (el) => {
      L.mode = el.dataset.v;
      draw();
    },
    plan: (el) => {
      L.plan = el.dataset.v;
      L.picked.clear();
      draw();
    },
    pick: (el, ev) => {
      if (ev.target.closest('.qty')) return;
      const i = Number(el.dataset.i);
      if (L.picked.has(i)) L.picked.delete(i);
      else L.picked.set(i, 1);
      haptic(8);
      draw();
    },
    qty: (el) => {
      const i = Number(el.dataset.i);
      const d = Number(el.dataset.d);
      if (L.mode === 'menu') L.picked.set(i, Math.min(5, Math.max(0.5, (L.picked.get(i) || 1) + d)));
      else L.items[i].qty = Math.min(5, Math.max(0.5, L.items[i].qty + d));
      draw();
    },
    remove: (el) => {
      L.items.splice(Number(el.dataset.i), 1);
      draw();
    },
    add: () => {
      const name = L.form.name.trim();
      if (!name) return toast('Type what you ate first.');
      const est = estimateItem(name);
      const kcal = Number(L.form.kcal);
      const base = { kcal: est.kcal, protein: est.protein, carbs: est.carbs, fat: est.fat };
      if (kcal > 0) {
        const f = est.kcal ? kcal / est.kcal : 1;
        Object.assign(base, { kcal, protein: round1(est.protein * f), carbs: round1(est.carbs * f), fat: round1(est.fat * f) });
      }
      L.items.push({ name, portion: kcal > 0 ? '' : est.serving, qty: 1, base });
      L.form = { name: '', kcal: '' };
      draw();
    },
    camera: async () => setPhoto(await pickFile('image/*', { capture: 'environment' })),
    gallery: async () => setPhoto(await pickFile('image/*')),
    retake: () => {
      L.photo = L.result = L.error = null;
      L.items = [];
      L.phase = 'idle';
      draw();
    },
    analyse,
    defer: saveDeferred,
    save,
  });

  sh.panel.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.f === 'hint') L.hint = t.value;
    if (t.dataset.f === 'name') L.form.name = t.value;
    if (t.dataset.f === 'kcal') L.form.kcal = t.value;
  });
  sh.panel.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.f !== 'item-kcal') return;
    const it = L.items[Number(t.dataset.i)];
    const next = Math.max(0, Number(t.value) || 0) / it.qty;
    const f = it.base.kcal ? next / it.base.kcal : 1;
    it.base = { kcal: next, protein: it.base.protein * f, carbs: it.base.carbs * f, fat: it.base.fat * f };
    draw();
  });

  async function setPhoto(file) {
    if (!file) return;
    try {
      L.photo = await ai.prepareImage(file);
      if (L.preview) URL.revokeObjectURL(L.preview);
      L.preview = URL.createObjectURL(L.photo);
      L.error = null;
      draw();
    } catch {
      toast('That image could not be opened.');
    }
  }

  async function analyse() {
    L.phase = 'analysing';
    L.error = null;
    draw();
    try {
      const menu = menuItems(L.date, L.plan, L.meal) || [];
      const result = await ai.analysePlate(S.ai, {
        imageBase64: await ai.blobToBase64(L.photo),
        meal: MEAL_LABEL[L.meal],
        dateLabel: L.date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }),
        menuLines: menu.map((i) => i.raw),
        hint: L.hint.trim(),
      });
      L.result = result;
      L.items = result.items.map(toEditable);
      L.phase = 'result';
    } catch (err) {
      L.phase = 'idle';
      L.error = err.message;
      L.canDefer = Boolean(err.retryable);
    }
    if (current === sh) draw();
  }

  function currentItems() {
    if (L.mode === 'menu') {
      const menu = menuItems(L.date, L.plan, L.meal) || [];
      return [...L.picked].map(([i, qty]) => scaled({ name: menu[i].line, portion: menu[i].est.serving, qty, base: menu[i].est }));
    }
    return L.items.map(scaled);
  }

  async function save() {
    const items = currentItems();
    if (!items.length) return toast('Add at least one item.');
    const t = totals(items);
    const entry = edit
      ? { ...edit, meal: L.meal, items, ...t, pending: false }
      : { id: db.uid(), date: dateKey(L.date), meal: L.meal, plan: L.plan, ts: Date.now(), source: L.mode === 'photo' ? 'photo' : L.mode, items, ...t, pending: false };
    if (!edit && L.mode === 'photo' && L.photo) {
      entry.photoId = entry.id;
      entry.summary = L.result?.summary || '';
      entry.confidence = L.result?.confidence;
      entry.notes = L.result?.notes || '';
      await db.photos.put(entry.id, L.photo);
    }
    await db.logs.put(entry);
    toast(`${MEAL_LABEL[L.meal]} logged · ${fmt(t.kcal)} kcal`);
    closeSheet();
    haptic([12, 40, 18]);
    if (!edit) stamp('Logged');
  }

  async function saveDeferred() {
    const id = db.uid();
    await db.photos.put(id, L.photo);
    await db.logs.put({ id, date: dateKey(L.date), meal: L.meal, plan: L.plan, ts: Date.now(), source: 'photo', items: [], kcal: 0, protein: 0, carbs: 0, fat: 0, pending: true, photoId: id, hint: L.hint.trim() });
    toast('Photo saved. It will be analysed when you are online.', 3600);
    closeSheet();
  }

  function editableList() {
    const rows = L.items.map((it, i) => {
      const s = scaled(it);
      return `<div class="edit-item">
        <div><b>${esc(it.name)}</b>${it.portion ? `<div class="small muted">${esc(it.portion)}</div>` : ''}</div>
        <input class="kcal-in num" type="number" inputmode="numeric" data-f="item-kcal" data-i="${i}" value="${s.kcal}" aria-label="Calories for ${esc(it.name)}">
        <div class="ctl">${stepper(i, it.qty)}<span class="small muted grow num">P ${s.protein} · C ${s.carbs} · F ${s.fat} g</span>
        <button class="icon-btn" style="width:34px;height:34px" data-s="remove" data-i="${i}" aria-label="Remove ${esc(it.name)}">${ICONS.x}</button></div>
      </div>`;
    }).join('');
    return `${rows}
      <div class="stack" style="margin-top:12px">
        <div class="eyebrow">${L.items.length ? 'Add something else' : 'What did you eat?'}</div>
        <div class="row"><input type="text" data-f="name" placeholder="e.g. 2 chapathi, banana" value="${esc(L.form.name)}" class="grow">
        <input type="number" inputmode="numeric" data-f="kcal" placeholder="kcal" value="${esc(L.form.kcal)}" style="width:86px"></div>
        <button class="btn" data-s="add">${ICONS.plus} Add${L.form.kcal ? '' : ' with estimate'}</button>
        <div class="small muted">Leave kcal blank and it is estimated from the built-in food table.</div>
      </div>`;
  }

  function photoBody() {
    if (!L.photo) {
      return `<div class="drop"><div class="big-ic">${ICONS.camera}</div>
        <div><b>Photograph your plate</b><div class="small muted">Shoot from above with the whole plate in frame. Today's menu is sent along so dishes are named correctly.</div></div>
        <div class="btn-row" style="width:100%"><button class="btn primary" data-s="camera">${ICONS.camera} Camera</button><button class="btn" data-s="gallery">${ICONS.image} Gallery</button></div></div>`;
    }
    const img = `<div class="${L.phase === 'analysing' ? 'scan' : ''}"><img class="preview" src="${L.preview}" alt="Your plate"></div>`;
    if (L.phase === 'analysing') return `${img}<div class="empty"><b>Reading your plate…</b><br>Identifying dishes and portions.</div>`;
    if (L.phase === 'result') {
      const r = L.result;
      return `${img}<div class="stack" style="margin:12px 0 4px">
        <div><b>${esc(r.summary)}</b> <span class="badge">${r.confidence} confidence</span></div>
        ${r.notes ? `<div class="note ${r.confidence === 'low' ? 'warn' : ''}">${esc(r.notes)} Adjust anything that looks off.</div>` : ''}
        </div>${editableList()}<button class="link" data-s="retake" style="margin-top:14px">Use a different photo</button>`;
    }
    const ready = navigator.onLine && ai.hasKey(S.ai);
    return `${img}<div class="stack" style="margin-top:12px">
      ${L.error ? `<div class="note warn">${esc(L.error)}</div>` : ''}
      <label class="field">Anything worth knowing? (optional)<input type="text" data-f="hint" value="${esc(L.hint)}" placeholder="e.g. second helping of rice, skipped the curry"></label>
      ${ready ? `<button class="btn primary block" data-s="analyse">${ICONS.sparkle} Estimate calories</button>`
        : `<div class="note">${ai.hasKey(S.ai) ? 'You are offline.' : 'No AI key added yet (Settings → Photo calorie estimates).'} Save the photo now and it will be analysed automatically later, or switch to “From menu” to log offline right away.</div>`}
      ${!ready || L.error ? `<button class="btn block" data-s="defer">Save photo, analyse later</button>` : ''}
      ${L.error ? `<button class="btn block" data-s="mode" data-v="menu">Tick items from the menu instead</button>` : ''}
      <button class="link" data-s="retake">Use a different photo</button></div>`;
  }

  function menuBody() {
    const menu = menuItems(L.date, L.plan, L.meal);
    if (!menu) return `<div class="empty">No menu loaded for ${esc(L.date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }))}. Use Photo or Manual instead.</div>`;
    const hasSpecial = Boolean(S.menus.get(monthKey(L.date))?.plans.special);
    return `${hasSpecial ? `<div class="seg" style="margin-bottom:6px">${['regular', 'special'].map((p) => `<button data-s="plan" data-v="${p}" aria-pressed="${p === L.plan}">${PLAN_LABEL[p]}</button>`).join('')}</div>` : ''}
      <ul class="items">${menu.map((it, i) => {
        const on = L.picked.has(i);
        return `<li data-s="pick" data-i="${i}" role="checkbox" aria-checked="${on}" tabindex="0" class="${it.off && !on ? 'off' : ''}" style="align-items:center;cursor:pointer">
          <span class="check">${ICONS.check}</span>
          <div class="grow"><div class="nm">${esc(it.line)}</div><div class="nt">${esc(it.est.serving)} · ~${fmt(it.est.kcal)} kcal</div></div>
          ${on ? stepper(i, L.picked.get(i)) : ''}</li>`;
      }).join('')}</ul>`;
  }

  function draw() {
    sh.title.textContent = edit ? `Edit ${MEAL_LABEL[L.meal].toLowerCase()}` : `Log ${MEAL_LABEL[L.meal].toLowerCase()}`;
    const chips = `<div class="chips" style="margin-bottom:10px">${MEALS.map((m) => `<button class="chip" data-s="meal" data-v="${m}" aria-pressed="${m === L.meal}" style="--c:var(--m-${m})"><span class="dot"></span>${MEAL_LABEL[m]}</button>`).join('')}</div>`;
    const modes = edit ? '' : `<div class="seg" style="margin-bottom:14px">${[['photo', 'Photo'], ['menu', 'From menu'], ['manual', 'Manual']].map(([v, l]) => `<button data-s="mode" data-v="${v}" aria-pressed="${v === L.mode}">${l}</button>`).join('')}</div>`;
    const body = L.mode === 'photo' ? photoBody() : L.mode === 'menu' ? menuBody() : editableList();
    const scroll = sh.body.scrollTop;
    sh.body.innerHTML = `<div class="small muted" style="margin-bottom:10px">${esc(dayLabel(L.date))}</div>${chips}${modes}${body}`;
    sh.body.scrollTop = scroll;

    const items = currentItems();
    const showFoot = items.length > 0 && !(L.mode === 'photo' && L.phase !== 'result');
    sh.foot.hidden = !showFoot;
    if (showFoot) {
      const t = totals(items);
      sh.foot.innerHTML = `<div class="total-line"><span class="k num">${fmt(t.kcal)} <small class="small muted">kcal</small></span><span class="m num">P ${fmt(t.protein)} · C ${fmt(t.carbs)} · F ${fmt(t.fat)} g</span></div>
        <button class="btn primary block" data-s="save">${ICONS.check} ${edit ? 'Save changes' : 'Save to journal'}</button>`;
    }
  }

  draw();
}

export async function openEntry(id) {
  const entry = (await db.logs.all()).find((e) => e.id === id);
  if (!entry) return;
  const url = await photoUrl(entry.photoId);
  const sh = sheet({
    delete: async () => {
      if (!confirm('Delete this entry?')) return;
      await db.logs.remove(entry.id);
      if (entry.photoId) await db.photos.remove(entry.photoId);
      toast('Entry deleted.');
      closeSheet();
    },
    edit: () => openLog({ date: parseDateKey(entry.date), meal: entry.meal, plan: entry.plan, edit: entry }),
    analyse: async (el) => {
      el.disabled = true;
      el.textContent = 'Analysing…';
      const ok = await analysePending(entry, { loud: true });
      if (ok) openEntry(entry.id);
      else {
        el.disabled = false;
        el.textContent = 'Analyse now';
      }
    },
  });
  sh.title.textContent = `${MEAL_LABEL[entry.meal]} · ${dayLabel(parseDateKey(entry.date))}`;
  const when = new Date(entry.ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  sh.body.innerHTML = `${url ? `<img class="preview" src="${url}" alt="Photo of this meal" style="margin-bottom:12px">` : ''}
    ${entry.pending ? `<div class="note warn">This photo has not been analysed yet. It runs automatically once you are online with an AI key set.</div>` : `
    <div class="total-line"><span class="k num">${fmt(entry.kcal)} <small class="small muted">kcal</small></span><span class="m num">P ${fmt(entry.protein)} · C ${fmt(entry.carbs)} · F ${fmt(entry.fat)} g</span></div>
    ${entry.summary ? `<p style="margin-bottom:8px"><b>${esc(entry.summary)}</b></p>` : ''}
    <table class="data"><thead><tr><th>Item</th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr></thead><tbody>
    ${entry.items.map((i) => `<tr><td>${esc(i.name)}${i.portion ? `<br><span class="muted">${esc(i.portion)}${i.qty && i.qty !== 1 ? ` × ${i.qty}` : ''}</span>` : ''}</td><td>${fmt(i.kcal)}</td><td>${fmt(i.protein)}</td><td>${fmt(i.carbs)}</td><td>${fmt(i.fat)}</td></tr>`).join('')}
    </tbody></table>
    ${entry.notes ? `<div class="note" style="margin-top:12px">${esc(entry.notes)}</div>` : ''}`}
    <p class="small muted" style="margin-top:12px">Logged ${when} · ${entry.source === 'photo' ? `photo estimate${entry.confidence ? `, ${entry.confidence} confidence` : ''}` : entry.source === 'menu' ? 'ticked from menu' : 'entered by hand'}</p>`;
  sh.foot.hidden = false;
  sh.foot.innerHTML = `<div class="btn-row"><button class="btn danger" data-s="delete">${ICONS.trash} Delete</button>
    ${entry.pending ? '<button class="btn primary" data-s="analyse">Analyse now</button>' : `<button class="btn" data-s="edit">${ICONS.edit} Edit</button>`}</div>`;
}

export async function openDay(key) {
  const date = parseDateKey(key);
  const entries = (await db.logs.forDate(key)).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.ts - b.ts);
  const t = dayTotals(entries);
  const future = key > dateKey(S.now);
  const sh = sheet({ add: (el) => openLog({ date, meal: el.dataset.v, mode: 'menu' }) });
  sh.title.textContent = date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  sh.body.innerHTML = `<div class="total-line"><span class="k num">${fmt(t.kcal)} <small class="small muted">of ${fmt(S.targets.kcal)} kcal</small></span><span class="m num">P ${fmt(t.protein)} · C ${fmt(t.carbs)} · F ${fmt(t.fat)} g</span></div>
    <div class="meter" style="margin-bottom:14px"><div class="bar"><i style="width:${Math.min(100, (t.kcal / S.targets.kcal) * 100).toFixed(0)}%"></i></div></div>
    ${entries.length ? entries.map(entryRow).join('') : `<div class="empty">${future ? 'This day has not happened yet.' : 'Nothing logged on this day.'}</div>`}
    ${entries.length ? `<a class="btn block" style="margin-top:14px" href="#day/${key}">${ICONS.chart} Full day statement</a>` : ''}
    ${future ? '' : `<div class="eyebrow" style="margin:16px 0 8px">Add a meal</div>
    <div class="chips">${MEALS.map((m) => `<button class="chip" data-s="add" data-v="${m}" style="--c:var(--m-${m})"><span class="dot"></span>${MEAL_LABEL[m]}${t.taken.includes(m) ? `<span class="tick">${ICONS.check}</span>` : ''}</button>`).join('')}</div>`}`;
  for (const el of sh.body.querySelectorAll('[data-photo]')) {
    photoUrl(el.dataset.photo).then((u) => {
      if (u) {
        el.style.backgroundImage = `url(${u})`;
        el.textContent = '';
      }
    });
  }
}

async function analysePending(entry, { loud = false } = {}) {
  try {
    const blob = await db.photos.get(entry.photoId);
    if (!blob) throw new Error('The saved photo is missing.');
    const date = parseDateKey(entry.date);
    const menu = menuItems(date, entry.plan, entry.meal) || [];
    const result = await ai.analysePlate(S.ai, {
      imageBase64: await ai.blobToBase64(blob),
      meal: MEAL_LABEL[entry.meal],
      dateLabel: date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }),
      menuLines: menu.map((i) => i.raw),
      hint: entry.hint || '',
    });
    const items = result.items.map((i) => ({ name: i.name, portion: i.portion, qty: 1, kcal: i.kcal, protein: i.protein, carbs: i.carbs, fat: i.fat }));
    await db.logs.put({ ...entry, items, ...totals(items), pending: false, summary: result.summary, confidence: result.confidence, notes: result.notes });
    return true;
  } catch (err) {
    if (loud) toast(err.message, 5000);
    return false;
  }
}

let draining = false;
export async function processPending() {
  if (draining || !navigator.onLine || !ai.hasKey(S.ai)) return;
  draining = true;
  try {
    const pending = (await db.logs.all()).filter((e) => e.pending && e.photoId);
    let done = 0;
    for (const entry of pending) if (await analysePending(entry)) done++;
    if (done) {
      toast(`${done} saved ${done === 1 ? 'photo' : 'photos'} analysed.`);
      if (!current) render();
    }
  } finally {
    draining = false;
  }
}
