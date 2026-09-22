'use strict';
// /api/summaries: a recording's cues in, Markdown out as it is written — what the iOS app summarises with. The
// model is a stand-in speaking TokenHub's Anthropic-compatible stream, so the test sees exactly what was asked
// of it: the shared prompt (core/summary.js), the server's key and never the account's token.
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
const { summarise, cleanCues, SummaryError } = require('../lib/summaries');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

/** A stand-in for TokenHub's /v1/messages. `answers` are the texts it gives, in order; it keeps what it was asked. */
async function fakeModel(t, answers) {
  const asked = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      asked.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
      const text = answers[Math.min(asked.length - 1, answers.length - 1)];
      if (text instanceof Error) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: text.message } })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
      ev({ type: 'message_start', message: { model: 'stand-in-1', usage: { input_tokens: 1234 } } });
      ev({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '…' } });
      // split mid-character boundaries are the transport's business; split mid-text here
      const half = Math.ceil(text.length / 2);
      ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(0, half) } });
      ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(half) } });
      ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 321 } });
      ev({ type: 'message_stop' });
      res.end();
    });
  });
  const port = await freePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  t.after(() => server.close());
  return { baseUrl: `http://127.0.0.1:${port}`, asked };
}

const CUES = {
  name: '9月5号14点33分',
  language: 'zh',
  target: [{ start: 1000, end: 3500, text: '大家好' }, { start: 61000, end: 64000, text: '今天讲三件事' }],
  source: [{ start: 1000, end: 3500, text: '大家好呀' }, { start: 61000, end: 64000, text: '今日讲三件事' }],
};
const GOOD = '# 《三件事》\n## 一段话\n今天只讲三件事。\n## 要点\n### 先讲前提\n- **三件事**是全部内容 [01:01]\n- 这一条的时间不存在 [59:59]';

test('a summary is asked with the shared prompt and the server key, streams, and loses invented timestamps', async (t) => {
  const model = await fakeModel(t, [GOOD]);
  const stages = [];
  let streamed = '';
  const out = await summarise(CUES, { key: 'server-key', baseUrl: model.baseUrl, onStage: (s) => stages.push(s), onDelta: (d) => { streamed += d; } });
  assert.deepEqual(stages, ['asking', 'thinking', 'writing']);
  assert.equal(streamed, GOOD);
  assert.equal(model.asked.length, 1);
  const asked = model.asked[0];
  assert.equal(asked.path, '/v1/messages');
  assert.equal(asked.auth, 'Bearer server-key');
  assert.equal(asked.body.stream, true);
  assert.equal(asked.body.model, 'deepseek-v4-flash');
  assert.deepEqual(asked.body.thinking, { type: 'enabled', budget_tokens: 16000 });
  assert.ok(asked.body.system.includes('综合而不是罗列'));
  assert.ok(asked.body.messages[0].content.includes('[00:01] 大家好\n    （原文：大家好呀）\n[01:01] 今天讲三件事'));
  assert.ok(out.markdown.startsWith('<!-- recording: 9月5号14点33分 · model: stand-in-1'));
  assert.ok(out.markdown.includes('[01:01]'));
  assert.ok(!out.markdown.includes('[59:59]'), 'a timestamp beyond the recording is dropped');
  assert.deepEqual(out.meta.usage, { input: 1234, output: 321 });
  assert.equal(out.meta.condensed, false);
});

test('a client may name a listed model and an effort; anything else gets the defaults', async (t) => {
  const model = await fakeModel(t, [GOOD, GOOD]);
  await summarise({ ...CUES, model: 'kimi-k3', effort: 'low' }, { key: 'k', baseUrl: model.baseUrl });
  assert.equal(model.asked[0].body.model, 'kimi-k3');
  assert.deepEqual(model.asked[0].body.thinking, { type: 'disabled' });
  await summarise({ ...CUES, model: 'gpt-9', effort: 'maximum' }, { key: 'k', baseUrl: model.baseUrl, model: 'minimax-m3', effort: 'medium' });
  assert.equal(model.asked[1].body.model, 'minimax-m3', 'a model not on the list is ignored, not sent');
  assert.deepEqual(model.asked[1].body.thinking, { type: 'enabled', budget_tokens: 6000 });
});

test('a summary over its cap is condensed once, without the transcript', async (t) => {
  const long = `# 《长》\n${'这是一句很长的话。'.repeat(80)}`; // 640 counted characters against a cap of 450
  const model = await fakeModel(t, [long, '# 《短》\n## 一段话\n短。']);
  const stages = [];
  const out = await summarise(CUES, { key: 'k', baseUrl: model.baseUrl, onStage: (s) => stages.push(s) });
  assert.deepEqual(stages, ['asking', 'thinking', 'writing', 'condensing']);
  assert.equal(model.asked.length, 2);
  assert.ok(!model.asked[1].body.messages[0].content.includes('<transcript>'));
  assert.ok(model.asked[1].body.messages[0].content.includes('压缩到 450 字以内'));
  assert.ok(out.markdown.includes('《短》'));
  assert.equal(out.meta.condensed, true);
  assert.deepEqual(out.meta.usage, { input: 2468, output: 642 });
});

