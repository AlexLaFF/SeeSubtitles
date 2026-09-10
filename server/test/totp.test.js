'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { createAuth, RECOVERY_COUNT } = require('../lib/auth');
const totp = require('../lib/totp');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subs-totp-'));
  const db = openDb(dir);
  const auth = createAuth(db);
  const user = auth.addUser('alex@test', 'password1');
  return { db, auth, user };
}
const codeNow = (secret) => totp.codeFor(secret);

test('RFC 6238 vectors (SHA-1, 6 digits)', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  for (const [t, want] of [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [20000000000, '353130']]) {
    assert.equal(totp.codeFor(secret, Math.floor(t / 30)), want, `T=${t}`);
  }
});

test('verify accepts one step of drift either way and nothing further', () => {
  const s = totp.generateSecret();
  const now = Date.now();
  const c = Math.floor(now / 1000 / totp.STEP_SECONDS);
  assert.equal(totp.verify(s, totp.codeFor(s, c), { now }), true);
  assert.equal(totp.verify(s, totp.codeFor(s, c - 1), { now }), true);
  assert.equal(totp.verify(s, totp.codeFor(s, c + 1), { now }), true);
  assert.equal(totp.verify(s, totp.codeFor(s, c - 2), { now }), false);
  assert.equal(totp.verify(s, totp.codeFor(s, c + 2), { now }), false);
});

test('malformed codes are rejected without throwing', () => {
  const s = totp.generateSecret();
  for (const bad of ['', null, undefined, 'abcdef', '12345', '1234567', '12 34 56', {}]) assert.equal(totp.verify(s, bad), false);
});

test('login is unchanged while two-factor is off', () => {
  const { auth } = setup();
  assert.equal(auth.login('alex@test', 'wrong', 'cookie', 'x'), null);
  const out = auth.login('alex@test', 'password1', 'cookie', 'Safari');
  assert.equal(out.user.email, 'alex@test');
  assert.ok(out.token);
});

test('enrolment: pending until a real code confirms it, then login needs the code', () => {
  const { auth, user } = setup();
  const { secret, url } = auth.beginTotp(user.id);
  assert.match(url, /^otpauth:\/\/totp\/See%20Subtitles%3Aalex%40test\?/);
  assert.match(url, /algorithm=SHA1/);
  assert.match(url, /digits=6/);
  assert.match(url, /period=30/);

  // still off until confirmed: a plain password login works
  assert.ok(auth.login('alex@test', 'password1', 'cookie', 'x').token);
  assert.equal(auth.totpStatus(user.id).enabled, false);

  assert.throws(() => auth.confirmTotp(user.id, '000000'), /not right/);
  const { codes } = auth.confirmTotp(user.id, codeNow(secret));
  assert.equal(codes.length, RECOVERY_COUNT);
  assert.equal(auth.totpStatus(user.id).enabled, true);

  // now the password alone is not enough
  assert.deepEqual(auth.login('alex@test', 'password1', 'cookie', 'x'), { totpRequired: true });
  assert.deepEqual(auth.login('alex@test', 'password1', 'cookie', 'x', { code: '000000' }), { totpBad: true });
  assert.equal(auth.login('alex@test', 'wrong', 'cookie', 'x', { code: codeNow(secret) }), null); // password still checked first
  assert.ok(auth.login('alex@test', 'password1', 'cookie', 'x', { code: codeNow(secret) }).token);
});

test('a recovery code logs in once and is then spent', () => {
  const { auth, user } = setup();
  const { secret } = auth.beginTotp(user.id);
  const { codes } = auth.confirmTotp(user.id, codeNow(secret));
  assert.equal(auth.totpStatus(user.id).recoveryLeft, RECOVERY_COUNT);

  assert.ok(auth.login('alex@test', 'password1', 'cookie', 'x', { code: codes[0] }).token);
  assert.equal(auth.totpStatus(user.id).recoveryLeft, RECOVERY_COUNT - 1);
  assert.deepEqual(auth.login('alex@test', 'password1', 'cookie', 'x', { code: codes[0] }), { totpBad: true }, 'a spent code must not work twice');

  // formatting is forgiving: case, spaces and the dash
  const messy = codes[1].toUpperCase().replace('-', ' ');
  assert.ok(auth.login('alex@test', 'password1', 'cookie', 'x', { code: messy }).token);
});

test('one account’s recovery codes do not work on another', () => {
  const { auth, user } = setup();
  const other = auth.addUser('mei@test', 'password2');
  const { secret } = auth.beginTotp(user.id);
  const { codes } = auth.confirmTotp(user.id, codeNow(secret));
  const { secret: s2 } = auth.beginTotp(other.id);
  auth.confirmTotp(other.id, codeNow(s2));
  assert.deepEqual(auth.login('mei@test', 'password2', 'cookie', 'x', { code: codes[0] }), { totpBad: true });
});

test('regenerating recovery codes needs the password and retires the old ones', () => {
  const { auth, user } = setup();
  const { secret } = auth.beginTotp(user.id);
  const { codes } = auth.confirmTotp(user.id, codeNow(secret));
  assert.throws(() => auth.regenerateRecovery(user.id, 'wrong'), /wrong password/);
  const fresh = auth.regenerateRecovery(user.id, 'password1');
  assert.equal(fresh.length, RECOVERY_COUNT);
  assert.equal(auth.totpStatus(user.id).recoveryLeft, RECOVERY_COUNT);
  assert.deepEqual(auth.login('alex@test', 'password1', 'cookie', 'x', { code: codes[0] }), { totpBad: true }, 'old codes are dead');
  assert.ok(auth.login('alex@test', 'password1', 'cookie', 'x', { code: fresh[0] }).token);
});

test('disabling needs the password, clears the codes, and restores one-factor login', () => {
  const { auth, user } = setup();
  const { secret } = auth.beginTotp(user.id);
  auth.confirmTotp(user.id, codeNow(secret));
  assert.throws(() => auth.disableTotp(user.id, 'wrong'), /wrong password/);
  assert.equal(auth.totpStatus(user.id).enabled, true);
  auth.disableTotp(user.id, 'password1');
  assert.equal(auth.totpStatus(user.id).enabled, false);
  assert.equal(auth.totpStatus(user.id).recoveryLeft, 0);
  assert.ok(auth.login('alex@test', 'password1', 'cookie', 'x').token);
});

test('enrolment cannot be started or re-confirmed while it is already on', () => {
  const { auth, user } = setup();
  const { secret } = auth.beginTotp(user.id);
  auth.confirmTotp(user.id, codeNow(secret));
  assert.throws(() => auth.beginTotp(user.id), /already on/);
  assert.throws(() => auth.confirmTotp(user.id, codeNow(secret)), /already on/);
});
