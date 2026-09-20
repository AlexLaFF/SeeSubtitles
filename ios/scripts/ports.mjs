#!/usr/bin/env node
// Keeps the iOS app in step with the Mac app and the server. Some iOS code is a port: the same behaviour written
// again in Swift because a phone cannot run the JavaScript. A port drifts silently when its original changes, so
// ios/ports.json remembers what each original looked like when its port was last brought up to date, and
//   node ios/scripts/ports.mjs --check    fails, naming the Swift file to look at, when an original has changed since
//   node ios/scripts/ports.mjs --accept   records the originals as they are now — run it after the port has been
//                                         updated, or after deciding the change does not concern the phone
// `npm test` runs the check (core/test/ios-sync.test.js), and so does every Mac release through it.
// Things that are shared rather than ported need no entry here: strings (web/locales.js → check-strings.mjs),
// languages and tuning (core/schema.js → export-schema.mjs --check), the summary prompt (core/summary.js, used by
// the server for the phone), and everything the server does.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = path.join(ROOT, 'ios', 'ports.json');
const CORE = 'ios/Packages/SubtitlesCore/Sources/SubtitlesCore';

/** original → the Swift that mirrors it, and what about it the port must keep true. */
export const PORTS = [
  { original: 'core/decimator.js', port: `${CORE}/Audio/Decimator.swift`, keeps: 'sample-for-sample output (the fixture test compares them); re-run export-schema.mjs to refresh the fixture' },
  { original: 'core/remote-stream.js', port: `${CORE}/Live/RelayClient.swift`, keeps: 'query parameters, the 8-byte time + PCM frame, settings after ready, backoff, keepalive, the one-second queue' },
  { original: 'server/lib/live-proxy.js', port: `${CORE}/Live/RelayClient.swift`, keeps: 'the messages and error codes the relay sends, and which of them end a talk' },
  { original: 'core/transcript.js', port: `${CORE}/Transcript/Transcript.swift`, keeps: 'how results become lines: ids, what a settled sentence is' },
  { original: 'core/recorder.js', port: `${CORE}/Recording/Recorder.swift`, keeps: 'silence padding, cue timing and the 300 ms floor, one file when transcribing, the manifest fields' },
  { original: 'core/names.js', port: `${CORE}/Recording/RecordingNames.swift`, keeps: 'file names and language labels, so a recording reads the same on both' },
  { original: 'core/plain-text.js', port: `${CORE}/Transcript/SRT.swift`, keeps: 'what plain text strips' },
  { original: 'desktop/helpers/render-subs.swift', port: `${CORE}/Recording/MP4Exporter.swift`, keeps: 'the look of burned-in subtitles: stack, dimming, outline, fade, paddings' },
  { original: 'server/lib/live.js', port: `${CORE}/API/APIClient.swift`, keeps: 'the events a joined talk receives (init, line, clear, status)' },
  { original: 'server/lib/summaries.js', port: `${CORE}/API/APIClient.swift`, keeps: 'the events a summary streams (stage, delta, done, error)' },
  { original: 'design/tokens/marquee.css', port: 'ios/Packages/SubtitlesDesign/Sources/SubtitlesDesign/Tokens.swift', keeps: 'every colour, both appearances' },
];

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 16);

export function check() {
  const lock = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : {};
  const out = [];
  for (const p of PORTS) {
    if (!fs.existsSync(path.join(ROOT, p.original))) { out.push(`${p.original} is gone, and ${p.port} is a port of it`); continue; }
    if (!fs.existsSync(path.join(ROOT, p.port))) { out.push(`${p.port} is missing`); continue; }
    if (lock[p.original] !== sha(p.original)) out.push(`${p.original} has changed since its iOS port was last checked.\n    Look at ${p.port} — it keeps: ${p.keeps}.\n    Then: node ios/scripts/ports.mjs --accept`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--accept')) {
    const lock = Object.fromEntries([...new Set(PORTS.map((p) => p.original))].sort().map((f) => [f, sha(f)]));
    fs.writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`recorded ${Object.keys(lock).length} originals in ios/ports.json`);
  } else {
    const problems = check();
    for (const p of problems) console.error(`error: ${p}`);
    if (!problems.length) console.log(`ports: ${PORTS.length} ports, every original as it was when its port was last checked`);
    process.exit(problems.length ? 1 : 0);
  }
}
