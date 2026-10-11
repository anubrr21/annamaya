import { MEALS, MEAL_LABEL, mealWindows, formatClock } from './menu.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => Math.round(n).toLocaleString('en-IN');

const angleOf = (minutes) => (minutes / 1440) * 360 - 180;
const point = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
};
function arc(cx, cy, r, from, to) {
  const [x1, y1] = point(cx, cy, r, from);
  const [x2, y2] = point(cx, cy, r, to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function dayline({ now, times, mealKcal, showNow = true }) {
  const W = 340;
  const T0 = 5 * 60;
  const T1 = 23.5 * 60;
  const x = (m) => 4 + Math.max(0, Math.min(1, (m - T0) / (T1 - T0))) * (W - 8);
  const minutes = now.getHours() * 60 + now.getMinutes();

  let ticks = '';
  for (let h = 5; h <= 23; h++) {
    const major = h % 3 === 0;
    const hx = x(h * 60).toFixed(1);
    ticks += `<line class="tk" x1="${hx}" x2="${hx}" y1="40" y2="${major ? 47 : 44}"/>`;
    if (major) ticks += `<text class="hr" x="${hx}" y="57" text-anchor="middle">${h % 12 || 12}${h < 12 ? 'a' : 'p'}</text>`;
  }

  const blocks = mealWindows(times)
    .map((w) => {
      const logged = (mealKcal[w.meal] || 0) > 0;
      const x0 = x(w.start);
      const width = Math.max(6, x(w.end) - x0);
      const tip = `${MEAL_LABEL[w.meal]} · ${formatClock(w.startLabel)}–${formatClock(w.endLabel)}\n${logged ? `${fmt(mealKcal[w.meal])} kcal logged` : 'Not logged yet'}`;
      return `<g data-tip="${esc(tip)}" data-meal="${w.meal}" style="--c:var(--m-${w.meal})">
        <rect class="blk ${logged ? 'on' : ''}" x="${(x0 + 1).toFixed(1)}" y="25" width="${(width - 2).toFixed(1)}" height="14"/>
        <text class="ml" x="${(x0 + width / 2).toFixed(1)}" y="20" text-anchor="middle">${MEAL_LABEL[w.meal][0]}</text>
        <rect x="${(x0 - 6).toFixed(1)}" y="6" width="${(width + 12).toFixed(1)}" height="40" fill="transparent"/>
      </g>`;
    })
    .join('');

  const nx = x(minutes);
  const flip = nx > W - 44;
  const marker = `<g class="now"><line x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="6" y2="44"/>
    <path d="M${(nx - 4).toFixed(1)} 1h8l-4 6z"/><text x="${(nx + (flip ? -7 : 7)).toFixed(1)}" y="8" text-anchor="${flip ? 'end' : 'start'}">NOW</text></g>`;

  return `<svg class="dayline" viewBox="0 0 ${W} 60" role="img" aria-label="Today's meal windows on a timeline">
    <line class="base" x1="4" x2="${W - 4}" y1="40" y2="40"/>${ticks}${blocks}${showNow ? marker : ''}</svg>`;
}

function niceCeil(v) {
  const step = v > 3000 ? 1000 : 500;
  return Math.max(step, Math.ceil(v / step) * step);
}

export function dailyBars({ days, target, width = 520 }) {
  const H = 230;
  const pad = { l: 34, r: 10, t: 16, b: 24 };
  const W = Math.max(280, width);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceCeil(Math.max(target * 1.15, ...days.map((d) => d.kcal)));
  const y = (v) => pad.t + plotH - (v / max) * plotH;
  const slot = plotW / days.length;
  const bw = Math.max(3, Math.min(24, slot - (slot > 12 ? 4 : 2)));
  const labelEvery = Math.ceil(days.length / 8);
  const gap = bw >= 8 ? 2 : 0;

  let grid = '';
  for (let v = 0; v <= max; v += max / 4) {
    grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="axis" x="${pad.l - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v >= 1000 ? `${v / 1000}k` : v}</text>`;
  }

  const cols = days
    .map((d, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2;
      let cursor = 0;
      const parts = MEALS.filter((m) => d.meals[m] > 0);
      const segs = parts
        .map((m, j) => {
          const y0 = y(cursor);
          cursor += d.meals[m];
          const y1 = y(cursor);
          const h = Math.max(0.5, y0 - y1 - (j < parts.length - 1 ? gap : 0));
          const top = j === parts.length - 1;
          const r = top ? Math.min(4, bw / 2, h) : 0;
          const yTop = y0 - h;
          const path = `M${x.toFixed(1)} ${y0.toFixed(1)}V${(yTop + r).toFixed(1)}Q${x.toFixed(1)} ${yTop.toFixed(1)} ${(x + r).toFixed(1)} ${yTop.toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)} ${yTop.toFixed(1)} ${(x + bw).toFixed(1)} ${(yTop + r).toFixed(1)}V${y0.toFixed(1)}Z`;
          return `<path class="seg" d="${path}" fill="var(--m-${m})"/>`;
        })
        .join('');
      const lines = [d.tipLabel, `${fmt(d.kcal)} kcal total`, ...parts.map((m) => `${MEAL_LABEL[m]}: ${fmt(d.meals[m])}`)];
      const label = i % labelEvery === 0 ? `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(d.label)}</text>` : '';
      return `<g class="col" data-tip="${esc(d.kcal ? lines.join('\n') : `${d.tipLabel}\nNothing logged`)}">
        <rect class="hit" x="${(pad.l + i * slot).toFixed(1)}" y="${pad.t}" width="${slot.toFixed(1)}" height="${plotH}"/>${segs}${label}</g>`;
    })
    .join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily calories by meal against a ${fmt(target)} kilocalorie target">
    ${grid}${cols}
    <line class="target" x1="${pad.l}" x2="${W - pad.r}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/>
    <text class="target-label" x="${W - pad.r}" y="${(y(target) - 5).toFixed(1)}" text-anchor="end">Target ${fmt(target)}</text>
  </svg>`;
}

export const LOGO = `<svg viewBox="0 0 120 120" aria-hidden="true" fill="none" stroke="currentColor">
  <circle cx="60" cy="60" r="56" stroke-width="3.5"/><circle cx="60" cy="60" r="37.5" stroke-width="1.5"/>
  <path id="seal-arc" d="M16.5 60a43.5 43.5 0 1 1 87 0a43.5 43.5 0 1 1-87 0" stroke="none"/>
  <text fill="currentColor" stroke="none" font-family="Bahnschrift, 'Roboto Condensed', 'Arial Narrow', sans-serif" font-size="11.5" font-weight="700"><textPath href="#seal-arc" textLength="268" lengthAdjust="spacing">ANNAMAYA ✦ MESS JOURNAL ✦ EAT WELL ✦</textPath></text>
  <circle cx="60" cy="60" r="27" pathLength="100" stroke-width="5.5" stroke-dasharray="20.5 4.5" transform="rotate(-81 60 60)"/>
  <ellipse cx="60" cy="60" rx="8.5" ry="16.5" transform="rotate(32 60 60)" fill="currentColor" stroke="none"/>
</svg>`;

const I = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  dial: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  menu: I('<path d="M5 6h14M5 12h14M5 18h9"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  calendar: I('<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
  chart: I('<path d="M5 20V11M12 20V4M19 20v-6"/>'),
  gear: I('<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.6"/><circle cx="8" cy="17" r="2.6"/>'),
  camera: I('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.5-2h5.6l1.5 2h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.500 19h-11A2.5 2.5 0 0 1 4 16.500z"/><circle cx="12" cy="12.500" r="3.500"/>'),
  image: I('<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.500"/><path d="M5 17l4.500-4 3.500 3 2.500-2 3.500 3"/>'),
  check: I('<path d="M5 12.500l4.500 4.500L19 7.500"/>'),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600l1.400 1.400M17 17l1.400 1.400M18.400 5.600L17 7M7 17l-1.400 1.400"/>'),
  moon: I('<path d="M19.500 14.500A7.500 7.500 0 0 1 9.500 4.500a7.500 7.500 0 1 0 10 10z"/>'),
  auto: I('<circle cx="12" cy="12" r="8.500"/><path d="M12 3.500v17" /><path d="M12 3.500a8.500 8.500 0 0 1 0 17z" fill="currentColor" stroke="none"/>'),
  flame: I('<path d="M12 21c3.600 0 6-2.500 6-6 0-3-2-5-3-7-.500 1.500-1.500 2.500-2.500 3C12 8 11 5.500 9 3.500 9 7 6 9.500 6 15c0 3.500 2.400 6 6 6z"/>'),
  target: I('<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.500"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  plate: I('<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.500"/>'),
  clock: I('<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>'),
  trend: I('<path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/>'),
  sparkle: I('<path d="M12 4l1.800 5.200L19 11l-5.200 1.800L12 18l-1.800-5.200L5 11l5.200-1.800z"/>'),
  upload: I('<path d="M12 16V5M7.500 9.500L12 5l4.500 4.500M5 19h14"/>'),
  download: I('<path d="M12 5v11M7.500 11.500L12 16l4.500-4.500M5 19h14"/>'),
  trash: I('<path d="M5 7h14M10 7V4.500h4V7M7 7l1 12.500h8L17 7"/>'),
  left: I('<path d="M14.500 5.500L8 12l6.500 6.500"/>'),
  right: I('<path d="M9.500 5.500L16 12l-6.500 6.500"/>'),
  offline: I('<path d="M4 4l16 16M8.500 15.500a5 5 0 0 1 7 0M5.500 12.200a9.200 9.200 0 0 1 4-2.400M14.500 9.800a9.200 9.200 0 0 1 4 2.400M2.800 9a13 13 0 0 1 4.200-2.800M12 5.500a13 13 0 0 1 9.200 3.500"/><circle cx="12" cy="19" r="1" fill="currentColor"/>'),
  edit: I('<path d="M5 19l1-4L16.500 4.500l3 3L9 18z"/>'),
};
