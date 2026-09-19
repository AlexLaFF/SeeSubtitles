#!/usr/bin/env node
'use strict';
// Builds the native Swift helpers and copies a static ffmpeg into resources/bin for bundling. No ffprobe: the only one
// npm has for macOS is an Intel build (even in ffprobe-static's arm64 folder), which a Mac without Rosetta cannot run;
// ffmpeg reads a file's duration itself (lib/mp4.js).
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
fs.rmSync(path.join(BIN, 'ffprobe'), { force: true }); // left by builds up to 0.8.0

// every binary the app ships must run on Apple silicon without Rosetta
for (const name of fs.readdirSync(BIN)) {
  const kind = execFileSync('file', ['-b', path.join(BIN, name)]).toString();
  if (/Mach-O/.test(kind) && !/arm64/.test(kind)) throw new Error(`${name} is not an arm64 build: ${kind.trim()}`);
}
console.log(`  ${execFileSync(path.join(BIN, 'ffmpeg'), ['-version']).toString().split('\n')[0]}`);
