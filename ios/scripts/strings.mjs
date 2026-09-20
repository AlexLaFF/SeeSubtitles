// The iOS half of the one-catalogue rule. Every string the app shows is written once, in web/locales.js, in
// English and Simplified Chinese; Swift code names it as L("key"). This module finds the keys the Swift sources
// use, checks each one exists in the catalogue, and writes them out as the String Catalogs Xcode compiles:
//   Localizable.xcstrings   what L("key") looks up
//   InfoPlist.xcstrings     the permission prompts, from the catalogue's ios.plist.* keys
// Placeholders stay as the catalogue writes them ({n}); L() fills them in, so nothing is converted to %@.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const IOS = path.resolve(HERE, '..');
export const CATALOGUE = path.resolve(IOS, '..', 'web', 'locales.js');
const SOURCES = ['App', 'Packages', 'Widgets'].map((d) => path.join(IOS, d));
const PLIST_PREFIX = 'ios.plist.';

function swiftFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '.build') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) swiftFiles(p, out);
    else if (e.name.endsWith('.swift')) out.push(p);
  }
  return out;
}

/** Keys the Swift sources name: L("key"…), and LKey("key") where a key is kept for later. → Map key → [file:line] */
export function usedKeys() {
  const used = new Map();
  const re = /\bL(?:Key)?\(\s*"([^"\\]+)"/g;
  for (const file of SOURCES.flatMap((d) => swiftFiles(d))) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      for (const m of line.matchAll(re)) {
        if (!used.has(m[1])) used.set(m[1], []);
        used.get(m[1]).push(`${path.relative(IOS, file)}:${i + 1}`);
      }
    });
  }
  return used;
}

export function catalogue() {
  delete require.cache[CATALOGUE];
  return require(CATALOGUE).strings; // key → [en, zh]
}

/** What is wrong, as sentences; empty when the Swift code and the catalogue agree. */
export function problems(used = usedKeys(), strings = catalogue()) {
  const out = [];
  for (const [key, where] of used) {
    if (!strings[key]) out.push(`"${key}" is used at ${where[0]} but is not in web/locales.js`);
  }
  for (const key of Object.keys(strings)) {
    if (!key.startsWith('ios.')) continue;
    if (!key.startsWith(PLIST_PREFIX) && !used.has(key)) out.push(`"${key}" is in the catalogue under ios. but no Swift file uses it`);
  }
  return out;
}

const unit = (value) => ({ stringUnit: { state: 'translated', value } });
function xcstrings(entries) {
  const strings = {};
  for (const [key, [en, zh]] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    strings[key] = { extractionState: 'manual', localizations: { en: unit(en), 'zh-Hans': unit(zh) } };
  }
  return `${JSON.stringify({ sourceLanguage: 'en', strings, version: '1.0' }, null, 2)}\n`;
}

/** Write both String Catalogs; returns what changed. Files are only touched when their content differs, so a
 *  build that changes nothing does not invalidate Xcode's compiled strings. */
export function exportStrings(outDir = path.join(IOS, 'Resources')) {
  const strings = catalogue();
  const used = usedKeys();
  const app = [...used.keys()].filter((k) => strings[k]).map((k) => [k, strings[k]]);
  const plist = Object.entries(strings).filter(([k]) => k.startsWith(PLIST_PREFIX)).map(([k, v]) => [k.slice(PLIST_PREFIX.length), v]);
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [name, body] of [['Localizable.xcstrings', xcstrings(app)], ['InfoPlist.xcstrings', xcstrings(plist)]]) {
    const file = path.join(outDir, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) { fs.writeFileSync(file, body); written.push(name); }
  }
  return { keys: app.length, plist: plist.length, written };
}
