'use strict';
// The stream can run without a Tencent key of its own: someone else (the hosted server) signs each
// connection and hands back a finished wss:// URL. These tests hold the properties that make that safe —
// no key is needed, a URL near its expiry is never dialled, and a few are kept in hand so a reconnect
// still works while the signer is unreachable.
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { TranslationStream } = require('../translator');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (voiceId, extra = {}) => JSON.stringify({ code: 0, message: 'success', voice_id: voiceId, ...extra });

function mockServer() {
  return new Promise((resolve) => {
    const conns = [];
    const wss = new WebSocketServer({ port: 0 }, () => resolve({ url: `ws://127.0.0.1:${wss.address().port}`, conns, close, drop }));
    wss.on('connection', (ws, req) => {
      const voiceId = new URL(req.url, 'http://x').searchParams.get('voice_id');
      conns.push({ voiceId, ws });
      ws.send(ok(voiceId));
    });
    function close() { for (const c of wss.clients) c.terminate(); wss.close(); }
    function drop() { for (const c of wss.clients) c.terminate(); }
  });
}

/** A stand-in for the server's signer: hands out URLs that really do reach the mock. */
function signer(base, { ttlMs = 120_000 } = {}) {
  let n = 0;
  const calls = [];
  const fn = async ({ count = 1, ...rest }) => {
    calls.push({ count, ...rest });
    if (fn.fail) throw new Error(fn.fail);
    return Array.from({ length: count }, () => {
      const voiceId = `v${++n}`;
      return { url: `${base}?voice_id=${voiceId}`, voiceId, expiresAt: Date.now() + (fn.ttlMs || ttlMs) };
    });
  };
  fn.calls = calls;
  return fn;
}

async function withCleanup(m, s, fn) {
  try { await fn(); } finally { s.stop(); await sleep(120); m.close(); }
}

test('a stream with no key of its own opens the URL it was handed', async () => {
  const m = await mockServer();
  const urlFor = signer(m.url);
  const s = new TranslationStream(null, { urlFor });
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(400);
    assert.equal(s.status().state, 'ready');
    assert.equal(s.status().keyless, true);
    assert.equal(m.conns.length, 1);
    assert.equal(m.conns[0].voiceId, 'v1', 'it dialled the URL the signer produced');
    assert.ok(urlFor.calls.length >= 1);
    // the languages and tuning are what gets signed, so the signer has to be told them
    assert.equal(urlFor.calls[0].source, 'yue');
    assert.equal(urlFor.calls[0].target, 'zh');
    assert.ok(urlFor.calls[0].count > 1, 'asks for a batch, not one at a time');
    assert.ok('hotwords' in urlFor.calls[0].tuning, 'tuning is sent raw so the server can validate it');
  });
});

test('a reconnect works while the signer is unreachable', async () => {
  const m = await mockServer();
  const urlFor = signer(m.url);
  const s = new TranslationStream(null, { urlFor });
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(400);
    assert.equal(m.conns.length, 1);
    const held = s.status().signedUrls;
    assert.ok(held >= 1, `expected spares in hand, had ${held}`);

    urlFor.fail = 'the server is down'; // nothing can be signed from here on
    m.drop();
    await sleep(1500); // one backoff step, which a dropped connection always costs

    assert.equal(m.conns.length, 2, 'it reconnected out of what it already held');
    assert.equal(m.conns[1].voiceId, 'v2');
  });
});

test('a URL too near its expiry is thrown away rather than dialled', async () => {
  const m = await mockServer();
  const urlFor = signer(m.url);
  urlFor.ttlMs = 5_000; // inside the floor: not enough life to rely on
  const s = new TranslationStream(null, { urlFor });
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(500);
    assert.equal(m.conns.length, 0, 'nothing was dialled with a URL about to expire');
    assert.equal(s.status().signedUrls, 0, 'and none were kept');
    assert.match(s.status().lastError.message, /signed URL/);

    urlFor.ttlMs = 120_000; // the server starts issuing usable ones again
    await sleep(2500);
    assert.equal(m.conns.length, 1, 'it recovers on its own once the URLs are usable');
  });
});

test('when nothing can be signed, it retries and says why instead of throwing', async () => {
  const m = await mockServer();
  const urlFor = signer(m.url);
  urlFor.fail = 'plan quota is used up';
  const s = new TranslationStream(null, { urlFor });
  const logs = [];
  s.on('log', (t) => logs.push(t));
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(500);
    assert.equal(m.conns.length, 0);
    assert.equal(s.status().state, 'reconnecting');
    assert.match(s.status().lastError.message, /quota is used up/);
    assert.ok(logs.some((l) => /quota is used up/.test(l)), 'the reason reaches the log the operator reads');
    assert.ok(s.status().retryAt > Date.now(), 'and it is going to try again');
  });
});

test('changing a setting that is signed into the URL throws the spares away', async () => {
  const m = await mockServer();
  const urlFor = signer(m.url);
  const s = new TranslationStream(null, { urlFor });
  await withCleanup(m, s, async () => {
    s.start();
    await sleep(400);
    assert.ok(s.status().signedUrls >= 1);

    s.setOptions({ target: 'ja' });
    assert.equal(s.status().signedUrls, 0, 'URLs signed for the old pair are worthless at once');

    await sleep(600);
    assert.equal(s.status().target, 'ja');
    assert.ok(urlFor.calls[urlFor.calls.length - 1].target === 'ja', 'and the next batch is signed for the new pair');
  });
});
