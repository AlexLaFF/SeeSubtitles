'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openDb } = require('../lib/db');
const { createAuth } = require('../lib/auth');

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const code = (identity) => Buffer.from(JSON.stringify(identity)).toString('base64url');
const post = (base, route, body, token) => fetch(`${base}${route}`, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const appleCallback = (base, state, identity) => fetch(`${base}/api/apple/callback`, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ state, code: code(identity) }) });

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-routes-'));
  const db = openDb(root);
  const auth = createAuth(db);
  const known = auth.addUser('known@example.com', 'known-password');
  const different = auth.addUser('different@example.com', 'different-password');
  const knownToken = auth.login(known.email, 'known-password', 'bearer').token;
  const differentToken = auth.login(different.email, 'different-password', 'bearer').token;
  db.close();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: root,
    BASE_URL: 'https://seesubtitles.test', SIGNUP_MODE: 'closed',
    APPLE_SIGNIN_TEAM_ID: 'TESTTEAM', APPLE_SIGNIN_KEY_ID: 'TESTKEY',
    APPLE_SIGNIN_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    APPLE_SIGNIN_WEB_CLIENT_ID: 'test.web', APPLE_SIGNIN_IOS_CLIENT_ID: 'test.ios',
    TENCENT_APPID: '1000000000', TENCENT_SECRET_ID: 'AKIDthrowawaytestkeynotreal00000000',
    TENCENT_SECRET_KEY: 'throwawaytestsecretnotreal000000', TOKENHUB_API_KEY: '', REQUEST_WEBHOOK_URL: '' };
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures', 'apple-fetch.js'), path.join(__dirname, '..', 'server.js')],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  return { base, known, different, knownToken, differentToken };
}

test('Apple web and iOS login admit known accounts, preserve password login, and reject unknown accounts', async (t) => {
  const { base, known, knownToken } = await fixture(t);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).apple, true);
  const start = await fetch(`${base}/api/apple/start`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const authorization = new URL(start.headers.get('location'));
  const state = authorization.searchParams.get('state');
  const nonce = authorization.searchParams.get('nonce');
  const callback = await appleCallback(base, state, { sub: 'known-apple', email: known.email, emailVerified: true, nonce });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/');
  const cookie = callback.headers.get('set-cookie').split(';')[0];
  const me = await fetch(`${base}/api/me`, { headers: { cookie } });
  assert.equal((await me.json()).user.email, known.email);
  const native = await post(base, '/api/apple/native', { code: code({ sub: 'known-apple', email: 'changed@example.org', nonce: 'native-nonce' }), nonce: 'native-nonce' });
  assert.equal(native.status, 200);
  assert.equal((await native.json()).user.id, known.id);
  assert.equal((await post(base, '/api/login', { email: known.email, password: 'known-password', kind: 'bearer' })).status, 200);
  assert.equal((await fetch(`${base}/api/apple/status`, { headers: { authorization: `Bearer ${knownToken}` } }).then((r) => r.json())).linked, true);
  const unknown = await post(base, '/api/apple/native', { code: code({ sub: 'stranger', email: 'stranger@example.org', emailVerified: true, nonce: 'other' }), nonce: 'other' });
  assert.equal(unknown.status, 403);
  assert.equal((await unknown.json()).code, 'apple_unknown');
  assert.equal((await post(base, '/api/signup', { email: 'stranger@example.org', password: 'password123' })).status, 403);
});

test('a password account links a different Apple email, then both methods work on website and Mac', async (t) => {
  const { base, different, differentToken } = await fixture(t);
  const wrong = await post(base, '/api/apple/start-link', { password: 'wrong' }, differentToken);
  assert.equal(wrong.status, 403);
  const started = await post(base, '/api/apple/start-link', { password: 'different-password' }, differentToken);
  assert.equal(started.status, 200);
  const authorization = new URL((await started.json()).url);
  const linked = await appleCallback(base, authorization.searchParams.get('state'),
    { sub: 'different-apple', email: 'another@icloud.com', emailVerified: true, nonce: authorization.searchParams.get('nonce') });
  assert.equal(linked.headers.get('location'), '/account?apple=linked');
  assert.equal((await fetch(`${base}/api/apple/status`, { headers: { authorization: `Bearer ${differentToken}` } }).then((r) => r.json())).linked, true);
  const native = await post(base, '/api/apple/native', { code: code({ sub: 'different-apple', email: 'another@icloud.com', nonce: 'ios-nonce' }), nonce: 'ios-nonce' });
  assert.equal((await native.json()).user.id, different.id);
  assert.equal((await post(base, '/api/login', { email: different.email, password: 'different-password', kind: 'bearer' })).status, 200);

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const desktopStart = await post(base, '/api/apple/desktop/start', { challenge });
  assert.equal(desktopStart.status, 200);
  const { url, state } = await desktopStart.json();
  const desktopAuth = new URL(url);
  const desktopCallback = await appleCallback(base, state,
    { sub: 'different-apple', email: 'another@icloud.com', nonce: desktopAuth.searchParams.get('nonce') });
  const deeplink = new URL(desktopCallback.headers.get('location'));
  assert.equal(deeplink.protocol, 'seesubtitles:');
  assert.equal((await post(base, '/api/apple/desktop/claim', { ticket: deeplink.searchParams.get('ticket'), state, verifier: 'wrong' })).status, 401);
  const claimed = await post(base, '/api/apple/desktop/claim', { ticket: deeplink.searchParams.get('ticket'), state, verifier });
  assert.equal(claimed.status, 200);
  assert.equal((await claimed.json()).user.id, different.id);
  assert.equal((await post(base, '/api/apple/desktop/claim', { ticket: deeplink.searchParams.get('ticket'), state, verifier })).status, 401);
});
