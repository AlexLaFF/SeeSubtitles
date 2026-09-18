'use strict';
// The split pipeline against a stand-in for 实时语音识别 and a stand-in for TokenHub: the frames it emits,
// the rolling translation, the context it passes, the retry, and that a late draft never overwrites a final.
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { SplitStream } = require('../split-stream');

const creds = { appid: '1250000000', secretId: 'AKIDtest', secretKey: 'sk' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (extra = {}) => JSON.stringify({ code: 0, message: 'success', ...extra });
const word = (index, text, { end = false, start_time = 0, end_time = 500 } = {}) =>
  ok({ result: { slice_type: end ? 2 : 1, index, start_time, end_time, voice_text_str: text } });

/** Stand-in for the recognition endpoint. */
function mockAsr(onConn) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => resolve({ url: `ws://127.0.0.1:${wss.address().port}`, conns, close }));
    const conns = [];
    wss.on('connection', (ws) => {
      const conn = { ws, chunks: 0 };
      conns.push(conn);
      ws.on('message', (data, isBinary) => { if (isBinary) conn.chunks++; });
      onConn(ws, conn);
    });
    function close() { for (const c of wss.clients) c.terminate(); wss.close(); }
  });
}

/** Stand-in for TokenHub. `reply(body)` returns either a string (the translation) or an {error} object. */
function mockTranslate(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const out = await reply(body, calls.length);
    if (out && out.error) return { ok: false, status: out.status || 500, json: async () => ({ error: { message: out.error } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: out } }] }) };
  };
  return { fetchImpl, calls };
}

async function withCleanup(m, s, fn) {
  try { await fn(); } finally { s.stop(); await sleep(100); m.close(); }
}

test('emits the words first, then the rolling translation, then the settled line', async () => {
  const m = await mockAsr((ws) => {
    ws.send(ok());
    setTimeout(() => ws.send(word(1, '今日講營養')), 40);
    setTimeout(() => ws.send(word(1, '今日講營養同肝臟', { end: true, end_time: 1500 })), 600);
  });
  const t = mockTranslate(async (b) => (b.text.length > 6 ? '今天讲营养和肝脏' : '今天讲营养'));
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl, rollMs: 100 });
  const results = [];
  s.on('result', (r) => results.push(r));
  await withCleanup(m, s, async () => {
    s.start();
    for (let i = 0; i < 8; i++) { s.push(Buffer.alloc(6400), { t0: Date.now() }); await sleep(60); }
    await sleep(500);
    assert.ok(results.length >= 3, `expected several frames, got ${results.length}`);
    const first = results[0];
    assert.equal(first.sourceText, '今日講營養');
    assert.equal(first.sentenceEnd, false);
    assert.equal(first.sentenceId, results[1].sentenceId, 'one sentence keeps one id');
    const final = results.at(-1);
    assert.equal(final.sentenceEnd, true);
    assert.equal(final.sourceText, '今日講營養同肝臟');
    assert.equal(final.targetText, '今天讲营养和肝脏');
    assert.equal(final.source, 'yue');
    assert.equal(final.target, 'zh');
    assert.ok(results.some((r) => r.targetText === '今天讲营养' && !r.sentenceEnd), 'the draft was shown while speaking');
  });
});

test('gives the translator the previous lines as context, on the same model', async () => {
  const m = await mockAsr((ws) => {
    ws.send(ok());
    setTimeout(() => ws.send(word(1, '第一句', { end: true })), 40);
    setTimeout(() => ws.send(word(2, '第二句', { end: true, start_time: 1600, end_time: 2000 })), 300);
  });
  const t = mockTranslate(async (b) => `译:${b.text}`);
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl, model: 'hy-mt2-pro', contextLines: 2 });
  await withCleanup(m, s, async () => {
    s.start();
    for (let i = 0; i < 6; i++) { s.push(Buffer.alloc(6400), { t0: Date.now() }); await sleep(50); }
    await sleep(300);
    assert.ok(t.calls.length >= 2, 'both sentences were translated');
    assert.equal(t.calls[0].context, undefined, 'the first line has nothing before it');
    assert.equal(t.calls.at(-1).context, '第一句', 'the second line is given the first');
    assert.ok(t.calls.every((c) => c.model === 'hy-mt2-pro'), 'draft and final use one model');
    assert.ok(!t.calls.some((c) => c.text === c.context), 'a line is never its own context');
  });
});

