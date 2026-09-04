'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { TranslationStream } = require('../translator');

const creds = { appid: '1250000000', secretId: 'AKIDtest', secretKey: 'sk' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Always stop the stream and tear down the mock, even when an assertion fails. */
async function withCleanup(m, s, fn) {
  try { await fn(); } finally { s.stop(); await sleep(150); m.close(); }
}
const ok = (voiceId, extra = {}) => JSON.stringify({ code: 0, message: 'success', voice_id: voiceId, ...extra });

/** Mock of the Tencent endpoint. `onConn(ws, voiceId, conn)` customises behaviour; `end` is always honoured. */
function mockServer(onConn) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => resolve({ wss, url: `ws://127.0.0.1:${wss.address().port}`, conns, close }));
    const conns = [];
    wss.on('connection', (ws, req) => {
      const voiceId = new URL(req.url, 'http://x').searchParams.get('voice_id');
      const conn = { voiceId, chunks: 0, gotEnd: false, ws };
      conns.push(conn);
      ws.on('message', (data, isBinary) => {
        if (isBinary) { conn.chunks++; conn.lastChunkAt = Date.now(); return; }
        const msg = JSON.parse(data.toString());
        if (msg.type === 'end') { conn.gotEnd = true; ws.send(ok(voiceId, { final: 1 })); ws.close(1000); }
      });
      onConn(ws, voiceId, conn);
    });
    function close() { for (const c of wss.clients) c.terminate(); wss.close(); }
  });
}

test('authenticates, paces audio, emits normalised results', async () => {
  const times = [];
  const m = await mockServer((ws, voiceId) => {
    ws.send(ok(voiceId));
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      times.push(Date.now());
      if (times.length === 3) {
        ws.send(ok(voiceId, { sentence_id: 's1', result: { source: 'yue', target: 'zh', source_text: '你好', target_text: '你好', start_time: 0, end_time: 500, sentence_end: false } }));
      }
    });
  });
  const s = new TranslationStream(creds, { wsUrl: m.url });
  const results = [];
  s.on('result', (r) => results.push(r));
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(300);
    assert.equal(s.status().state, 'ready');
    assert.equal(s.status().voiceId, m.conns[0].voiceId);

    for (let i = 0; i < 5; i++) s.push(Buffer.alloc(6400, i));
    await sleep(1300);
    assert.equal(times.length, 5);
    // 5 queued chunks drain over ≥ 3 ticks (2+2+1), i.e. never as one burst
    assert.ok(times[4] - times[0] >= 350, `5 chunks arrived within ${times[4] - times[0]} ms`);

    assert.equal(results.length, 1);
    const { voiceId, wallStart, wallEnd, ...r } = results[0];
    assert.equal(voiceId, m.conns[0].voiceId);
    assert.deepEqual(r, { sentenceId: 's1', sourceText: '你好', targetText: '你好', startTime: 0, endTime: 500, sentenceEnd: false, source: 'yue', target: 'zh' });
    // stream time 0..500 ms maps onto the wall-clock time of the chunks we pushed (a moment ago)
    assert.ok(Math.abs(wallStart - Date.now()) < 3000, `wallStart ${wallStart} vs now ${Date.now()}`);
    assert.equal(wallEnd - wallStart, 500);

    s.stop();
    await sleep(100);
    assert.ok(m.conns[0].gotEnd, 'stop() sends {"type":"end"}');
  });
});

test('reconnects with a fresh voice_id after the server drops the connection', async () => {
  const m = await mockServer((ws, voiceId) => {
    ws.send(ok(voiceId));
    if (m.conns.length === 1) setTimeout(() => ws.close(1011, 'boom'), 200);
  });
  const s = new TranslationStream(creds, { wsUrl: m.url });
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(1500); // drop at 200 ms, first backoff 500 ms
    assert.equal(m.conns.length, 2);
    assert.notEqual(m.conns[0].voiceId, m.conns[1].voiceId);
    assert.equal(s.status().state, 'ready');
    assert.equal(s.status().reconnects, 1);
  });
});

test('rotates to a new connection before the age limit and ends the old one', async () => {
  const m = await mockServer((ws, voiceId) => ws.send(ok(voiceId)));
  const s = new TranslationStream(creds, { wsUrl: m.url, rotateMs: 1000 });
  const logs = [];
  s.on('log', (t) => logs.push(t));
  const feeder = setInterval(() => s.push(Buffer.alloc(6400)), 200);
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(1800);
    clearInterval(feeder);
    const snapshot = { conns: m.conns.map((c) => ({ voiceId: c.voiceId, chunks: c.chunks, gotEnd: c.gotEnd })), status: s.status(), logs };
    assert.equal(m.conns.length, 2, JSON.stringify(snapshot, null, 1));
    assert.ok(m.conns[0].gotEnd, 'old connection received end');
    assert.ok(m.conns[0].chunks > 0 && m.conns[1].chunks > 0, 'both connections received audio');
    assert.equal(s.status().voiceId, m.conns[1].voiceId);
    assert.equal(s.status().state, 'ready');
    assert.equal(s.status().reconnects, 1);
  }).finally(() => clearInterval(feeder));
});

test('auth/billing errors back off slowly', async () => {
  const m = await mockServer((ws) => { ws.send(JSON.stringify({ code: 6002, message: '鉴权失败' })); ws.close(1000); });
  const s = new TranslationStream(creds, { wsUrl: m.url });
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(400);
    const st = s.status();
    assert.equal(st.state, 'reconnecting');
    assert.equal(st.lastError.code, 6002);
    assert.ok(st.retryAt - Date.now() > 20_000, 'retry is ≥ 20 s away');
  });
});

test('sends a silent keepalive chunk when no audio arrives', async () => {
  const m = await mockServer((ws, voiceId) => ws.send(ok(voiceId)));
  const s = new TranslationStream(creds, { wsUrl: m.url });
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(4700); // keepalive fires after 4 s idle
    assert.ok(m.conns[0].chunks >= 1, 'keepalive silence received');
    assert.ok(s.status().keepalives >= 1);
  });
});
