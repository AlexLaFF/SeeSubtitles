#!/usr/bin/env node
// The iOS app's release test: everything about the phone app that can be checked without a person holding one.
//
//   node ios/e2e/run.mjs            all of it
//   node ios/e2e/run.mjs core       the Swift core: unit tests, then the core against the real server
//   node ios/e2e/run.mjs ui         the app itself, driven in the Simulator: demo mode, then signed in to the server
//   node ios/e2e/run.mjs --real     the core against a server that is already running — see "Real keys" below
//
// What runs, and against what:
//   1 · unit       `swift test` in SubtitlesCore: the relay client, recorder, crash recovery, MP4 export, the
//                  speech queue against the Mac's decisions, the decimator against the Mac's samples.
//   2 · core e2e   EndToEndTests.swift: the phone's real networking code against server/server.js, started by
//                  harness.mjs with a throwaway database and stand-ins for Tencent and TokenHub. Accounts,
//                  two-factor, devices, the glossary, what each plan refuses, a whole talk through the relay and what
//                  it leaves on disk, metering, a summary, joining a talk a Mac is hosting, and that no key arrives.
//   3 · ui         SeeSubtitlesUITests: the built app in the Simulator. In demo mode: first run, a talk, Text,
//                  Listen, Reply, the ended card, the recording's three tabs, a summary, an MP4, rename, delete,
//                  Settings, the interface in Chinese. Signed in to the harness's server: a wrong password, login,
//                  a talk with a recording as the microphone, the account and its devices, joining a hosted talk,
//                  logging out.
// Each stage gets a server of its own: the server allows twenty sign-ins a quarter of an hour from one address.
//
// Real keys. Stages 2 and 3 cost nothing: nothing in them reaches Tencent. To run the core against the hosted
// server with real recognition and translation — what `npm run e2e` does for the Mac, and like it about ¥0.3 a run —
// set E2E_SERVER, E2E_PASSWORD and E2E_BUSINESS (a Business test account; E2E_HOBBY, E2E_SPENT and E2E_OWNER too if
// they exist), E2E_AUDIO (a real recording of speech, never committed) and pass --real. Tests that need the
// harness's control plane skip themselves.
//
// What none of this can see: a real microphone in a real room, AirPods, a phone call arriving, the camera reading a
// QR code, the lock screen of a real device, and how the voice sounds. The checklist at the end of a run lists them.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './harness.mjs';

const IOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const real = args.includes('--real');
const only = args.find((a) => a === 'core' || a === 'ui');
const DEVICE = process.env.E2E_SIMULATOR || 'iPhone 17 Pro';
const BUNDLE = 'com.alexlaff.subtitles.ios';

function run(title, cmd, cmdArgs, { cwd, env = {}, filter = null } = {}) {
  return new Promise((resolve) => {
    console.log(`\n── ${title}\n   ${cmd} ${cmdArgs.join(' ')}`);
    const began = Date.now();
    const proc = spawn(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const onData = (d) => {
      tail = (tail + d).slice(-20_000);
      for (const line of String(d).split('\n')) if (line.trim() && (!filter || filter.test(line))) console.log(`   ${line.replace(/\[[0-9;]*m/g, '').slice(0, 300)}`);
    };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('close', (code) => { console.log(`   ${code === 0 ? 'passed' : `FAILED (exit ${code})`} in ${Math.round((Date.now() - began) / 1000)} s`); resolve({ ok: code === 0, tail }); });
  });
}

const results = [];
const stage = async (name, fn) => { const r = await fn(); results.push([name, r.ok]); return r.ok; };

if (!only || only === 'core') {
  const core = path.join(IOS, 'Packages', 'SubtitlesCore');
  const shown = /✘|✔ Test run|Test run with|error:|recorded an issue|↳/;
  if (!real) await stage('unit', () => run('1 · unit — the Swift core on its own', 'swift', ['test', '--skip', 'EndToEndTests'], { cwd: core, filter: shown }));
  if (real) {
    for (const need of ['E2E_SERVER', 'E2E_PASSWORD', 'E2E_BUSINESS']) if (!process.env[need]) { console.error(`--real needs ${need} (see the top of this file)`); process.exit(2); }
    await stage('core e2e (real server)', () => run(`2 · the core against ${process.env.E2E_SERVER} — this spends real recognition time`, 'swift', ['test', '--filter', 'EndToEndTests'], { cwd: core, filter: shown }));
  } else {
    const harness = await start({ log: (t) => console.log(`\n   harness: ${t}`) });
    try { await stage('core e2e', () => run('2 · core e2e — the phone\'s networking code against the real server, with stand-ins for Tencent and TokenHub', 'swift', ['test', '--filter', 'EndToEndTests'], { cwd: core, env: harness.env, filter: shown })); }
    finally { await harness.close(); }
  }
}

if ((!only || only === 'ui') && !real) {
  const harness = await start({ log: (t) => console.log(`\n   harness: ${t}`) });
  try {
    // a clean phone: no app, no recordings, no remembered settings; the microphone already allowed, as a person would have
    spawnSync('xcrun', ['simctl', 'boot', DEVICE]);
    spawnSync('xcrun', ['simctl', 'uninstall', DEVICE, BUNDLE]);
    spawnSync('xcrun', ['simctl', 'privacy', DEVICE, 'grant', 'microphone', BUNDLE]);
    // xcodebuild hands TEST_RUNNER_<NAME> to the test process as <NAME>
    const env = Object.fromEntries(Object.entries(harness.env).map(([k, v]) => [`TEST_RUNNER_${k}`, v]));
    await stage('ui', () => run(`3 · ui — the app in the Simulator (${DEVICE})`, 'xcodebuild',
      ['test', '-project', 'SeeSubtitles.xcodeproj', '-scheme', 'SeeSubtitles', '-destination', `platform=iOS Simulator,name=${DEVICE}`, '-derivedDataPath', 'build', '-parallel-testing-enabled', 'NO'],
      { cwd: IOS, env, filter: /Test Case .*(passed|failed)|error:|failed:|\*\* TEST|XCTAssert|Executed \d+ tests/ }));
  } finally { await harness.close(); }
}

console.log('\n── result');
for (const [name, ok] of results) console.log(`   ${ok ? '✔' : '✘'} ${name}`);
const failed = results.filter(([, ok]) => !ok).length;
if (!failed && !real) {
  console.log(`
── what no test can see — walk these on a real iPhone before a release
   · a talk in a real room with the phone on the table: subtitles keep up, the recording is clear
   · lock the phone mid-talk: the lock screen shows the latest sentence, Stop works from there
   · take a phone call mid-talk: "paused · call", then it resumes and the recording has the gap as silence
   · Listen with AirPods in: the voice is in the AirPods, the microphone is still the phone's; take them out and it stops mid-word
   · Listen without headphones: nothing is spoken
   · scan a Mac's QR code with the Camera: the app opens on that talk
   · Save to Files, share an MP4 to another app, print the summary PDF
   · iPad: the Library beside the recording; the largest Dynamic Type size; VoiceOver reads a sentence as one element`);
}
process.exit(failed ? 1 : 0);
