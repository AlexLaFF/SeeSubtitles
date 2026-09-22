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

test('every file the app\'s pages load is still in the bundle after electron-builder.yml\'s filter on web/', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  const filter = [...yml.matchAll(/^\s+- "!([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(filter.length >= 5, 'the web/ filter is in electron-builder.yml');
  const excluded = (rel) => filter.some((glob) => new RegExp(`^${glob.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`).test(rel));
  const WEB = path.join(ROOT, '..', 'web');
  // the pages desktop/local-server.js serves (its PAGES map) and every asset they reference by URL
  const pages = ['index.html', 'desktop.html', 'summary.html', 'poster.html'];
  const needed = new Set(pages);
  for (const p of pages) {
    for (const m of fs.readFileSync(path.join(WEB, p), 'utf8').matchAll(/(?:src|href)="\/([\w./-]+)"/g)) if (m[1] !== 'schema.js' && !/^(control|playback|files)/.test(m[1])) needed.add(m[1]);
  }
  for (const css of [...needed].filter((f) => f.endsWith('.css'))) {
    for (const m of fs.readFileSync(path.join(WEB, css), 'utf8').matchAll(/url\(\/([\w./-]+)\)/g)) needed.add(m[1]);
  }
  const lost = [...needed].filter((f) => excluded(f) || !fs.existsSync(path.join(WEB, f)));
  assert.deepEqual(lost, [], `filtered out of the bundle or missing from web/: ${lost.join(', ')}`);
  // every page-to-page link points at a page the local server has (PAGES in local-server.js, or /files/<base>)
  const served = /^\/(control|files|settings|summary|poster|)(\/|\?|$)/;
  for (const f of [...pages, 'summary.js']) {
    for (const m of fs.readFileSync(path.join(WEB, f), 'utf8').matchAll(/href=["'`](\/[\w./-]*)/g)) if (!/\.\w+$/.test(m[1])) assert.match(m[1], served, `${f} links to ${m[1]}, which the app does not serve`);
  }
  // and the hosted-only pages are indeed left behind
  for (const f of ['site.html', 'login.html', 'account.js', 'usage-tiles.js']) assert.ok(excluded(f), `${f} is the server's, not the app's`);
});

test('the core subpaths the desktop imports are really exported by the package', () => {
  const used = new Set();
  for (const file of sources(ROOT)) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*['"](@subs\/core\/[^'"]+)['"]\s*\)/g)) used.add(m[1]);
  }
  assert.ok(used.size, 'expected the desktop to import from @subs/core');
  for (const spec of used) assert.doesNotThrow(() => require.resolve(spec), `${spec} does not resolve`);
});
