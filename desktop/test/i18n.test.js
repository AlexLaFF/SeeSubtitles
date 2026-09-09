'use strict';
// Every string the app shows exists in BOTH languages: the catalog is one table (so parity is structural), and
// this test checks that every key referenced from code and pages is in the table, non-empty, with matching
// placeholders — so a half-translated screen cannot ship.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LOCALES = require('../../web/locales.js');

const ROOT = path.join(__dirname, '..', '..');
const SOURCES = [
  ...fs.readdirSync(path.join(ROOT, 'web')).filter((f) => /\.(js|html)$/.test(f) && f !== 'locales.js').map((f) => path.join(ROOT, 'web', f)),
  ...['main.js', 'lib/updater.js', 'local-server.js'].map((f) => path.join(ROOT, 'desktop', f)),
];

test('both languages carry every string, non-empty, with the same placeholders', () => {
  const keys = Object.keys(LOCALES.strings);
  assert.ok(keys.length > 400);
  for (const k of keys) {
    const [en, zh] = LOCALES.strings[k];
    assert.ok(typeof en === 'string' && en.length, `${k}: English missing`);
    assert.ok(typeof zh === 'string' && zh.length, `${k}: Chinese missing`);
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
    assert.equal(ph(en), ph(zh), `${k}: placeholders differ`);
    assert.equal(LOCALES.en[k], en); assert.equal(LOCALES.zh[k], zh);
  }
});

test('every key used by the pages and the main process is in the catalog', () => {
  const used = new Map();
  for (const file of SOURCES) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /(?:\bt|I18n\.t|i18n\.t|tr)\(\s*'([\w.\-]+)'|data-i18n(?:-placeholder|-title)?="([\w.\-]+)"/g;
    let m;
    while ((m = re.exec(src))) used.set(m[1] || m[2], path.relative(ROOT, file));
  }
  assert.ok(used.size > 300, `only ${used.size} keys referenced — is the scan broken?`);
  const missing = [...used].filter(([k]) => !(k in LOCALES.strings));
  assert.deepEqual(missing, [], `keys missing from web/locales.js: ${missing.map(([k, f]) => `${k} (${f})`).join(', ')}`);
});

test('no page declares a variable named t (it would shadow the translation function)', () => {
  const offenders = [];
  for (const file of SOURCES) {
    if (!file.endsWith('.js') || !file.includes('/web/')) continue;
    const src = fs.readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => { if (/\b(const|let|var)\s+t\s*=/.test(line) || /\(\s*t\s*[,)]/.test(line) && /=>|function/.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}`); });
  }
  assert.deepEqual(offenders, [], `rename these: ${offenders.join(', ')}`);
});
