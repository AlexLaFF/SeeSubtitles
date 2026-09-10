'use strict';
// The properties /api/desktop/live-url depends on. The endpoint composes two things — the pair check from
// the shared schema and buildConnection from core — so these hold the parts that make handing a URL to an
// untrusted machine safe: the key is never in it, each connection is distinct, and the window is short.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConnection, schema } = require('@subs/core');

const creds = { appid: '1250000000', secretId: 'AKIDexample', secretKey: 'S3CR3T-key-value-nobody-may-see' };
const sign = (extra) => buildConnection(creds, { source: 'yue', target: 'zh', extra });

test('a signed URL carries no key, only proof that the signer had one', () => {
  const now = Math.floor(Date.now() / 1000);
  const { url } = sign({ expired: now + 120 });
  assert.ok(!url.includes(creds.secretKey), 'the secret key must never appear in a URL handed out');
  assert.ok(!url.includes(encodeURIComponent(creds.secretKey)));
  assert.ok(url.includes(`secretid=${creds.secretId}`), 'the id identifies the account and is not a secret');
  assert.match(url, /signature=/, 'possession of the key is proved by the signature instead');
  assert.ok(url.startsWith('wss://asr.cloud.tencent.com/asr/speech_translate/'));
});

test('the expiry the server chooses is the one that ends up in the URL', () => {
  const now = Math.floor(Date.now() / 1000);
  const { url, params } = sign({ expired: now + 120 });
  assert.equal(params.expired, now + 120);
  assert.ok(url.includes(`expired=${now + 120}`));
  // Measured against the live API (server/probe-signature.js): this bounds the window in which the URL can
  // be used to *open* a connection, and never the length of the stream that follows.
  assert.ok(params.expired - params.timestamp <= 120);
});

test('every issued URL is a different connection', () => {
  const a = sign({ expired: 1 });
  const b = sign({ expired: 1 });
  assert.notEqual(a.voiceId, b.voiceId, 'a reused voice_id would collide on the same account');
  assert.notEqual(a.signature, b.signature);
});

test('the pairs the endpoint refuses are the ones the API refuses', () => {
  // What the endpoint checks before signing anything, so a request can never produce a dead stream.
  assert.ok(schema.LIVE_PAIRS.yue, 'Cantonese is a spoken language');
  assert.ok(!schema.LIVE_PAIRS.fr, 'French is not');
  assert.ok(schema.targetsFor('yue').includes('ja'));
  assert.ok(!schema.targetsFor('yue').includes('th'), 'Cantonese to Thai is refused with 6001');
  assert.ok(!schema.targetsFor('ru').includes('ja'), 'Russian reaches only Chinese, English and itself');
});

test('changing what is signed changes the signature, so a stale URL cannot be re-aimed', () => {
  const base = buildConnection(creds, { source: 'yue', target: 'zh', voiceId: 'fixed', extra: { timestamp: 1, expired: 2, nonce: 3 } });
  const other = buildConnection(creds, { source: 'yue', target: 'ja', voiceId: 'fixed', extra: { timestamp: 1, expired: 2, nonce: 3 } });
  assert.notEqual(base.signature, other.signature, 'the target language is inside the signature');
  const tuned = buildConnection(creds, { source: 'yue', target: 'zh', voiceId: 'fixed', extra: { timestamp: 1, expired: 2, nonce: 3, hotword_list: '腾讯|10' } });
  assert.notEqual(base.signature, tuned.signature, 'and so is the glossary');
});