test('cues are checked before anything is sent, and a refusal upstream is an error with a code', async (t) => {
  assert.throws(() => cleanCues('nope', 'target'), (e) => e instanceof SummaryError && e.code === 'bad_cues');
  assert.throws(() => cleanCues([{ start: 5, end: 1, text: 'x' }], 'target'), /usable times/);
  assert.deepEqual(cleanCues([{ start: 9.6, end: 20, text: '  b \n c ' }, { start: 1, end: 2, text: '' }, { start: 0, end: 1, text: 'a' }], 'target'),
    [{ start: 0, end: 1, text: 'a' }, { start: 10, end: 20, text: 'b c' }]);
  const model = await fakeModel(t, [new Error('rate limited')]);
  await assert.rejects(summarise({ target: [] }, { key: 'k', baseUrl: model.baseUrl }), (e) => e.code === 'no_cues');
  assert.equal(model.asked.length, 0);
  await assert.rejects(summarise(CUES, { key: 'k', baseUrl: model.baseUrl }), (e) => e.code === 'summary_refused' && /429: rate limited/.test(e.message));
  await assert.rejects(summarise(CUES, { key: '' }), (e) => e.code === 'no_key' && e.status === 503);
});

// ---- the route, on the real server
async function startServer(t, env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'summaries-'));
  const db = openDb(root);
  const auth = createAuth(db);
  auth.addUser('owner@test.local', 'owner-password');
  auth.setRole('owner@test.local', 'admin');
  auth.addUser('member@test.local', 'member-password'); // Hobbyist: no summaries
  const tokens = { owner: auth.login('owner@test.local', 'owner-password', 'bearer').token, member: auth.login('member@test.local', 'member-password', 'bearer').token };
  db.close();
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: root, BASE_URL: `http://127.0.0.1:${port}`, SIGNUP_MODE: 'closed',
      TENCENT_APPID: '1000000000', TENCENT_SECRET_ID: 'AKIDthrowawaytestkeynotreal00000000', TENCENT_SECRET_KEY: 'throwawaytestsecretnotreal000000', TOKENHUB_API_KEY: '', REQUEST_WEBHOOK_URL: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { proc.kill(); await sleep(100); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ } await sleep(100); }
  return { base, tokens };
}
const post = (base, token, body) => fetch(`${base}/api/summaries`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** Server-sent events → [{event, data}] */
const events = (text) => text.split('\n\n').map((b) => { const e = /^event: (.+)$/m.exec(b); const d = /^data: (.+)$/m.exec(b); return e && d ? { event: e[1], data: JSON.parse(d[1]) } : null; }).filter(Boolean);

test('/api/summaries streams stages, the text and the finished Markdown; the plan and the login gate it', async (t) => {
  const model = await fakeModel(t, [GOOD]);
  const { base, tokens } = await startServer(t, { TOKENHUB_API_KEY: 'server-side-key', TOKENHUB_BASE_URL: model.baseUrl, SUMMARY_MODEL: 'kimi-k2', SUMMARY_EFFORT: 'low' });

  assert.equal((await fetch(`${base}/api/summaries`, { method: 'POST', body: '{}' })).status, 401);
  const refused = await post(base, tokens.member, CUES);
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).code, 'plan_summaries');
  assert.equal(model.asked.length, 0);

  const res = await post(base, tokens.owner, CUES);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const evs = events(await res.text());
  assert.deepEqual(evs.filter((e) => e.event === 'stage').map((e) => e.data.stage), ['asking', 'thinking', 'writing']);
  assert.equal(evs.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''), GOOD);
  const done = evs.find((e) => e.event === 'done');
  assert.ok(done.data.markdown.includes('## 要点'));
  assert.equal(done.data.meta.model, 'stand-in-1');
  assert.equal(model.asked[0].auth, 'Bearer server-side-key', 'the model sees the server key, never the account token');
  assert.equal(model.asked[0].body.model, 'kimi-k2');
  assert.deepEqual(model.asked[0].body.thinking, { type: 'disabled' });

  const bad = events(await (await post(base, tokens.owner, { target: [] })).text());
  assert.deepEqual(bad.map((e) => e.event), ['error']);
  assert.equal(bad[0].data.code, 'no_cues');
});

test('/api/summaries without a TokenHub key says so; the universal-link file names the app and the share links', async (t) => {
  const { base, tokens } = await startServer(t);
  const res = await post(base, tokens.owner, CUES);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'no_key');

  const aasa = await fetch(`${base}/.well-known/apple-app-site-association`);
  assert.equal(aasa.status, 200);
  assert.match(aasa.headers.get('content-type'), /application\/json/);
  const details = (await aasa.json()).applinks.details[0];
  assert.deepEqual(details.appIDs, ['6DZ5Z54SPQ.com.algernonlabs.seesubtitles']);
  assert.deepEqual(details.components.map((c) => c['/']), ['/d/*']);
});
