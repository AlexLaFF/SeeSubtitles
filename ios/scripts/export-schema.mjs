#!/usr/bin/env node
// core/schema.js → the JSON the iOS app reads its languages, pipelines, models and tuning ranges from, so the
// phone offers exactly the pairs the relay accepts and never a list typed out a second time.
//   node ios/scripts/export-schema.mjs          write it
//   node ios/scripts/export-schema.mjs --check  fail when the checked-in file is out of date
// Also writes the decimator fixture the Swift tests compare against (core/decimator.js on a fixed signal).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const schema = require(path.join(ROOT, 'core', 'schema.js'));
const names = require(path.join(ROOT, 'core', 'names.js'));
const { Decimator } = require(path.join(ROOT, 'core', 'decimator.js'));
const PKG = path.join(ROOT, 'ios', 'Packages', 'SubtitlesCore');

const field = (key) => schema.FIELDS.find((f) => f.key === key);
const range = (key) => { const f = field(key); return { min: f.min, max: f.max, step: f.step, default: f.default }; };
const live = {
  pipelines: schema.PIPELINES,
  defaultPipeline: schema.DEFAULT_PIPELINE,
  // lists, not objects: the order is the order the pickers show, and a JSON object does not promise one
  pairs: Object.fromEntries(Object.entries(schema.PAIRS).map(([p, pairs]) => [p, Object.entries(pairs).map(([source, targets]) => ({ source, targets }))])),
  languageNames: schema.LANG_NAMES,
  fileLabels: names.LANG_LABEL, // 中文 in 9月5号14点33分中文字幕.zh.srt
  models: Object.fromEntries(Object.entries(schema.TRANS_MODELS).map(([p, list]) => [p, list.map(([id, label]) => ({ id, label }))])),
  defaultModel: schema.DEFAULT_MODEL,
  defaults: { source: field('source').default, target: field('target').default },
  tuning: { vadSilenceTime: range('vadSilenceTime'), maxSpeakTime: range('maxSpeakTime'), noiseThreshold: range('noiseThreshold') },
  filterModal: field('filterModal').options.map(([id, label]) => ({ id, label })),
};

// A signal with everything a microphone has: tones below and above the cutoff, a burst far past full scale,
// and noise from a fixed generator, fed in uneven chunk sizes so the filter's state is carried across calls.
function fixture() {
  const n = 48000;
  const input = new Int16Array(n);
  let seed = 12345;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / 48000;
    let v = 9000 * Math.sin(2 * Math.PI * 440 * t) + 6000 * Math.sin(2 * Math.PI * 9500 * t) + 3000 * noise();
    if (i > 20000 && i < 22400) v = 60000 * Math.sin(2 * Math.PI * 300 * t); // far past full scale: the input clips, the filter overshoots, the output clamps
    input[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
  }
  const d = new Decimator();
  const sizes = [1, 2, 4799, 4800, 4801, 37, 9600, 13, 960];
  const out = [];
  for (let at = 0, k = 0; at < n; k++) { const size = Math.min(sizes[k % sizes.length], n - at); out.push(...d.process(input.subarray(at, at + size))); at += size; }
  const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
  return { chunkSizes: sizes, input: b64(input), output: b64(Int16Array.from(out)), taps: Array.from(d.h) };
}

const files = [
  [path.join(PKG, 'Sources', 'SubtitlesCore', 'Resources', 'live-schema.json'), `${JSON.stringify(live, null, 2)}\n`],
  [path.join(PKG, 'Tests', 'SubtitlesCoreTests', 'Fixtures', 'decimator.json'), `${JSON.stringify(fixture())}\n`],
];
const check = process.argv.includes('--check');
let stale = 0;
for (const [file, body] of files) {
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body;
  if (same) continue;
  if (check) { console.error(`error: ${path.relative(ROOT, file)} is out of date — run node ios/scripts/export-schema.mjs`); stale++; }
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); console.log('wrote', path.relative(ROOT, file)); }
}
process.exit(stale ? 1 : 0);
