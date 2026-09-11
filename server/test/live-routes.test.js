'use strict';
// The routes as the running server enforces them: the real server.js, a throwaway database and throwaway keys.
// A connection straight to Tencent is one the server cannot count, so it signs one only for an account it trusts
// (directLive — administrators); everyone else is refused with not_trusted and goes through the relay, which is
// open to every account. No key leaves the server for anyone: the old handout is gone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { openDb } = require('../lib/db');
const { createAuth } = require('../lib/auth');

const TEST_ID = 'AKIDthrowawaytestkeynotreal00000000';
const TEST_KEY = 'throwawaytestsecretnotreal000000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-routes-'));
  const db = openDb(root);
  const auth = createAuth(db);
  auth.addUser('owner@test.local', 'owner-password');
  auth.setRole('owner@test.local', 'admin');
  auth.addUser('member@test.local', 'member-password');
  const tokens = {
    owner: auth.login('owner@test.local', 'owner-password', 'bearer').token,
    member: auth.login('member@test.local', 'member-password', 'bearer').token,
  };
  db.close();
  const port = await freePort();
  const env = {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: root, BASE_URL: `http://127.0.0.1:${port}`, SIGNUP_MODE: 'closed',
    // explicit, so the repo's .env can never supply real ones to this server
    TENCENT_APPID: '1000000000', TENCENT_SECRET_ID: TEST_ID, TENCENT_SECRET_KEY: TEST_KEY, TOKENHUB_API_KEY: '', REQUEST_WEBHOOK_URL: '',
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
  return { base, port, tokens, log: () => out };
}

const askSigned = (base, token) => fetch(`${base}/api/desktop/live-url`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ source: 'yue', target: 'zh', count: 2 }),
});

test('only the account the server trusts is signed a direct connection, and it carries no key', async (t) => {
  const s = await startServer(t);
  const owner = await askSigned(s.base, s.tokens.owner);
  assert.equal(owner.status, 200, 'the owner is signed connections');
  const { urls } = await owner.json();
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.url.startsWith('wss://')));
  assert.ok(urls.every((u) => !u.url.includes(TEST_KEY)), 'the secret key is never in a signed URL');
  assert.ok(urls.every((u) => u.url.includes(`secretid=${TEST_ID}`)), 'and it was signed with the throwaway keys, not real ones');

  const member = await askSigned(s.base, s.tokens.member);
  assert.equal(member.status, 403, 'an ordinary account is refused');
  assert.equal((await member.json()).code, 'not_trusted');

  const stranger = await askSigned(s.base, 'not-a-token');
  assert.equal(stranger.status, 401);
});

test('the key handout is gone, even for the owner', async (t) => {
  const s = await startServer(t);
  const r = await fetch(`${s.base}/api/desktop/credentials`, { headers: { authorization: `Bearer ${s.tokens.owner}` } });
  assert.notEqual(r.status, 200);
  assert.ok(!(await r.text()).includes(TEST_KEY));
});

test('every account may use the relay; a stranger may not', async (t) => {
  const s = await startServer(t);
  const open = (token) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/desktop/live?source=yue&target=zh`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const done = (r) => { try { ws.terminate(); } catch { /* gone */ } resolve(r); };
    ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'ready') done('ready'); });
    ws.on('unexpected-response', (_q, res) => done(`HTTP ${res.statusCode}`));
    ws.on('error', () => done('error'));
    setTimeout(() => done('timeout'), 5000);
  });
  assert.equal(await open(s.tokens.member), 'ready', 'an ordinary account is let onto the relay');
  assert.equal(await open(null), 'HTTP 401');
});
