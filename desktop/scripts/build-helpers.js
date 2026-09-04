#!/usr/bin/env node
'use strict';
// Builds the native Swift helpers and copies static ffmpeg/ffprobe into resources/bin for bundling.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'resources', 'bin');
fs.mkdirSync(BIN, { recursive: true });

for (const name of ['capture-helper', 'render-subs']) {
  const src = path.join(ROOT, 'helpers', `${name}.swift`);
  const out = path.join(BIN, name);
  console.log(`swiftc -O ${path.relative(ROOT, src)} → ${path.relative(ROOT, out)}`);
  execFileSync('swiftc', ['-O', '-o', out, src], { stdio: 'inherit' });
}

function copyBin(src, name) {
  const out = path.join(BIN, name);
  fs.copyFileSync(src, out);
  fs.chmodSync(out, 0o755);
  console.log(`${name}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB from ${src}`);
}
copyBin(require('ffmpeg-static'), 'ffmpeg');
copyBin(require('ffprobe-static').path, 'ffprobe');

for (const name of ['ffmpeg', 'ffprobe']) {
  const v = execFileSync(path.join(BIN, name), ['-version']).toString().split('\n')[0];
  console.log(`  ${v}`);
}
