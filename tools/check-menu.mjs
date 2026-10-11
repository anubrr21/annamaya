import { readFile } from 'node:fs/promises';
import { readXlsx } from '../js/xlsx.js';
import { parseMenuWorkbook, menuFor, currentMeal, resolveVariant } from '../js/menu.js';

const file = process.argv[2] || new URL('../menu/2026-10.xlsx', import.meta.url);
const buf = await readFile(file);
const wb = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const menu = parseMenuWorkbook(wb, { fileName: String(file).split(/[\/]/).pop() });
console.log(menu.key, menu.label, Object.keys(menu.plans), 'warnings:', menu.warnings, 'notes:', menu.notes.length);
for (const plan of Object.keys(menu.plans)) {
  const days = Object.keys(menu.plans[plan].days).map(Number).sort((a, b) => a - b);
  console.log(plan, 'covers', days.length, 'days:', days.join(' '));
}
const show = (d, plan, meal) => console.log(`\n${d} ${plan} ${meal}:\n ` + menuFor(menu, new Date(menu.year, menu.month - 1, d), plan)[meal].map((i) => `${i.name}${i.note ? ` [${i.note}]` : ''}${i.tag ? ` <${i.tag}>` : ''}`).join('\n  '));
show(11, 'regular', 'lunch'); show(11, 'regular', 'dinner'); show(11, 'special', 'breakfast'); show(15, 'regular', 'snacks'); show(20, 'regular', 'breakfast');
show(17, 'regular', 'dinner'); show(1, 'special', 'dinner'); show(4, 'regular', 'lunch'); show(4, 'regular', 'snacks');
console.log(resolveVariant('Fruit Custard with Pine Apple (3), and Custard Apple (17, 31)', 3));
for (const t of ['06:00', '08:00', '10:00', '13:00', '17:00', '18:30', '20:00', '22:10']) {
  const [h, m] = t.split(':').map(Number);
  const c = currentMeal(new Date(2026, 9, 11, h, m));
  console.log(t, c.meal, c.state, c.minutes, c.date.getDate());
}
