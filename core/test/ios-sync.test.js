'use strict';
// The iOS app follows the Mac app and the server, and this is what notices when it has fallen behind. It runs
// with every `npm test`, so with every Mac release too. Three things can drift:
//   ports     Swift written from a JavaScript (or Swift) original — ios/scripts/ports.mjs
//   schema    the languages, pipelines and tuning the phone offers — exported from core/schema.js
//   strings   every L("key") in Swift is in web/locales.js, and no ios.* string there is unused
// Each failure says which file to look at and the command that settles it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const script = (name) => path.join(ROOT, 'ios', 'scripts', name);
const present = fs.existsSync(script('ports.mjs'));
const run = (name, ...args) => {
  try { execFileSync(process.execPath, [script(name), ...args], { cwd: ROOT, stdio: 'pipe' }); return ''; }
  catch (err) { return `${err.stderr || ''}${err.stdout || ''}`.trim() || err.message; }
};

test('no original has changed since its iOS port was last checked', { skip: !present }, () => {
  assert.equal(run('ports.mjs', '--check'), '');
});

test('the languages and tuning the iOS app offers are the ones core/schema.js defines', { skip: !present }, () => {
  assert.equal(run('export-schema.mjs', '--check'), '');
});

test('every string the iOS app shows is in the catalogue, and the catalogue keeps no iOS string nothing uses', { skip: !present }, () => {
  assert.equal(run('check-strings.mjs'), '');
});
