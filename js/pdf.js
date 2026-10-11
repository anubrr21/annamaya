export const PAGE = { w: 595.28, h: 841.89 };

const FONT_NAME = { helv: 'Helvetica', bold: 'Helvetica-Bold', mono: 'Courier', monob: 'Courier-Bold' };
const FONT_ID = { helv: 'F1', bold: 'F2', mono: 'F3', monob: 'F4' };

const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const WINANSI = { '–': 0x96, '—': 0x97, '·': 0xb7, '×': 0xd7, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '•': 0x95, '°': 0xb0, '½': 0xbd, '…': 0x85, '±': 0xb1 };
const REPLACE = { '≈': '~', '−': '-', '→': '->', '✓': '', '✦': '*', '≥': '>=', '≤': '<=', '₹': 'Rs ' };
const EXTRA_WIDTH = { 0x96: 556, 0x97: 1000, 0xb7: 278, 0xd7: 584, 0x92: 222, 0x91: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0xb0: 400, 0xbd: 834, 0x85: 1000, 0xb1: 584 };

function codes(str) {
  const out = [];
  for (const ch of String(str)) {
    if (REPLACE[ch] != null) {
      for (const c of REPLACE[ch]) out.push(c.charCodeAt(0));
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out.push(code);
    else if (WINANSI[ch]) out.push(WINANSI[ch]);
    else if (code >= 160 && code <= 255) out.push(code);
    else if (ch === '\n' || ch === '\t') out.push(32);
    else out.push(63);
  }
  return out;
}

export function textWidth(str, font = 'helv', size = 10, scale = 1) {
  if (font === 'mono' || font === 'monob') return codes(str).length * 0.6 * size * scale;
  const table = font === 'bold' ? BOLD : HELV;
  let w = 0;
  for (const c of codes(str)) w += c <= 126 ? table[c - 32] : EXTRA_WIDTH[c] || 556;
  return (w / 1000) * size * scale;
}

export function wrap(str, width, font, size, scale = 1) {
  const lines = [];
  for (const para of String(str).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, font, size, scale) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function fit(str, width, font, size, scale = 1) {
  let s = String(str);
  if (textWidth(s, font, size, scale) <= width) return s;
  while (s.length > 1 && textWidth(`${s}…`, font, size, scale) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

const n = (v) => (Math.round(v * 100) / 100).toString();
const rgb = (c) => `${n(c[0])} ${n(c[1])} ${n(c[2])}`;

export class Pdf {
  constructor() {
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
  }

  get pageCount() {
    return this.pages.length;
  }

  onPage(index, fn) {
    const keep = this.ops;
    this.ops = this.pages[index];
    fn();
    this.ops = keep;
  }

  text(x, y, str, { font = 'helv', size = 10, color = [0, 0, 0], align = 'left', scale = 1, angle = 0 } = {}) {
    const bytes = codes(str);
    if (!bytes.length) return 0;
    const w = textWidth(str, font, size, scale);
    const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    const py = PAGE.h - y;
    const place = angle
      ? `${n(Math.cos(angle))} ${n(Math.sin(angle))} ${n(-Math.sin(angle))} ${n(Math.cos(angle))} ${n(tx)} ${n(py)} Tm`
      : `1 0 0 1 ${n(tx)} ${n(py)} Tm`;
    this.ops.push(`BT /${FONT_ID[font]} ${n(size)} Tf ${n(scale * 100)} Tz ${rgb(color)} rg ${place} <${hex}> Tj ET`);
    return w;
  }

  line(x1, y1, x2, y2, { color = [0, 0, 0], width = 0.75, dash = null } = {}) {
    this.ops.push(`q ${rgb(color)} RG ${n(width)} w ${dash ? `[${dash.join(' ')}] 0 d` : ''} ${n(x1)} ${n(PAGE.h - y1)} m ${n(x2)} ${n(PAGE.h - y2)} l S Q`);
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 0.75 } = {}) {
    if (w <= 0 || h <= 0) return;
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.ops.push(`q ${fill ? `${rgb(fill)} rg` : ''} ${stroke ? `${rgb(stroke)} RG ${n(width)} w` : ''} ${n(x)} ${n(PAGE.h - y - h)} ${n(w)} ${n(h)} re ${paint} Q`);
  }

  arc(cx, cy, r, a0, a1, { color = [0, 0, 0], width = 1, cap = 0 } = {}) {
    const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
    const step = (a1 - a0) / segs;
    const k = (4 / 3) * Math.tan(step / 4);
    const P = (a, rr = r) => [cx + rr * Math.cos(a), PAGE.h - (cy + rr * Math.sin(a))];
    let path = '';
    for (let i = 0; i < segs; i++) {
      const s = a0 + i * step;
      const e = s + step;
      const [x0, y0] = P(s);
      const [x3, y3] = P(e);
      const c1 = [x0 - k * r * Math.sin(s), y0 - k * r * Math.cos(s)];
      const c2 = [x3 + k * r * Math.sin(e), y3 + k * r * Math.cos(e)];
      if (i === 0) path += `${n(x0)} ${n(y0)} m `;
      path += `${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(x3)} ${n(y3)} c `;
    }
    this.ops.push(`q ${rgb(color)} RG ${n(width)} w ${cap} J ${path}S Q`);
  }

  circle(cx, cy, r, opts = {}) {
    if (opts.fill) return this.ellipse(cx, cy, r, r, 0, opts.fill);
    this.arc(cx, cy, r, 0, Math.PI * 2, opts);
  }

  ellipse(cx, cy, rx, ry, angle, fill) {
    const k = 0.5523;
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    const path = `${n(rx)} 0 m ${n(rx)} ${n(k * ry)} ${n(k * rx)} ${n(ry)} 0 ${n(ry)} c ${n(-k * rx)} ${n(ry)} ${n(-rx)} ${n(k * ry)} ${n(-rx)} 0 c ${n(-rx)} ${n(-k * ry)} ${n(-k * rx)} ${n(-ry)} 0 ${n(-ry)} c ${n(k * rx)} ${n(-ry)} ${n(rx)} ${n(-k * ry)} ${n(rx)} 0 c f`;
    this.ops.push(`q ${rgb(fill)} rg ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${n(cx)} ${n(PAGE.h - cy)} cm ${path} Q`);
  }

  async build({ title = 'Report', author = 'Annamaya' } = {}) {
    const enc = new TextEncoder();
    const chunks = [];
    let length = 0;
    const offsets = [];
    const push = (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      length += bytes.length;
    };
    const begin = (id) => {
      offsets[id] = length;
      push(`${id} 0 obj\n`);
    };

    const fonts = Object.keys(FONT_ID);
    const firstFont = 3;
    const firstPage = firstFont + fonts.length;
    const infoId = firstPage + this.pages.length * 2;

    push('%PDF-1.4\n%âãÏÓ\n');
    begin(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    begin(2);
    push(`<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')}] >>\nendobj\n`);
    fonts.forEach((f, i) => {
      begin(firstFont + i);
      push(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAME[f]} /Encoding /WinAnsiEncoding >>\nendobj\n`);
    });
    const fontRes = fonts.map((f, i) => `/${FONT_ID[f]} ${firstFont + i} 0 R`).join(' ');

    for (let i = 0; i < this.pages.length; i++) {
      const pageId = firstPage + i * 2;
      let body = enc.encode(this.pages[i].join('\n'));
      let filter = '';
      if (typeof CompressionStream !== 'undefined') {
        const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('deflate'));
        body = new Uint8Array(await new Response(stream).arrayBuffer());
        filter = ' /Filter /FlateDecode';
      }
      begin(pageId);
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << ${fontRes} >> >> /Contents ${pageId + 1} 0 R >>\nendobj\n`);
      begin(pageId + 1);
      push(`<< /Length ${body.length}${filter} >>\nstream\n`);
      push(body);
      push('\nendstream\nendobj\n');
    }

    const hexStr = (s) => `<${codes(s).map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
    begin(infoId);
    push(`<< /Title ${hexStr(title)} /Author ${hexStr(author)} /Creator ${hexStr('Annamaya')} >>\nendobj\n`);

    const xref = length;
    push(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= infoId; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}
