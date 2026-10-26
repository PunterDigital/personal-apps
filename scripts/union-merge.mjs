// Resolves git conflict blocks by keeping both sides (ours first, then theirs).
// Usage: node union-merge.mjs <file>...
import fs from 'node:fs';

for (const file of process.argv.slice(2)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let state = 'none';
  let blocks = 0;
  for (const line of lines) {
    if (line.startsWith('<<<<<<< ')) { state = 'ours'; blocks++; continue; }
    if (line.startsWith('||||||| ') && state === 'ours') { state = 'base'; continue; }
    if (line === '=======' && (state === 'ours' || state === 'base')) { state = 'theirs'; continue; }
    if (line.startsWith('>>>>>>> ') && state === 'theirs') { state = 'none'; continue; }
    if (state === 'base') continue;
    out.push(line);
  }
  if (state !== 'none') throw new Error(`${file}: unterminated conflict`);
  fs.writeFileSync(file, out.join('\n'));
  console.log(`${file}: ${blocks} block(s) kept both sides`);
}
