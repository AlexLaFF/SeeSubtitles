'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  canonicalQuery, hmacSha1Base64, buildConnection, getCredentials, HOST, PATH_PREFIX,
} = require('../tencent');

test('HMAC-SHA1 + base64 plumbing matches the well-known "quick brown fox" vector', () => {
  const text = 'The quick brown fox jumps over the lazy dog';
  const hex = crypto.createHmac('sha1', 'key').update(text).digest('hex');
  assert.equal(hex, 'de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9'); // published vector
  assert.equal(hmacSha1Base64('key', text), Buffer.from(hex, 'hex').toString('base64'));
});

test('canonical query sorts keys in byte order exactly like the docs example', () => {
  const q = canonicalQuery({
    voice_id: 'abc', voice_format: 1, trans_model: 'hunyuan-translation-lite', timestamp: 1,
    target: 'zh', source: 'yue', secretid: 'AKID', nonce: 3, expired: 2,
  });
  assert.equal(
    q,
    'expired=2&nonce=3&secretid=AKID&source=yue&target=zh&timestamp=1' +
      '&trans_model=hunyuan-translation-lite&voice_format=1&voice_id=abc',
  );
});

test('buildConnection signs host+path+sorted query and URL-encodes the signature', () => {
  const creds = { appid: '1250000000', secretId: 'AKIDexample', secretKey: 'SKexample' };
  const c = buildConnection(creds, { voiceId: 'v-1' });
  assert.ok(c.stringToSign.startsWith(`${HOST}${PATH_PREFIX}1250000000?expired=`));
  assert.ok(!c.stringToSign.includes('signature'));
  assert.equal(c.signature, hmacSha1Base64(creds.secretKey, c.stringToSign));
  assert.equal(c.url, `wss://${c.stringToSign}&signature=${encodeURIComponent(c.signature)}`);
  assert.equal(c.params.source, 'yue');
  assert.equal(c.params.target, 'zh');
  assert.equal(c.params.voice_format, 1);
  assert.ok(c.params.expired > c.params.timestamp);
  assert.ok(String(c.params.nonce).length <= 10);
});

test('every connection gets a fresh voice_id by default', () => {
  const creds = { appid: '1', secretId: 'a', secretKey: 'b' };
  assert.notEqual(buildConnection(creds).voiceId, buildConnection(creds).voiceId);
});

test('getCredentials rejects placeholders and non-numeric appid', () => {
  assert.throws(() => getCredentials({ TENCENT_APPID: 'your_appid_here', TENCENT_SECRET_ID: 'x', TENCENT_SECRET_KEY: 'y' }), /TENCENT_APPID/);
  assert.throws(() => getCredentials({ TENCENT_APPID: 'abc', TENCENT_SECRET_ID: 'x', TENCENT_SECRET_KEY: 'y' }), /numeric/);
  assert.deepEqual(
    getCredentials({ TENCENT_APPID: ' 123 ', TENCENT_SECRET_ID: 'x', TENCENT_SECRET_KEY: 'y' }),
    { appid: '123', secretId: 'x', secretKey: 'y' },
  );
});
