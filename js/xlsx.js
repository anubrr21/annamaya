const dec = new TextDecoder('utf-8');

function findEndOfCentralDirectory(view) {
  const min = Math.max(0, view.byteLength - 65557);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error('Not a valid .xlsx file (no ZIP directory found).');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unpack .xlsx files. Please update it.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    async text(name) {
      const e = entries.get(name);
      if (!e) return null;
      const nameLen = view.getUint16(e.localOffset + 26, true);
      const extraLen = view.getUint16(e.localOffset + 28, true);
      const start = e.localOffset + 30 + nameLen + extraLen;
      const raw = new Uint8Array(buffer, start, e.compSize);
      if (e.method === 0) return dec.decode(raw);
      if (e.method === 8) return dec.decode(await inflateRaw(raw));
      throw new Error(`Unsupported ZIP compression method ${e.method}.`);
    },
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTITIES[n])
    .replace(/_x000D_/g, '');
}

function attr(tag, name) {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
}

function textRuns(xml) {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) out += m[1];
  return unescapeXml(out);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1] ? textRuns(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')) : '');
  return out;
}

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, shared) {
  const cells = [];
  const re = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const ref = attr(m[1], 'r');
    const inner = m[2];
    if (!ref || !inner) continue;
    const type = attr(m[1], 't');
    let value;
    if (type === 'inlineStr') value = textRuns(inner);
    else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!v) continue;
      value = type === 's' ? shared[Number(v[1])] ?? '' : unescapeXml(v[1]);
    }
    if (value === '' || value == null) continue;
    const parts = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!parts) continue;
    cells.push({ ref, col: colToIndex(parts[1]), row: Number(parts[2]), value: String(value) });
  }
  return cells;
}

export async function readXlsx(buffer) {
  const zip = await unzip(buffer);
  const workbookXml = await zip.text('xl/workbook.xml');
  if (!workbookXml) throw new Error('This file is not an Excel workbook.');
  const relsXml = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
  const targets = new Map();
  for (const m of relsXml.matchAll(/<Relationship\s([^>]*?)\/?>/g)) {
    targets.set(attr(m[1], 'Id'), attr(m[1], 'Target'));
  }
  const shared = parseSharedStrings(await zip.text('xl/sharedStrings.xml'));
  const sheets = [];
  for (const m of workbookXml.matchAll(/<sheet\s([^>]*?)\/?>/g)) {
    const name = attr(m[1], 'name');
    let target = targets.get(attr(m[1], 'r:id')) || '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = await zip.text(target);
    if (xml) sheets.push({ name, cells: parseSheet(xml, shared) });
  }
  if (!sheets.length) throw new Error('No readable sheets in this workbook.');
  return { sheets };
}
