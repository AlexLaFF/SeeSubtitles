'use strict';
// The sending end and the receiving end together: the app's own CloudLink and UploadQueue against the real
// server.js, through a wire that is cut once in the middle of the file. What arrives must be the file, sent once
// over — and a video sent as audio only must arrive as its sound, taken out by a real ffmpeg.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { openDb } = require('../../server/lib/db');
const { createAuth } = require('../../server/lib/auth');
const { CloudLink } = require('../cloud');
const { UploadQueue } = require('../lib/uploads');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
// Two ffmpegs: a full one (Homebrew, on PATH) makes the test video — the app's own build has no video encoder —
// and the app's build (resources/bin, when built) takes the sound out, exactly as the shipped app would.
const FULL_FFMPEG = process.env.FFMPEG_FULL || 'ffmpeg';
const BUNDLED = path.join(__dirname, '..', 'resources', 'bin', 'ffmpeg');
const FFMPEG = fs.existsSync(BUNDLED) ? BUNDLED : FULL_FFMPEG;

async function startServer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-resume-'));
  const db = openDb(root);
  const auth = createAuth(db);
  auth.addUser('owner@test.local', 'owner-password');
  auth.setRole('owner@test.local', 'admin');
  const token = auth.login('owner@test.local', 'owner-password', 'bearer').token;
  db.close();
  const port = await freePort();
  const env = {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: root, BASE_URL: `http://127.0.0.1:${port}`, SIGNUP_MODE: 'closed',
    // explicit, so the repo's .env can never supply real ones to this server
    TENCENT_APPID: '1000000000', TENCENT_SECRET_ID: 'AKIDthrowawaytestkeynotreal00000000', TENCENT_SECRET_KEY: 'throwawaytestsecretnotreal000000', TOKENHUB_API_KEY: '', REQUEST_WEBHOOK_URL: '',
  };
  const proc = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server', 'server.js')], { env, stdio: 'ignore' });
  t.after(async () => { proc.kill(); await sleep(100); fs.rmSync(root, { recursive: true, force: true }); });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  return { root, port, token };
}