test('the draft is translated with the same context as the final, so settling barely changes it', async () => {
  const m = await mockAsr((ws) => {
    ws.send(ok());
    setTimeout(() => ws.send(word(1, '第一句', { end: true })), 40);
    setTimeout(() => ws.send(word(2, '第二句开头')), 300);
    setTimeout(() => ws.send(word(2, '第二句开头和结尾', { end: true, start_time: 1600, end_time: 2600 })), 700);
  });
  const t = mockTranslate(async (b) => `${b.context ? '有上文:' : '无上文:'}${b.text}`);
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl, rollMs: 100, contextLines: 2 });
  await withCleanup(m, s, async () => {
    s.start();
    for (let i = 0; i < 10; i++) { s.push(Buffer.alloc(6400), { t0: Date.now() }); await sleep(60); }
    await sleep(400);
    const second = t.calls.filter((c) => c.text.startsWith('第二句'));
    assert.ok(second.length >= 2, 'the second line was drafted and settled');
    assert.ok(second.every((c) => c.context === '第一句'), 'draft and final were given the same context');
  });
});

test('retries a failed final once, and keeps the draft when translation is down', async () => {
  const m = await mockAsr((ws) => {
    ws.send(ok());
    setTimeout(() => ws.send(word(1, '一句話', { end: true })), 40);
  });
  let n = 0;
  const t = mockTranslate(async () => { n += 1; return n === 1 ? { error: 'HTTP 500' } : '一句话'; });
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl });
  const results = [];
  s.on('result', (r) => results.push(r));
  await withCleanup(m, s, async () => {
    s.start();
    for (let i = 0; i < 4; i++) { s.push(Buffer.alloc(6400), { t0: Date.now() }); await sleep(50); }
    await sleep(300);
    assert.equal(t.calls.length, 2, 'the failed final was tried again');
    assert.equal(results.at(-1).targetText, '一句话');
    assert.equal(s.status.translateRetries, 1);
  });
});

test('a model the account may not use is stepped down from once, even with drafts in flight', async () => {
  const m = await mockAsr((ws) => {
    ws.send(ok());
    setTimeout(() => ws.send(word(1, '一二三四五')), 40);
    setTimeout(() => ws.send(word(1, '一二三四五六七')), 120);
    setTimeout(() => ws.send(word(1, '一二三四五六七八九', { end: true, end_time: 900 })), 220);
  });
  // pro answers the way TokenHub did once its free trial ran out; plus translates
  const t = mockTranslate(async (b) => (b.model === 'hy-mt2-pro'
    ? { status: 402, error: 'The free trial quota for the service has been exhausted and postpaid billing is not enabled' }
    : `plus:${b.text}`));
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl, rollMs: 50 });
  const results = [];
  s.on('result', (r) => results.push(r));
  await withCleanup(m, s, async () => {
    s.start();
    for (let i = 0; i < 6; i++) { s.push(Buffer.alloc(6400), { t0: Date.now() }); await sleep(60); }
    await sleep(300);
    assert.equal(results.at(-1).targetText, 'plus:一二三四五六七八九', 'the line still came back translated');
    assert.equal(s.status.model, 'hy-mt2-plus', 'it stepped down one model, not past plus to lite');
    assert.deepEqual([s.status.modelFallback.from, s.status.modelFallback.to], ['hy-mt2-pro', 'hy-mt2-plus']);
    assert.ok(!t.calls.some((c) => c.model === 'hy-mt2-lite'), 'lite was never asked');
  });
});

test('reports a recognition error and keeps the engine and model in its status', async () => {
  const m = await mockAsr((ws) => { ws.send(JSON.stringify({ code: 4001, message: '参数不合法' })); });
  const t = mockTranslate(async () => 'x');
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl, source: 'ja' });
  const errors = [];
  s.on('server-error', (e) => errors.push(e));
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(200);
    assert.equal(errors[0].code, 4001);
    assert.equal(s.status.engine, '16k_ja', 'the engine follows the spoken language');
    assert.equal(s.status.model, 'hy-mt2-pro');
  });
});

test('drops audio rather than growing a backlog while disconnected', async () => {
  const m = await mockAsr(() => { /* never answers, so nothing is ever ready */ });
  const t = mockTranslate(async () => 'x');
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl });
  await withCleanup(m, s, async () => {
    s.start();
    for (let i = 0; i < 40; i++) s.push(Buffer.alloc(6400), { t0: Date.now() });
    assert.ok(s.queue.length <= 5, `queue stayed short, was ${s.queue.length}`);
    assert.ok(s.status.droppedBytes > 0, 'the audio it could not send was counted');
  });
});

