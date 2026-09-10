'use strict';
// Inside app.asar the desktop files do not sit next to the repo's core/ directory, so a relative require
// that works from source ("../../core/names") throws "Cannot find module" in the packaged app — and no test
// that runs from source can see it. Every cross-package require therefore goes through @subs/core/*.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function sources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'resources', 'build', 'assets', 'helpers'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sources(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('nothing under desktop/ reaches the core package by a relative path', () => {
  const bad = [];
  for (const file of sources(ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/require\(\s*['"](\.\.[^'"]*\/core\/[^'"]+)['"]\s*\)/g)) {
      bad.push(`${path.relative(ROOT, file)} → ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `use @subs/core/… instead:\n${bad.join('\n')}`);
});

test('the core subpaths the desktop imports are really exported by the package', () => {
  const used = new Set();
  for (const file of sources(ROOT)) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"](@subs\/core\/[^'"]+)['"]\s*\)/g)) used.add(m[1]);
  }
  assert.ok(used.size, 'expected the desktop to import from @subs/core');
  for (const spec of used) assert.doesNotThrow(() => require.resolve(spec), `${spec} does not resolve`);
});