/** A wire to the server that is cut, once, when `cutAfter` bytes have gone up one connection. */
async function cuttableWire(t, serverPort, cutAfter) {
  let cuts = 0;
  const proxy = net.createServer((client) => {
    const up = net.connect(serverPort, '127.0.0.1');
    let sent = 0;
    client.on('data', (d) => { sent += d.length; if (!cuts && sent > cutAfter) { cuts++; client.destroy(); up.destroy(); } });
    client.pipe(up); up.pipe(client);
    client.on('error', () => up.destroy()); up.on('error', () => client.destroy());
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  t.after(() => proxy.close());
  return { port: proxy.address().port, cuts: () => cuts };
}

/** A wire that goes dead without closing, once: after `freezeAfter` bytes it carries nothing more either way, and neither end is told. */
async function freezableWire(t, serverPort, freezeAfter) {
  let frozen = 0;
  const held = [];
  const proxy = net.createServer((client) => {
    const up = net.connect(serverPort, '127.0.0.1');
    held.push(client, up);
    let sent = 0;
    client.on('data', (d) => {
      sent += d.length;
      if (!frozen && sent > freezeAfter) { frozen++; client.unpipe(up); up.unpipe(client); client.pause(); client.removeAllListeners('data'); }
    });
    client.pipe(up); up.pipe(client);
    client.on('error', () => up.destroy()); up.on('error', () => client.destroy());
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  t.after(() => { for (const s of held) s.destroy(); proxy.close(); });
  return { port: proxy.address().port, frozen: () => frozen };
}

function link(port, token) {
  const cloud = new CloudLink({ log() {} });
  cloud.cfg = { ...cloud.cfg, url: `http://127.0.0.1:${port}`, token };
  return cloud;
}

test('a file whose connection is cut half way arrives whole, carried on from where it broke', async (t) => {
  const s = await startServer(t);
  const wire = await cuttableWire(t, s.port, 3 * 1024 * 1024);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-resume-src-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'talk.mp4');
  fs.writeFileSync(file, crypto.randomBytes(8 * 1024 * 1024));
  const logs = [];
  const q = new UploadQueue({ cloud: link(wire.port, s.token), retryMs: [50], log: (level, text) => logs.push(text) });
  q.add({ file, sourceLang: 'yue', targetLang: 'zh' });
  const job = await new Promise((resolve, reject) => { q.once('done', resolve); q.on('status', (st) => { if (st.last && st.last.ok === false) reject(new Error(st.last.error)); }); });
  assert.equal(wire.cuts(), 1, 'the wire was cut');
  const carried = logs.find((l) => /carrying on from/.test(l));
  assert.ok(carried, `it carried on rather than began again:\n${logs.join('\n')}`);
  assert.ok(Number(/from ([\d.]+) of/.exec(carried)[1]) > 0);
  const arrived = fs.readFileSync(path.join(s.root, 'jobs', job.id, 'source.mp4'));
  assert.equal(arrived.length, 8 * 1024 * 1024);
  assert.ok(arrived.equals(fs.readFileSync(file)), 'byte for byte the file');
});

test('a connection that goes dead without saying so is dropped, and a new one carries the file on', async (t) => {
  const s = await startServer(t);
  const wire = await freezableWire(t, s.port, 3 * 1024 * 1024);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-freeze-src-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'talk.mp4');
  fs.writeFileSync(file, crypto.randomBytes(48 * 1024 * 1024)); // more than the buffers along a dead wire will swallow
  const logs = []; const seen = [];
  const q = new UploadQueue({ cloud: link(wire.port, s.token), retryMs: [50], quietMs: 150, stallMs: 600, log: (level, text) => logs.push(text) });
  q.on('status', (st) => { if (st.current && st.current.retrying) seen.push(st.current.percent); });
  const started = Date.now();
  q.add({ file, sourceLang: 'yue', targetLang: 'zh' });
  const job = await new Promise((resolve, reject) => { q.once('done', resolve); q.on('status', (st) => { if (st.last && st.last.ok === false) reject(new Error(st.last.error)); }); });
  assert.equal(wire.frozen(), 1, 'the wire went dead');
  assert.ok(seen.length, 'the row said it was waiting for the connection');
  assert.ok(logs.some((l) => /took nothing for/.test(l)) && logs.some((l) => /carrying on from/.test(l)), logs.join('\n'));
  assert.ok(Date.now() - started < 15_000, 'in seconds, not when TCP gets round to it');
  // the server still holds the dead connection open: the new one had to take the file over from it
  assert.ok(fs.readFileSync(path.join(s.root, 'jobs', job.id, 'source.mp4')).equals(fs.readFileSync(file)), 'byte for byte the file');
});

test('a video sent as audio only arrives as its sound', async (t) => {
  if (spawnSync(FULL_FFMPEG, ['-version']).status !== 0) return t.skip('no ffmpeg here');
  const s = await startServer(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-audio-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const video = path.join(dir, 'Lecture 12.mp4');
  const made = spawnSync(FULL_FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-c:v', 'mpeg4', '-q:v', '2', '-c:a', 'aac', '-shortest', video]);
  assert.equal(made.status, 0, String(made.stderr));
  const q = new UploadQueue({ cloud: link(s.port, s.token), ffmpeg: FFMPEG, tmpDir: path.join(dir, 'tmp'), retryMs: [50] });
  q.add({ file: video, sourceLang: 'zh', targetLang: 'zh', audioOnly: true });
  const job = await new Promise((resolve, reject) => { q.once('done', resolve); q.on('status', (st) => { if (st.last && st.last.ok === false) reject(new Error(st.last.error)); }); });
  const arrived = path.join(s.root, 'jobs', job.id, 'source.m4a');
  assert.ok(fs.existsSync(arrived), 'named for what it is');
  assert.ok(fs.statSync(arrived).size < fs.statSync(video).size / 3, 'a fraction of the video');
  const probe = String(spawnSync(FFMPEG, ['-hide_banner', '-i', arrived]).stderr);
  assert.match(probe, /Audio: aac/);
  assert.doesNotMatch(probe, /Video:/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
});
