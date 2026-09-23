'use strict';
const crypto = require('node:crypto');

const ISSUER = 'https://appleid.apple.com';
const KEYS_URL = `${ISSUER}/auth/keys`;
const TOKEN_URL = `${ISSUER}/auth/token`;
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function createAppleSignIn({ teamId, keyId, privateKey, clients, fetchImpl = fetch, now = Date.now }) {
  if (!teamId || !keyId || !privateKey || !clients || !Object.values(clients).every(Boolean)) throw new Error('Apple sign-in is not configured');
  let keys = null;
  let keysUntil = 0;

  function clientSecret(clientId) {
    const seconds = Math.floor(now() / 1000);
    const header = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
    const payload = b64({ iss: teamId, iat: seconds, exp: seconds + 300, aud: ISSUER, sub: clientId });
    const data = `${header}.${payload}`;
    const signature = crypto.sign('sha256', Buffer.from(data), { key: privateKey.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' });
    return `${data}.${signature.toString('base64url')}`;
  }

  async function exchange(code, clientId, redirectUri) {
    const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret(clientId), code: String(code), grant_type: 'authorization_code' });
    if (redirectUri) params.set('redirect_uri', redirectUri);
    const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params, signal: AbortSignal.timeout(10_000) });
    const body = await response.json();
    if (!response.ok || !body.id_token) throw new Error('Apple did not validate this sign-in');
    return body.id_token;
  }

  async function publicKeys(force = false) {
    if (!force && keys && now() < keysUntil) return keys;
    const response = await fetchImpl(KEYS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Apple public keys are unavailable');
    const body = await response.json();
    if (!Array.isArray(body.keys)) throw new Error('Apple public keys are invalid');
    keys = body.keys;
    keysUntil = now() + 60 * 60_000;
    return keys;
  }

  async function verify(idToken, clientId, nonce) {
    if (!Object.values(clients).includes(clientId)) throw new Error('invalid Apple client');
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw new Error('invalid Apple identity token');
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    } catch { throw new Error('invalid Apple identity token'); }
    if (header.alg !== 'RS256' || !header.kid || !claims.sub) throw new Error('invalid Apple identity token');
    let key = (await publicKeys()).find((item) => item.kid === header.kid && item.kty === 'RSA' && item.use === 'sig');
    if (!key) key = (await publicKeys(true)).find((item) => item.kid === header.kid && item.kty === 'RSA' && item.use === 'sig');
    if (!key || !crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('invalid Apple identity token');
    const seconds = Math.floor(now() / 1000);
    if (claims.iss !== ISSUER || claims.aud !== clientId || !Number.isInteger(claims.exp) || claims.exp <= seconds || !Number.isInteger(claims.iat) || claims.iat > seconds + 60 || claims.iat < seconds - 3600) throw new Error('expired or invalid Apple identity token');
    if (nonce && claims.nonce !== nonce) throw new Error('Apple sign-in nonce mismatch');
    // Apple says email in its signed identity token is verified. Some responses omit the
    // optional email_verified claim; an explicit false still blocks automatic matching.
    return { sub: claims.sub, email: claims.email || '', emailVerified: claims.email_verified !== false && claims.email_verified !== 'false', isPrivateEmail: claims.is_private_email === true || claims.is_private_email === 'true' };
  }

  async function authenticate({ code, clientId, redirectUri, nonce }) {
    const token = await exchange(code, clientId, redirectUri);
    return verify(token, clientId, nonce);
  }

  return { clients, authenticate, verify };
}

module.exports = { createAppleSignIn };
