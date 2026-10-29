// Local only: rules-only baseline for spike 2 (#3446). No network.
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const SPLIT = '2026-05-01';
const rows = db.prepare("select id, date, description, category, type from transactions where type != 'Transfer' order by date, id").all();
const sanitise = s => String(s ?? '')
  .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, '[IBAN]')
  .replace(/\b(?:\d[ -]?){12,19}\b/g, '[CARD]')
  .replace(/\d{6,}/g, '[NUM]')
  .slice(0, 200);
const norm = s => sanitise(s).toLowerCase().replace(/\s+/g, ' ').trim();

for (const t of ['CZ65 0800 0000 1920 0014 5399 x', 'card 4111 1111 1111 1111 x', 'ref 12345678', 'Shop 2026', 'GB29NWBK60161331926819']) {
  console.log('sanitise test:', JSON.stringify(sanitise(t)));
}
console.log('rows changed by sanitiser:', rows.filter(r => sanitise(r.description) !== r.description).length, 'of', rows.length);

const train = rows.filter(r => r.date < SPLIT), test = rows.filter(r => r.date >= SPLIT);
const counts = new Map();
for (const r of train) {
  const k = `${r.type}|${norm(r.description)}`;
  const m = counts.get(k) ?? new Map();
  m.set(r.category, (m.get(r.category) ?? 0) + 1);
  counts.set(k, m);
}
const pred = r => { const m = counts.get(`${r.type}|${norm(r.description)}`); return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null; };
const covered = test.filter(r => pred(r) !== null);
const right = covered.filter(r => pred(r) === r.category);
const pct = (a, n) => Math.round((1000 * a) / n) / 10;
console.log(JSON.stringify({
  train: train.length, test: test.length,
  coverage: pct(covered.length, test.length),
  accuracyWhereMatched: pct(right.length, covered.length),
  accuracyAllRows: pct(right.length, test.length),
  ruleMisses: test.length - covered.length,
  distinctTestDescriptions: new Set(test.map(r => norm(r.description))).size,
}, null, 2));
