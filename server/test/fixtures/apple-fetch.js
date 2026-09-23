'use strict';
// Child-process-only stand-in for Apple's key and code exchange endpoints.
// The running server still verifies an RS256 identity token and its nonce.
const crypto = require('node:crypto');
const originalFetch = global.fetch;
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-apple-key', kty: 'RSA', use: 'sig', alg: 'RS256' };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

global.fetch = async (url, options) => {
  if (url === 'https://appleid.apple.com/auth/keys') return { ok: true, json: async () => ({ keys: [jwk] }) };
  if (url === 'https://appleid.apple.com/auth/token') {
    try {
      const form = new URLSearchParams(options.body);
      const identity = JSON.parse(Buffer.from(form.get('code'), 'base64url').toString());
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: 'https://appleid.apple.com', aud: form.get('client_id'), sub: identity.sub,
        iat: now, exp: now + 300, nonce: identity.nonce, email: identity.email,
        email_verified: identity.emailVerified ? 'true' : 'false', is_private_email: identity.privateEmail ? 'true' : 'false' };
      const data = `${b64({ alg: 'RS256', kid: jwk.kid })}.${b64(claims)}`;
      const id_token = `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
      return { ok: true, json: async () => ({ id_token }) };
    } catch { return { ok: false, json: async () => ({ error: 'invalid_grant' }) }; }
  }
  return originalFetch(url, options);
};
