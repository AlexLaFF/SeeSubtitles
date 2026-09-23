'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAppleSignIn } = require('../lib/apple-signin');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

test('Apple identity checks signature, issuer, audience, expiry, and nonce before returning a subject', async () => {
  const { privateKey: rsaPrivate, publicKey: rsaPublic } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { privateKey: ecPrivate } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = { ...rsaPublic.export({ format: 'jwk' }), kid: 'apple-key', use: 'sig', alg: 'RS256' };
  const now = 1_790_000_000_000;
  let claimOverrides = {};
  const token = () => {
    const data = `${b64({ alg: 'RS256', kid: 'apple-key' })}.${b64({ iss: 'https://appleid.apple.com', aud: 'com.example.app', sub: 'stable-subject', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300, nonce: 'one-use-nonce', email: 'person@example.com', email_verified: 'true', ...claimOverrides })}`;
    return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), rsaPrivate).toString('base64url')}`;
  };
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/auth/keys')) return { ok: true, json: async () => ({ keys: [jwk] }) };
    assert.equal(new URLSearchParams(options.body).get('code'), 'single-use-code');
    return { ok: true, json: async () => ({ id_token: token() }) };
  };
  const apple = createAppleSignIn({ teamId: 'TEAM', keyId: 'KEY', privateKey: ecPrivate.export({ format: 'pem', type: 'pkcs8' }), clients: { native: 'com.example.app' }, fetchImpl, now: () => now });
  const identity = await apple.authenticate({ code: 'single-use-code', clientId: 'com.example.app', nonce: 'one-use-nonce' });
  assert.deepEqual(identity, { sub: 'stable-subject', email: 'person@example.com', emailVerified: true, isPrivateEmail: false });
  claimOverrides = { email_verified: undefined };
  assert.equal((await apple.verify(token(), 'com.example.app', 'one-use-nonce')).emailVerified, true);
  claimOverrides = { email_verified: false };
  assert.equal((await apple.verify(token(), 'com.example.app', 'one-use-nonce')).emailVerified, false);
  claimOverrides = {};
  await assert.rejects(apple.verify(token(), 'com.example.app', 'wrong'), /nonce/);
  await assert.rejects(apple.verify(token(), 'com.other.app', 'one-use-nonce'), /client/);
  claimOverrides = { iss: 'https://attacker.example' };
  await assert.rejects(apple.verify(token(), 'com.example.app', 'one-use-nonce'), /invalid/);
  claimOverrides = { exp: Math.floor(now / 1000) - 1 };
  await assert.rejects(apple.verify(token(), 'com.example.app', 'one-use-nonce'), /expired/);
  await assert.rejects(apple.verify(`${token().slice(0, -2)}aa`, 'com.example.app', 'one-use-nonce'), /invalid/);
});