test('reaches Tencent through the mainland edge, and goes the ordinary way only after it fails three times running', async () => {
  const asked = [];
  const s = new SplitStream(creds, { tokenhubKey: 'k', edge: 'cn', resolveEdge: async (o) => { asked.push(o); return '106.55.89.122'; } });
  const logs = [];
  s.on('log', (t) => logs.push(t));
  assert.equal(await s._edgeIp(), '106.55.89.122');
  assert.equal(s.status.edge, 'mainland 106.55.89.122');
  assert.equal(await s._edgeIp(), '106.55.89.122');
  assert.equal(asked.length, 1, 'the edge is looked up once, not per connection');

  for (let i = 0; i < 3; i++) { s._edgeFailed('106.55.89.122'); if (i < 2) assert.equal(await s._edgeIp(), '106.55.89.122'); }
  assert.ok(asked.slice(1).every((o) => o.force), 'after a failure the edge is looked up afresh');
  assert.equal(await s._edgeIp(), null, 'the third failure in a row sends one attempt the ordinary way');
  assert.equal(s.status.edge, 'overseas');
  assert.ok(logs.some((t) => /跨境/.test(t)), 'and says it will be billed 跨境');
  s._edgeFailed('106.55.89.122');
  assert.equal(await s._edgeIp(), '106.55.89.122', 'the attempt after that is mainland again');

  assert.equal(await new SplitStream(creds, { tokenhubKey: 'k', edge: 'auto' })._edgeIp(), null, "'auto' uses ordinary DNS");
  assert.equal(await new SplitStream(creds, { tokenhubKey: 'k', edge: 'cn', wsUrl: 'ws://127.0.0.1:1' })._edgeIp(), null, 'a stand-in is reached directly');
});

test("a line that meets pro's per-minute limit is translated by plus at once, and pro is asked again later", async () => {
  const m = await mockAsr((ws) => {
    ws.send(ok());
    setTimeout(() => ws.send(word(1, '第一句', { end: true })), 40);
    setTimeout(() => ws.send(word(2, '第二句', { end: true, start_time: 1600, end_time: 2000 })), 200);
    setTimeout(() => ws.send(word(3, '第三句', { end: true, start_time: 2600, end_time: 3000 })), 500);
  });
  let limit = 1;
  const t = mockTranslate(async (b) => {
    if (b.model === 'hy-mt2-pro' && limit > 0) { limit--; return { status: 429, error: 'The request rate exceeds the current model RPM limit 60' }; }
    return `${b.model}:${b.text}`;
  });
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl, rateCooldownMs: 250 });
  const finals = [];
  s.on('result', (r) => { if (r.sentenceEnd) finals.push(r.targetText); });
  await withCleanup(m, s, async () => {
    s.start();
    for (let i = 0; i < 10; i++) { s.push(Buffer.alloc(6400), { t0: Date.now() }); await sleep(60); }
    await sleep(300);
    assert.deepEqual(finals, ['hy-mt2-plus:第一句', 'hy-mt2-plus:第二句', 'hy-mt2-pro:第三句'],
      'the limited line and the one inside the cooldown go to plus; after it, pro again');
    assert.equal(s.status.model, 'hy-mt2-pro', 'pro is not stepped down from');
    assert.equal(s.status.translateFailures, 0);
    assert.equal(s.status.rateFallbacks, 2);
  });
});

test('if plus is refused while pro is at its limit, the line fails rather than looping', async () => {
  const m = await mockAsr((ws) => { ws.send(ok()); setTimeout(() => ws.send(word(1, '一句', { end: true })), 40); });
  const t = mockTranslate(async (b) => (b.model === 'hy-mt2-pro'
    ? { status: 429, error: 'The request rate exceeds the current model RPM limit 60' }
    : { status: 402, error: 'The free trial quota for the service has been exhausted and postpaid billing is not enabled' }));
  const s = new SplitStream(creds, { wsUrl: m.url, tokenhubKey: 'k', fetchImpl: t.fetchImpl, rateCooldownMs: 0 });
  await withCleanup(m, s, async () => {
    s.start();
    for (let i = 0; i < 4; i++) { s.push(Buffer.alloc(6400), { t0: Date.now() }); await sleep(50); }
    await sleep(300);
    assert.ok(t.calls.length <= 4, `a bounded number of calls, not a loop (${t.calls.length})`);
    assert.equal(s.status.model, 'hy-mt2-pro', 'a refused stand-in does not step pro down');
    assert.equal(s.status.translateFailures, 1);
  });
});
