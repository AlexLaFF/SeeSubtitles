'use strict';
// An upload that breaks off is carried on, not begun again. Against the real server.js with a throwaway database:
// a file cut off on the way, or whose sender goes quiet, keeps what arrived and says how much (`received`), and the
// rest arrives with ?offset= — also after the server restarted in between. One nobody comes back to is dropped and
// says so. Two 1.3 GB videos sat at "uploading" with nobody sending on 2026-09-21; one had 809 MB here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openDb } = require('../lib/db');
const { createAuth } = require('../lib/auth');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer(t, { before } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
  const db = openDb(root);
  const auth = createAuth(db);
  auth.addUser('owner@test.local', 'owner-password');
  auth.setRole('owner@test.local', 'admin');
  const token = auth.login('owner@test.local', 'owner-password', 'bearer').token;
  if (before) before({ db, root, userId: db.get('SELECT id FROM users LIMIT 1').id });
  db.close();
  const port = await freePort();
  const env = {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: root, BASE_URL: `http://127.0.0.1:${port}`, SIGNUP_MODE: 'closed', UPLOAD_IDLE_MS: '400',
    // explicit, so the repo's .env can never supply real ones to this server
    TENCENT_APPID: '1000000000', TENCENT_SECRET_ID: 'AKIDthrowawaytestkeynotreal00000000', TENCENT_SECRET_KEY: 'throwawaytestsecretnotreal000000', TOKENHUB_API_KEY: '', REQUEST_WEBHOOK_URL: '',
  };
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  t.after(async () => { proc.kill(); await sleep(100); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  const api = (p, method = 'GET', body) => fetch(`${base}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const create = async (size = 5e6) => (await api('/api/jobs', 'POST', { filename: 'talk.mp4', size, sourceLang: 'yue', targetLang: 'zh' })).json();
  const job = async (id) => (await api(`/api/jobs/${id}`)).json();
  /** Begin a PUT and send `first`; the caller decides what happens to the rest of the file. */
  const beginUpload = (id, first, offset = 0) => new Promise((resolve) => {
    const req = http.request(`${base}/api/jobs/${id}/upload${offset ? `?offset=${offset}` : ''}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' } });
    req.on('error', () => {});
    req.write(first, () => resolve(req));
  });
  const until = async (fn, what) => { for (let i = 0; i < 60; i++) { const v = await fn(); if (v) return v; await sleep(50); } throw new Error(`never happened: ${what}\n${out}`); };
  /** Send the rest and read the server's answer. */
  const finish = (req, last) => new Promise((resolve) => { req.on('response', (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(b) })); }); req.end(last); });
  return { base, root, api, create, job, beginUpload, finish, until, log: () => out };
}
const parts = (root, id) => (fs.existsSync(path.join(root, 'jobs', id)) ? fs.readdirSync(path.join(root, 'jobs', id)) : []).filter((f) => f.endsWith('.part'));

const A = Buffer.alloc(256 * 1024, 1);
const B = Buffer.alloc(100 * 1024, 2);

test('an upload cut off on the way keeps what arrived, and the rest carries on from there', async (t) => {
  const s = await startServer(t);
  const j = await s.create(A.length + B.length);
  assert.equal(j.status, 'uploading');
  const req = await s.beginUpload(j.id, A);
  await s.until(async () => (await s.job(j.id)).received === A.length, 'the first piece');
  assert.equal((await s.job(j.id)).receiving, true);
  req.destroy();
  const waiting = await s.until(async () => { const x = await s.job(j.id); return !x.receiving && x; }, 'the server seeing the connection go');
  assert.equal(waiting.status, 'uploading', 'not failed: its sender can come back');
  assert.equal(waiting.received, A.length);

  const wrong = await s.finish(await s.beginUpload(j.id, B, 1234), Buffer.alloc(0));
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.code, 'upload_offset');
  assert.equal(wrong.body.received, A.length, 'the answer says where to carry on from');

  const res = await s.finish(await s.beginUpload(j.id, B, A.length), Buffer.alloc(0));
  assert.equal(res.status, 200);
  assert.equal(res.body.size, A.length + B.length);
  assert.notEqual(res.body.status, 'uploading');
  assert.deepEqual(parts(s.root, j.id), []);
  assert.deepEqual(fs.readFileSync(path.join(s.root, 'jobs', j.id, 'source.mp4')), Buffer.concat([A, B]), 'the two pieces are the file');
});

test('a sender that goes quiet loses the connection, not the file', async (t) => {
  const s = await startServer(t);
  const j = await s.create();
  const req = await s.beginUpload(j.id, B); // and then nothing, with the connection open
  t.after(() => req.destroy());
  await s.until(async () => (await s.job(j.id)).receiving, 'the upload beginning');
  const after = await s.until(async () => { const x = await s.job(j.id); return !x.receiving && x; }, 'the connection being closed');
  assert.equal(after.status, 'uploading');
  assert.equal(after.received, B.length);
});

