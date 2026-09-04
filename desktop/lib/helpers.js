'use strict';
// Locates the native Swift helpers (capture-helper, render-subs).
//  - packaged app: prebuilt binaries in <Resources>/bin (never compiles)
//  - development: resources/bin, compiled from helpers/<name>.swift with swiftc when missing or stale
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SRC_DIR = path.join(__dirname, '..', 'helpers');
let BIN_DIR = process.env.SUBS_BIN_DIR || path.join(__dirname, '..', 'resources', 'bin');
let PACKAGED = /^(1|true)$/i.test(process.env.SUBS_PACKAGED || '');
const builds = new Map();

function configure({ binDir, packaged } = {}) {
  if (binDir) BIN_DIR = binDir;
  if (packaged != null) PACKAGED = !!packaged;
  builds.clear();
}

function buildHelper(name, log = () => {}) {
  if (builds.has(name)) return builds.get(name);
  const src = path.join(SRC_DIR, `${name}.swift`);
  const bin = path.join(BIN_DIR, name);
  const p = new Promise((resolve) => {
    const binStat = fs.statSync(bin, { throwIfNoEntry: false });
    if (PACKAGED) {
      if (!binStat) log(`native helper "${name}" is missing from the app bundle`);
      return resolve(binStat ? bin : null);
    }
    const srcStat = fs.statSync(src, { throwIfNoEntry: false });
    if (!srcStat) return resolve(binStat ? bin : null);
    if (binStat && binStat.mtimeMs >= srcStat.mtimeMs) return resolve(bin);
    fs.mkdirSync(BIN_DIR, { recursive: true });
    log(`compiling native helper "${name}" (first run, ~10 s)…`);
    execFile('swiftc', ['-O', '-o', bin, src], { timeout: 180_000 }, (err, _out, stderr) => {
      if (err) {
        log(`helper "${name}" build failed: ${String(stderr || err.message).split('\n')[0].slice(0, 160)}`);
        builds.delete(name);
        return resolve(binStat ? bin : null);
      }
      resolve(bin);
    });
  });
  builds.set(name, p);
  return p;
}

module.exports = { buildHelper, configure, get BIN_DIR() { return BIN_DIR; } };
