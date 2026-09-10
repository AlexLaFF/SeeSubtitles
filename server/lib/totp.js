'use strict';
// RFC 6238 time-based one-time passwords (and the RFC 4648 base32 the authenticator apps expect).
// Deliberately dependency-free: node:crypto has the HMAC, and base32 is a few lines, so the server
// carries no third-party code on the login path.
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[\s-]|=+$/g, '')) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 for the authenticator app. */
function generateSecret() { return base32Encode(crypto.randomBytes(20)); }

/** The 6-digit code for one 30-second step. `counter` defaults to now. */
function codeFor(secret, counter = Math.floor(Date.now() / 1000 / STEP_SECONDS)) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f; // dynamic truncation, RFC 4226 §5.4
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Check a code the user typed. `window` steps either side are accepted so a clock that drifts by
 * a few seconds, or a code typed as it rolls over, still works.
 */
function verify(secret, code, { window = 1, now = Date.now() } = {}) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given) || !secret) return false;
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    const want = Buffer.from(codeFor(secret, current + i));
    const got = Buffer.from(given);
    if (want.length === got.length && crypto.timingSafeEqual(want, got)) return true;
  }
  return false;
}

/** The otpauth:// URL behind the enrollment QR code. */
function otpauthUrl(secret, account, issuer = 'See Subtitles') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q}`;
}

module.exports = { generateSecret, codeFor, verify, otpauthUrl, base32Encode, base32Decode, STEP_SECONDS, DIGITS };