test('a sender back on a new connection takes the file over from the old one', async (t) => {
  const s = await startServer(t);
  const j = await s.create(A.length + B.length);
  const old = await s.beginUpload(j.id, A); // still open as far as the server knows
  t.after(() => old.destroy());
  await s.until(async () => (await s.job(j.id)).received === A.length, 'the first piece');
  const res = await s.finish(await s.beginUpload(j.id, B, A.length), Buffer.alloc(0));
  assert.equal(res.status, 200);
  assert.deepEqual(fs.readFileSync(path.join(s.root, 'jobs', j.id, 'source.mp4')), Buffer.concat([A, B]));
});

test('pieces that do not add up to the file fail the job', async (t) => {
  const s = await startServer(t);
  const j = await s.create(A.length + B.length + 7);
  const req = await s.beginUpload(j.id, A);
  await s.until(async () => (await s.job(j.id)).received === A.length, 'the first piece');
  req.destroy();
  await s.until(async () => !(await s.job(j.id)).receiving, 'the connection going');
  const res = await s.finish(await s.beginUpload(j.id, B, A.length), Buffer.alloc(0));
  assert.equal(res.status, 500);
  const after = await s.job(j.id);
  assert.equal(after.status, 'failed');
  assert.match(after.error, /^upload does not match the file/);
  assert.deepEqual(parts(s.root, j.id), []);
});

test('a job can be deleted while its file is arriving', async (t) => {
  const s = await startServer(t);
  const j = await s.create();
  const req = await s.beginUpload(j.id, B);
  t.after(() => req.destroy());
  await s.until(() => parts(s.root, j.id).length, 'the partial file');
  assert.equal((await s.api(`/api/jobs/${j.id}`, 'DELETE')).status, 200);
  assert.equal((await s.api(`/api/jobs/${j.id}`)).status, 404);
  assert.equal(fs.existsSync(path.join(s.root, 'jobs', j.id)), false);
  await sleep(600); // past the idle limit: the upload that is gone must not bring the server down
  assert.equal((await fetch(`${s.base}/healthz`)).ok, true);
  assert.doesNotMatch(s.log(), /uncaught/);
});

test('a whole upload is queued', async (t) => {
  const s = await startServer(t);
  const j = await s.create();
  const res = await s.finish(await s.beginUpload(j.id, B), Buffer.alloc(1024, 2));
  assert.equal(res.status, 200);
  assert.equal(res.body.size, B.length + 1024);
  assert.notEqual(res.body.status, 'uploading');
  assert.equal(res.body.received, undefined);
  assert.deepEqual(parts(s.root, j.id), []);
});

test('a new server keeps the upload the last one was receiving, and drops one nobody came back to', async (t) => {
  const ids = { fresh: 'abcdef0123456789', stale: 'fedcba9876543210' };
  const s = await startServer(t, { before: ({ db, root, userId }) => {
    for (const [id, age] of [[ids.fresh, 60_000], [ids.stale, 25 * 3600_000]]) {
      db.run('INSERT INTO jobs(id, user_id, filename, size, source_lang, target_lang, engine, status, media_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        id, userId, 'talk.mp4', A.length + B.length, 'yue', 'zh', '16k_zh_large', 'uploading', id.repeat(2), Date.now() - age, Date.now() - age);
      fs.mkdirSync(path.join(root, 'jobs', id), { recursive: true });
      fs.writeFileSync(path.join(root, 'jobs', id, 'source.mp4.part'), A);
    }
  } });
  const stale = await s.job(ids.stale);
  assert.equal(stale.status, 'failed');
  assert.equal(stale.error, 'upload never completed');
  assert.deepEqual(parts(s.root, ids.stale), []);
  const fresh = await s.job(ids.fresh);
  assert.equal(fresh.status, 'uploading');
  assert.equal(fresh.received, A.length);
  assert.equal(fresh.receiving, false);
  const res = await s.finish(await s.beginUpload(ids.fresh, B, A.length), Buffer.alloc(0));
  assert.equal(res.status, 200);
  assert.deepEqual(fs.readFileSync(path.join(s.root, 'jobs', ids.fresh, 'source.mp4')), Buffer.concat([A, B]));
});

test('a request may take longer than five minutes', () => {
  // Node ends any request still arriving after server.requestTimeout (300 s unless set), and nothing short of a
  // five-minute test would show it: so this reads the line that lifts it.
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /^server\.requestTimeout = 0;$/m);
});
