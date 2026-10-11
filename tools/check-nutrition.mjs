import { readFile } from 'node:fs/promises';
import { readXlsx } from '../js/xlsx.js';
import { parseMenuWorkbook, MEALS } from '../js/menu.js';
import { estimateItem } from '../js/nutrition.js';
const buf = await readFile(new URL('../menu/2026-10.xlsx', import.meta.url));
const menu = parseMenuWorkbook(await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), { fileName: '2026-10.xlsx' });
const seen = new Map();
for (const plan of Object.values(menu.plans)) for (const day of Object.values(plan.days)) for (const m of MEALS) for (const i of day[m]) seen.set(i.raw, estimateItem(i.raw));
let unknown = 0;
for (const [raw, e] of [...seen].sort()) { if (!e.known) unknown++; console.log(`${e.known ? ' ' : '?'} ${String(e.kcal).padStart(4)} kcal  P${e.protein} C${e.carbs} F${e.fat}  ${raw}  [${e.serving}]`); }
console.log(`${seen.size} distinct lines, ${unknown} without a specific rule`);
