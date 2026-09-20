// The phone's end-to-end tests run against the real server (server/server.js), started here on this Mac with a
// throwaway database — and, in place of Tencent and TokenHub, stand-ins that speak the same protocols. So the relay,
// the accounts, the plans, the metering, the summaries endpoint and the share sessions are the real code, and a run
// needs no keys and costs nothing. (The Mac's release test, `npm run e2e`, is the one that spends real Tencent time;
// `run.mjs --real` points this suite at a real server the same way.)
//
// Three parts:
//   stand-ins   recognition over WebSocket (实时语音识别's messages), TokenHub's translations and messages endpoints
//   the server  its own port and data directory; accounts made straight in its database, as the server's tests do
//   control     a small HTTP server the tests ask for what only the operator's side can do: an account's current
//               two-factor code, spending a plan's hours, a Mac hosting a talk, what the recogniser was asked for
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { WebSocketServer } = require(path.join(ROOT, 'node_modules', 'ws'));
const { openDb } = require(path.join(ROOT, 'server', 'lib', 'db.js'));
const { createAuth } = require(path.join(ROOT, 'server', 'lib', 'auth.js'));
const totp = require(path.join(ROOT, 'server', 'lib', 'totp.js'));

// Keys that open nothing. The tests look for them in everything the app receives and writes: a key, even a
// stand-in's, must never reach the phone.
export const SECRETS = { TENCENT_SECRET_ID: 'AKIDe2estandinnotarealkey0000000000', TENCENT_SECRET_KEY: 'e2eStandInSecretKeyNotReal000000', TOKENHUB_API_KEY: 'sk-e2e-standin-tokenhub-key' };
export const PASSWORD = 'correct horse battery';
export const ACCOUNTS = { owner: 'owner@e2e.test', business: 'business@e2e.test', hobby: 'hobby@e2e.test', spent: 'spent@e2e.test', secure: 'secure@e2e.test' };

/** What the room "says", and what it means. The recogniser recites the left column; the translator knows the right. */
export const TALK = [
  ['大家好，欢迎嚟到今日嘅分享。', '大家好，欢迎来到今天的分享。'],
  ['今日我哋会讲吓点样用字幕帮助更多人参与会议。', '今天我们会讲一下如何用字幕帮助更多人参与会议。'],
  ['首先系现场嘅观众，佢哋可以用手机扫二维码。', '首先是现场的观众，他们可以用手机扫二维码。'],
  ['第二，系会后想重温内容嘅人。', '第二，是会后想重温内容的人。'],
];
export const SUMMARY = '# 《用字幕让更多人参与会议》\n## 一段话\n字幕让**所有人同时跟上**。\n## 要点\n### 字幕服务的是整个房间\n- **现场观众**用手机扫码跟读 [00:02]\n- 这个时间并不存在 [59:59]';

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readBody = (req) => new Promise((res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { res({}); } }); });

/** 实时语音识别, as far as core/split-stream.js can tell: a sentence for every second of audio, drafts on the way. */
async function recogniser() {
  const port = await freePort();
  const state = { connections: [], audioBytes: 0 };
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    state.connections.push({ at: Date.now(), query: Object.fromEntries(url.searchParams) });
    ws.send(JSON.stringify({ code: 0, message: 'success', voice_id: 'e2e' }));
    let chunks = 0; let index = 0;
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      state.audioBytes += data.length;
      chunks++;
      const text = TALK[index % TALK.length][0];
      const at = chunks % 5; // five 200 ms chunks a sentence
      const result = (slice, upTo) => ws.send(JSON.stringify({ code: 0, message: 'success', voice_id: 'e2e',
        result: { slice_type: slice, index, start_time: index * 1000, end_time: index * 1000 + (at || 5) * 200, voice_text_str: text.slice(0, upTo) } }));
      if (at === 2) result(1, Math.ceil(text.length / 3));
      else if (at === 4) result(1, Math.ceil((text.length * 2) / 3));
      else if (at === 0) { result(2, text.length); index++; }
    });
  });
  return { url: `ws://127.0.0.1:${port}`, state, close: () => wss.close() };
}

