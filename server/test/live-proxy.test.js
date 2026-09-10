'use strict';
// The whole live path with the server in it: a client that holds no credentials, the proxy, and a stand-in
// for Tencent. What these hold is the property the design exists for — the account's hours are measured
// from the audio that actually passes through, not from anything the client says about itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { RemoteTranslationStream } = require('@subs/core');
const { createLiveProxy, SAMPLE_BYTES } = require('../lib/live-proxy');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (voiceId, extra = {}) => JSON.stringify({ code: 0, message: 'success', voice_id: voiceId, ...extra });

/** Stands in for Tencent: accepts the connection, and turns every 5th chunk into a sentence. */
function fakeTencent() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => resolve({ url: `ws://127.0.0.1:${wss.address().port}`, bytes: () => bytes, close: () => wss.close() }));
    let bytes = 0;
    wss.on('connection', (ws, req) => {
      const voiceId = new URL(req.url, 'http://x').searchParams.get('voice_id');
      ws.send(ok(voiceId));
      let n = 0;
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        bytes += data.length;
        if (++n % 5 === 0) ws.send(ok(voiceId, { sentence_id: `s${n}`, result: { source: 'yue', target: 'zh', source_text: '你好呀', target_text: '你好', start_time: 0, end_time: 400, sentence_end: true } }));
      });
    });
  });
}

/** A quota that starts with `seconds` of live time and records everything charged against it. */
function fakeQuotas(seconds) {
  let used = 0;
  return { used: () => used, add: (_id, kind, s) => { if (kind === 'live') used += s; }, remaining: () => Math.max(0, seconds - used) };
}

async function harness({ liveSeconds = 3600, meterMs = 100 } = {}) {
  const tencent = await fakeTencent();
  const quotas = fakeQuotas(liveSeconds);
  const user = { id: 1, email: 'probe@example.com' };
  const logs = [];
  const proxy = createLiveProxy({
    creds: { appid: '1250000000', secretId: 'AKID', secretKey: 'sk' },
    authenticate: (req) => (/^Bearer good$/.test(req.headers.authorization || '') ? user : null),
    quotas, planRow: (u) => u, log: (level, text) => logs.push(`${level} ${text}`),
    meterMs, wsUrl: tencent.url,
  });
  const server = http.createServer((_q, res) => res.end('no'));
  server.on('upgrade', (req, socket, head) => { if (!proxy.upgrade(req, socket, head)) socket.destroy(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, quotas, tencent, proxy, logs,
    async close() { proxy.closeAll(); await sleep(60); server.close(); tencent.close(); },
  };
}

test('a client with no credentials gets subtitles, and the audio it sends is what gets charged', async () => {
  const h = await harness();
  const stream = new RemoteTranslationStream({ url: h.url, token: 'good' }, {});
  const results = [];
  stream.on('result', (r) => results.push(r));
  try {
    stream.start();
    await sleep(400);
    assert.equal(stream.status().state, 'ready');
    assert.equal(stream.status().viaServer, true);

    // at the rate a microphone actually produces them — pushing ten at once would hit the one-second queue
    // cap the pipeline keeps on purpose, and half would be dropped before they ever left this machine
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) { stream.push(Buffer.alloc(6400, i), { t0: t0 + i * 200 }); await sleep(200); }
    await sleep(1200);

    // 10 chunks × 200 ms = 2 s of audio reached the far side, and only the audio: the eight bytes of
    // capture time that travel with each frame are stripped here, not passed on
    assert.equal(h.tencent.bytes(), 10 * 6400, 'every chunk was relayed, and only the audio');
    assert.equal(stream.status().dropped, 0, 'nothing was dropped at the sending end');
    assert.ok(results.length >= 2, `expected sentences back, got ${results.length}`);
    assert.equal(results[0].targetText, '你好');
    // the cue is placed on the client's clock, not the server's, so recordings line up
    assert.ok(Math.abs(results[0].wallStart - t0) < 1500, `wallStart ${results[0].wallStart} vs pushed at ${t0}`);

    assert.ok(h.quotas.used() >= 2, `expected ~2 s charged, got ${h.quotas.used()}`);
    assert.ok(h.quotas.used() <= 4, `charged far more than was sent: ${h.quotas.used()}`);
  } finally { stream.stop(); await h.close(); }
});

test('the talk is cut off when the month runs out, whatever the client would prefer', async () => {
  const h = await harness({ liveSeconds: 2, meterMs: 100 });
  const stream = new RemoteTranslationStream({ url: h.url, token: 'good' }, {});
  const errors = [];
  stream.on('server-error', (e) => errors.push(e));
  try {
    stream.start();
    await sleep(400);
    assert.equal(stream.status().state, 'ready');
    // keep pushing well past the two seconds the plan allows
    for (let i = 0; i < 40; i++) { stream.push(Buffer.alloc(6400, 1), { t0: Date.now() }); await sleep(25); }
    await sleep(600);

    assert.ok(errors.some((e) => e.code === 'plan_quota'), `expected a quota refusal, got ${JSON.stringify(errors)}`);
    assert.ok(h.tencent.bytes() < 40 * 6400, 'the audio stopped reaching Tencent once the plan was spent');
    assert.ok(h.logs.some((l) => /used the month's live hours/.test(l)));
  } finally { stream.stop(); await h.close(); }
});

test('a connection with no valid login never reaches Tencent at all', async () => {
  const h = await harness();
  const stream = new RemoteTranslationStream({ url: h.url, token: 'forged' }, {});
  try {
    stream.start();
    await sleep(500);
    assert.notEqual(stream.status().state, 'ready');
    assert.match(stream.status().lastError.message, /log in again/);
    assert.equal(h.tencent.bytes(), 0);
  } finally { stream.stop(); await h.close(); }
});

test('a language pair the API refuses is refused here, before any connection is opened', async () => {
  const h = await harness();
  const stream = new RemoteTranslationStream({ url: h.url, token: 'good' }, { source: 'yue', target: 'th' });
  const errors = [];
  stream.on('server-error', (e) => errors.push(e));
  try {
    stream.start();
    await sleep(400);
    assert.ok(errors.some((e) => e.code === 'bad_language'), `got ${JSON.stringify(errors)}`);
    assert.equal(h.tencent.bytes(), 0);
  } finally { stream.stop(); await h.close(); }
});
