'use strict';
// The live route, wired as the app runs it: a real local server, a file standing in for the microphone, and
// stand-ins for the two things beyond this Mac — the hosted server's relay (an address nothing listens on) and
// its signing endpoint. These hold what the route is for: no key ever comes here, an ordinary account never
// even asks for a signed connection, and the server's refusal wins over whatever the app believes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createLocalServer } = require('../local-server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(t, { trusted, liveUrls }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-route-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  const audio = path.join(root, 'silence.pcm');
  fs.writeFileSync(audio, Buffer.alloc(32000)); // one second of 16 kHz mono silence; FileCapture loops it
  const asked = [];
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    audioFile: audio, token: 'tk', env: { MP4_AUTO: '0', START_PAUSED: '0' }, consoleLog() {},
    cloudLive: { url: 'http://127.0.0.1:9', token: 'account-token' }, // nothing listens there
    liveUrls: async (req) => { asked.push(req); return liveUrls(req); },
    trusted,
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  return { server, asked, route: () => server.status().stream };
}

test('the account the server trusts goes straight to Tencent, on connections the server signs', async (t) => {
  const h = await start(t, { trusted: () => true, liveUrls: async () => [] });
  await sleep(100);
  assert.equal(h.route().route, 'direct');
  assert.equal(h.route().metered, false);
  assert.equal(h.route().keyless, true, 'it holds no key of its own');
  assert.ok(h.asked.length >= 1, 'it asked the server to sign a connection');
});

test('every other account goes through the server and never asks for a signed connection', async (t) => {
  const h = await start(t, { trusted: () => false, liveUrls: async () => { throw new Error('must not be asked'); } });
  await sleep(150);
  assert.equal(h.route().route, 'viaServer');
  assert.equal(h.route().metered, true);
  assert.equal(h.asked.length, 0);
});

test('a refused signature moves the talk onto the server at once, whatever the app believed', async (t) => {
  const h = await start(t, {
    trusted: () => true, // a stale plan that still says trusted
    liveUrls: async () => { throw Object.assign(new Error('this account connects through the subtitle server, not directly'), { code: 'not_trusted' }); },
  });
  for (let i = 0; i < 50 && h.route().route !== 'viaServer'; i++) await sleep(20);
  assert.equal(h.route().route, 'viaServer');
  const asks = h.asked.length;
  await sleep(1700); // longer than the signing rate limit: a direct stream still alive would have asked again
  assert.equal(h.asked.length, asks, 'and it stops asking');
});

test('a plan that arrives after the talk started moves it onto the direct route', async (t) => {
  let trust = null; // /api/me has not answered yet
  const h = await start(t, { trusted: () => trust, liveUrls: async () => [] });
  await sleep(50);
  assert.equal(h.route().route, 'viaServer', 'not knowing yet counts as not trusted');
  trust = true;
  h.server.recheckRoute();
  await sleep(50);
  assert.equal(h.route().route, 'direct');
  assert.ok(h.asked.length >= 1);
});