/** TokenHub: translations by looking the sentence up, and a summary streamed the way the Anthropic-compatible endpoint streams. */
async function tokenhub() {
  const port = await freePort();
  const state = { translations: 0, messages: [], auth: new Set() };
  const server = http.createServer(async (req, res) => {
    state.auth.add(req.headers.authorization || '');
    const body = await readBody(req);
    if (req.url === '/v1/api/translations') {
      state.translations++;
      const known = TALK.find(([source]) => source.startsWith(body.text) || body.text.startsWith(source.slice(0, Math.max(1, body.text.length))));
      const out = known ? known[1].slice(0, Math.max(1, Math.round((known[1].length * body.text.length) / known[0].length))) : `[${body.target}] ${body.text}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: TALK.some(([s]) => s === body.text) ? known[1] : out }, finish_reason: 'stop' }] }));
    }
    if (req.url === '/v1/messages') {
      state.messages.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
      ev({ type: 'message_start', message: { model: 'stand-in', usage: { input_tokens: 100 } } });
      ev({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '…' } });
      for (const part of SUMMARY.match(/[\s\S]{1,24}/g)) { ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: part } }); await sleep(15); }
      ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } });
      return res.end();
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}`, state, close: () => server.close() };
}

/** Start everything. Resolves with the addresses and a `close()`. */
export async function start({ log = () => {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-e2e-'));
  const asr = await recogniser();
  const hub = await tokenhub();

  // accounts, made the way the server's own tests make them
  const db = openDb(root);
  const auth = createAuth(db);
  for (const email of Object.values(ACCOUNTS)) auth.addUser(email, PASSWORD);
  auth.setRole(ACCOUNTS.owner, 'admin');
  db.run("UPDATE users SET plan = 'business' WHERE email IN (?, ?)", ACCOUNTS.business, ACCOUNTS.secure);
  const id = (email) => db.get('SELECT id FROM users WHERE email = ?', email).id;
  // a Hobbyist whose ten live hours are gone
  db.run('INSERT INTO usage(user_id, month, live_seconds, file_seconds) VALUES (?,?,?,0)', id(ACCOUNTS.spent), new Date().toISOString().slice(0, 7), 10 * 3600);
  // two-factor on, the way a person turns it on: begin, then confirm with a code from the secret
  const begun = auth.beginTotp(id(ACCOUNTS.secure));
  const secret = begun.secret;
  auth.confirmTotp(id(ACCOUNTS.secure), totp.codeFor(secret));
  db.close();

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: root, BASE_URL: base, SIGNUP_MODE: 'closed', REQUEST_WEBHOOK_URL: '',
      TENCENT_APPID: '1250000000', ...SECRETS, TENCENT_WS_URL: asr.url, TOKENHUB_BASE_URL: hub.url, LIVE_METER_MS: '1000', SUMMARY_EFFORT: 'low' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { output += d; }); proc.stderr.on('data', (d) => { output += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ } await sleep(100); }
  if (!/STAND-INS IN USE/.test(output)) throw new Error(`the server did not start with its stand-ins:\n${output}`);
  log(`server ${base} · recogniser ${asr.url} · tokenhub ${hub.url}`);

  // ---- control: what only the operator's side can do
  const api = async (token, method, p, body) => (await fetch(`${base}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  const hosts = new Map(); // code → { id, token }
  const control = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    try {
      if (url.pathname === '/totp') return send({ code: totp.codeFor(secret) });
      if (url.pathname === '/recogniser') return send({ connections: asr.state.connections, audioSeconds: asr.state.audioBytes / 32000 });
      if (url.pathname === '/tokenhub') return send({ translations: hub.state.translations, summaries: hub.state.messages.length, keysSeen: [...hub.state.auth], lastSummaryRequest: hub.state.messages.at(-1) || null });
      if (url.pathname === '/log') return send({ log: output });
      // A Mac hosting a talk: a share session opened by the Business account, with a first line already said.
      if (url.pathname === '/host/start') {
        const login = await (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ACCOUNTS.business, password: PASSWORD, kind: 'bearer', label: 'A Mac at the front of the room' }) })).json();
        const session = await api(login.token, 'POST', '/api/sessions', { name: body.name || '字幕与共融 讲座' });
        hosts.set(session.code, { id: session.id, token: login.token, n: 0 });
        await api(login.token, 'POST', `/api/sessions/${session.id}/events`, { events: [{ ev: 'settings', data: { settings: { source: 'yue', target: body.target || 'zh', showMode: 'both' } } }] });
        return send({ code: session.code, shareUrl: session.shareUrl });
      }
      if (url.pathname === '/host/say') { // the next sentence of the talk: a draft, then the settled line
        const h = hosts.get(body.code); const [source, target] = TALK[h.n % TALK.length]; const lineId = `mac:${h.n++}`; const now = Date.now();
        await api(h.token, 'POST', `/api/sessions/${h.id}/events`, { events: [{ ev: 'line', data: { id: lineId, sourceText: source.slice(0, 6), targetText: target.slice(0, 5), ended: false, wallStart: now - 1500 } }] });
        await sleep(150);
        await api(h.token, 'POST', `/api/sessions/${h.id}/events`, { events: [{ ev: 'line', data: { id: lineId, sourceText: source, targetText: target, ended: true, wallStart: now - 1500, wallEnd: now } }] });
        return send({ id: lineId, source, target });
      }
      if (url.pathname === '/host/end') { const h = hosts.get(body.code); await api(h.token, 'POST', `/api/sessions/${h.id}/end`); return send({ ok: true }); }
      res.writeHead(404); res.end('{}');
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
  });
  const controlPort = await freePort();
  await new Promise((r) => control.listen(controlPort, '127.0.0.1', r));

  return {
    base, control: `http://127.0.0.1:${controlPort}`, root, output: () => output,
    env: { E2E_SERVER: base, E2E_CONTROL: `http://127.0.0.1:${controlPort}`, E2E_PASSWORD: PASSWORD, E2E_SECRETS: Object.values(SECRETS).join(','),
      ...Object.fromEntries(Object.entries(ACCOUNTS).map(([k, v]) => [`E2E_${k.toUpperCase()}`, v])) },
    async close() { proc.kill(); control.close(); asr.close(); hub.close(); await sleep(150); fs.rmSync(root, { recursive: true, force: true }); },
  };
}

// node ios/e2e/harness.mjs — start it and leave it running, for poking at by hand or from Xcode
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h = await start({ log: console.log });
  console.log(Object.entries(h.env).map(([k, v]) => `${k}=${v}`).join('\n'));
  process.on('SIGINT', async () => { await h.close(); process.exit(0); });
}
