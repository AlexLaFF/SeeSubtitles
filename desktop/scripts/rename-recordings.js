#!/usr/bin/env node
'use strict';
// Rename legacy "2026-09-05_14-33-05.*" recording sets to "9月5号14点33分录音.mp3" style.
//   node tools/rename-recordings.js [dir]          dry run (shows the plan)
//   node tools/rename-recordings.js [dir] --apply  rename
const fs = require('node:fs');
const path = require('node:path');
const names = require('@subs/core/names');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const folder = args.find((a) => !a.startsWith('--'));
if (!folder) { console.error('usage: rename-recordings.js <recordings folder> [--apply]'); process.exit(1); }
const dir = path.resolve(folder);

const sets = new Map(); // legacy base → [{ from, kind }]
for (const name of fs.readdirSync(dir)) {
  const p = names.parse(name);
  if (!p || p.style !== 'legacy' || !names.legacyToCn(p.base)) continue;
  if (!sets.has(p.base)) sets.set(p.base, []);
  sets.get(p.base).push({ from: name, kind: p.kind });
}
if (!sets.size) { console.log(`nothing to rename in ${dir}`); process.exit(0); }

const used = new Set();
let count = 0;
for (const [legacy, files] of [...sets.entries()].sort()) {
  let base = names.legacyToCn(legacy);
  let candidate = base;
  for (let i = 2; used.has(candidate) || names.KINDS.some((k) => fs.existsSync(path.join(dir, names.fileName(candidate, k, 'cn')))); i++) candidate = `${base}-${i}`;
  used.add(candidate);
  console.log(`${legacy}  →  ${candidate}`);
  for (const f of files) {
    const to = names.fileName(candidate, f.kind, 'cn');
    console.log(`   ${f.from}  →  ${to}`);
    if (apply) fs.renameSync(path.join(dir, f.from), path.join(dir, to));
    count++;
  }
}
console.log(apply ? `renamed ${count} files` : `dry run: ${count} files would be renamed — add --apply to do it`);
