#!/usr/bin/env node
'use strict';
// Builds the native Swift helpers and puts the app's ffmpeg into resources/bin for bundling. The ffmpeg is our own
// build (scripts/build-ffmpeg.sh: only the components the app calls, LGPL, about a tenth the size of the npm one),
// cached under ~/.cache/seesubtitles and built there the first time. No ffprobe: ffmpeg reads a file's duration
// itself (lib/mp4.js). SEESUBTITLES_FFMPEG=<path> bundles a binary from somewhere else; it must still pass the checks.
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
/** The cached build, made now when it is missing (a few minutes once; afterwards a copy). */
function ffmpegPath() {
  if (process.env.SEESUBTITLES_FFMPEG) return process.env.SEESUBTITLES_FFMPEG;
  const script = path.join(__dirname, 'build-ffmpeg.sh');
  return execFileSync('sh', [script], { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim().split('\n').pop();
}
copyBin(ffmpegPath(), 'ffmpeg');
fs.rmSync(path.join(BIN, 'ffprobe'), { force: true }); // left by builds up to 0.8.0

// every binary the app ships must run on Apple silicon without Rosetta, and link nothing outside the system
for (const name of fs.readdirSync(BIN)) {
  const file = path.join(BIN, name);
  const kind = execFileSync('file', ['-b', file]).toString();
  if (!/Mach-O/.test(kind)) continue;
  if (!/arm64/.test(kind)) throw new Error(`${name} is not an arm64 build: ${kind.trim()}`);
  const foreign = execFileSync('otool', ['-L', file]).toString().split('\n').slice(1).map((l) => l.trim().split(' ')[0]).filter((l) => l && !/^(\/usr\/lib\/|\/System\/Library\/Frameworks\/)/.test(l));
  if (foreign.length) throw new Error(`${name} links libraries that are not on every Mac: ${foreign.join(', ')}`);
}
// and the ffmpeg must be ours: the app's components, no GPL — never again the 45 MB kitchen sink
const version = execFileSync(path.join(BIN, 'ffmpeg'), ['-version']).toString();
if (!/seesubtitles/.test(version)) throw new Error('resources/bin/ffmpeg is not the app\'s own build (scripts/build-ffmpeg.sh)');
if (/--enable-(gpl|nonfree)/.test(version)) throw new Error('resources/bin/ffmpeg was built with GPL or non-free components');
console.log(`  ${version.split('\n')[0]}`);
