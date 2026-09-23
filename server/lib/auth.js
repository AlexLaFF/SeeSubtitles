'use strict';
// Password hashing (scrypt, node:crypto) and token auth: HttpOnly cookie for browsers, bearer for the desktop app.
const crypto = require('node:crypto');
const totp = require('./totp');

const COOKIE = 'sid';
const TOKEN_TTL_MS = 90 * 24 * 3600 * 1000;
const SIGNUP_MODES = ['closed', 'invite', 'open']; // closed: admin CLI only · invite: needs a code · open: anyone
const NO_PASSWORD = 'apple-only';

/** Sliding-window counter for login / sign-up attempts, keyed by IP or email. In memory, per process. */
function createLimiter({ max = 20, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return true;
    },
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Recovery codes: ten one-time strings, shown once at enrolment and stored only as scrypt hashes.
// Without them a lost phone means a locked account, since the reset path is an administrator by hand.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no i/l/o/0/1 — these get read aloud and retyped
const RECOVERY_COUNT = 10;
function makeRecoveryCode() {
  let out = '';
  for (let i = 0; i < 10; i++) out += RECOVERY_ALPHABET[crypto.randomInt(0, RECOVERY_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}
const normaliseRecovery = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth(db) {
  function issueToken(userId, kind, label) {
    const token = crypto.randomBytes(24).toString('base64url');
    db.run('INSERT INTO tokens(token, user_id, kind, label, created_at, last_used) VALUES (?,?,?,?,?,?)', token, userId, kind, label || null, Date.now(), Date.now());
    return token;
  }
  /**
   * Returns null for a wrong email or password; { totpRequired: true } when the password was right and
   * the account has a second factor; { totpBad: true } when the code or recovery code did not match;
   * otherwise { user, token }.
   */
  function login(email, password, kind, label, { code = '' } = {}) {
    const user = db.get('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(password || ''), user.pass_hash)) return null;
    if (user.totp_secret) {
      if (!String(code || '').trim()) return { totpRequired: true };
      if (!consumeSecondFactor(user, code)) return { totpBad: true };
    }
    return { user: { id: user.id, email: user.email }, token: issueToken(user.id, kind, label) };
  }

  // Apple credentials must be verified by the server before either method is called.
  // Apple's stable subject is the login key; its email can change or be a private relay.
  function findOrLinkApple(identity, { allowSignup = false } = {}) {
    if (!identity || !identity.sub) throw new Error('invalid Apple identity');
    let user = db.get('SELECT u.id, u.email FROM apple_identities a JOIN users u ON u.id = a.user_id WHERE a.subject = ?', identity.sub);
    if (!user) {
      const email = String(identity.email || '').trim().toLowerCase();
      if (identity.emailVerified === false || !/^[^@\s]+@[^@\s]+$/.test(email)) return null;
      // A shared, verified address can connect an existing account. A private relay
      // cannot prove ownership of a different account; it may create its own.
      user = identity.isPrivateEmail ? null : db.get('SELECT id, email FROM users WHERE email = ?', email);
      if (user) { linkApple(user.id, identity); return user; }
      if (!allowSignup || db.get('SELECT 1 FROM users WHERE email = ?', email)) return null;
      // Keep the new account and its Apple identity together, including under a
      // concurrent first sign-in or a failed insert.
      db.raw.exec('BEGIN IMMEDIATE');
      try {
        user = db.get('SELECT u.id, u.email FROM apple_identities a JOIN users u ON u.id = a.user_id WHERE a.subject = ?', identity.sub);
        if (!user) {
          if (db.get('SELECT 1 FROM users WHERE email = ?', email)) { db.raw.exec('ROLLBACK'); return null; }
          user = addUser(email, null);
          linkApple(user.id, identity);
        }
        db.raw.exec('COMMIT');
      } catch (err) { db.raw.exec('ROLLBACK'); throw err; }
    }
    return user;
  }

  function loginApple(identity, kind, label, options) {
    const user = findOrLinkApple(identity, options);
    return user ? { user, token: issueToken(user.id, kind, label) } : null;
  }

  function linkApple(userId, identity) {
    if (!identity || !identity.sub) throw new Error('invalid Apple identity');
    const user = db.get('SELECT id FROM users WHERE id = ?', userId);
    if (!user) throw new Error('no such account');
    const owner = db.get('SELECT user_id FROM apple_identities WHERE subject = ?', identity.sub);
    if (owner && owner.user_id !== userId) throw new Error('this Apple Account is linked to another account');
    const existing = db.get('SELECT subject FROM apple_identities WHERE user_id = ?', userId);
    if (existing && existing.subject !== identity.sub) throw new Error('this account is linked to another Apple Account');
    if (!owner) db.run('INSERT INTO apple_identities(subject, user_id, linked_at) VALUES (?,?,?)', identity.sub, userId, Date.now());
    return { linked: true };
  }

  function authorizeAppleLink(userId, password, code) {
    const user = db.get('SELECT * FROM users WHERE id = ?', userId);
    if (!user || !verifyPassword(String(password || ''), user.pass_hash)) return false;
    return !user.totp_secret || (!!String(code || '').trim() && consumeSecondFactor(user, code));
  }

  function appleStatus(userId) {
    const user = db.get('SELECT pass_hash FROM users WHERE id = ?', userId);
    return { linked: !!db.get('SELECT 1 FROM apple_identities WHERE user_id = ?', userId), passwordSet: !!user && user.pass_hash !== NO_PASSWORD };
  }

  function confirmPasswordFromApple(userId, identity, passwordHash, keepToken = '') {
    const linked = db.get('SELECT subject FROM apple_identities WHERE user_id = ?', userId);
    const user = db.get('SELECT pass_hash FROM users WHERE id = ?', userId);
    if (!linked || linked.subject !== identity.sub || !user || user.pass_hash !== NO_PASSWORD) throw new Error('Apple Account cannot set this password');
    if (!String(passwordHash).startsWith('scrypt$')) throw new Error('invalid password hash');
    db.run('UPDATE users SET pass_hash = ? WHERE id = ?', passwordHash, userId);
    db.run('DELETE FROM tokens WHERE user_id = ? AND token <> ?', userId, keepToken);
    return { passwordSet: true };
  }
  function setPasswordFromApple(userId, identity, password, keepToken = '') {
    if (String(password || '').length < 8) throw new Error('password must be at least 8 characters');
    return confirmPasswordFromApple(userId, identity, hashPassword(password), keepToken);
  }

  /** A 6-digit TOTP, or one of the account's unused recovery codes (which is then spent). */
  function consumeSecondFactor(user, code) {
    const given = String(code || '').trim();
    if (totp.verify(user.totp_secret, given)) return true;
    const flat = normaliseRecovery(given);
    if (flat.length !== 10) return false;
    for (const row of db.all('SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', user.id)) {
      if (verifyPassword(flat, row.code_hash)) {
        db.run('UPDATE recovery_codes SET used_at = ? WHERE id = ?', Date.now(), row.id);
        return true;
      }
    }
    return false;
  }

  /** Step 1 of enrolment: a secret to show as a QR code. Not active until confirmTotp succeeds. */
  function beginTotp(userId) {
    const user = db.get('SELECT id, email, totp_secret FROM users WHERE id = ?', userId);
    if (!user) throw new Error('no such account');
    if (user.totp_secret) throw new Error('two-factor authentication is already on');
    const secret = totp.generateSecret();
    db.run('UPDATE users SET totp_pending = ? WHERE id = ?', secret, userId);
    return { secret, url: totp.otpauthUrl(secret, user.email) };
  }

  /** Step 2: prove the app is set up, turn it on, and hand back the recovery codes (shown once). */
  function confirmTotp(userId, code) {
    const user = db.get('SELECT id, totp_pending, totp_secret FROM users WHERE id = ?', userId);
    if (!user) throw new Error('no such account');
    if (user.totp_secret) throw new Error('two-factor authentication is already on');
    if (!user.totp_pending) throw new Error('start the setup again');
    if (!totp.verify(user.totp_pending, code)) throw new Error('that code is not right; check the app and try again');
    db.run('UPDATE users SET totp_secret = ?, totp_pending = NULL WHERE id = ?', user.totp_pending, userId);
    return { codes: resetRecoveryCodes(userId) };
  }

  /** Turning it off needs the password again, so a borrowed session cannot do it. */
  function disableTotp(userId, password) {
    const user = db.get('SELECT id, pass_hash FROM users WHERE id = ?', userId);
    if (!user) throw new Error('no such account');
    if (!verifyPassword(String(password || ''), user.pass_hash)) throw new Error('wrong password');
    db.run('UPDATE users SET totp_secret = NULL, totp_pending = NULL WHERE id = ?', userId);
    db.run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
    return true;
  }

  /** Replaces every recovery code; the old ones stop working immediately. */
  function resetRecoveryCodes(userId) {
    db.run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
    const codes = [];
    for (let i = 0; i < RECOVERY_COUNT; i++) {
      const code = makeRecoveryCode();
      db.run('INSERT INTO recovery_codes(user_id, code_hash, created_at) VALUES (?,?,?)', userId, hashPassword(normaliseRecovery(code)), Date.now());
      codes.push(code);
    }
    return codes;
  }

  /** New recovery codes, password required — the old ones stop working. */
  function regenerateRecovery(userId, password) {
    const user = db.get('SELECT id, pass_hash, totp_secret FROM users WHERE id = ?', userId);
    if (!user) throw new Error('no such account');
    if (!verifyPassword(String(password || ''), user.pass_hash)) throw new Error('wrong password');
    if (!user.totp_secret) throw new Error('two-factor authentication is off');
    return resetRecoveryCodes(userId);
  }

  function totpStatus(userId) {
    const user = db.get('SELECT totp_secret FROM users WHERE id = ?', userId);
    const left = db.get('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', userId);
    return { enabled: !!(user && user.totp_secret), recoveryLeft: (left && left.n) || 0, recoveryTotal: RECOVERY_COUNT };
  }
  function userForToken(token) {
    if (!token) return null;
    const row = db.get('SELECT t.token, t.kind, t.created_at, u.id, u.email FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?', token);
    if (!row) return null;
    if (Date.now() - row.created_at > TOKEN_TTL_MS) { db.run('DELETE FROM tokens WHERE token = ?', token); return null; }
    db.run('UPDATE tokens SET last_used = ? WHERE token = ?', Date.now(), token);
    return { id: row.id, email: row.email, kind: row.kind, token };
  }
  /** Resolve the user from a request (bearer header first, then cookie). */
  function authenticate(req) {
    const h = req.headers.authorization || '';
    if (/^Bearer\s+/i.test(h)) return userForToken(h.replace(/^Bearer\s+/i, '').trim());
    return userForToken(parseCookies(req.headers.cookie)[COOKIE]);
  }
  function revoke(token) { db.run('DELETE FROM tokens WHERE token = ?', token); }
  function cookieHeader(token, secure) {
    return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
  }
  const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`;
  function addUser(email, password) {
    const clean = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(clean)) throw new Error('invalid email');
    if (password !== null && String(password || '').length < 8) throw new Error('password must be at least 8 characters');
    db.run('INSERT INTO users(email, pass_hash, created_at) VALUES (?,?,?)', clean, password === null ? NO_PASSWORD : hashPassword(password), Date.now());
    return db.get('SELECT id, email FROM users WHERE email = ?', clean);
  }
  function setPassword(email, password) {
    if (String(password || '').length < 8) throw new Error('password must be at least 8 characters');
    const r = db.run('UPDATE users SET pass_hash = ? WHERE email = ?', hashPassword(password), String(email).trim().toLowerCase());
    if (!r.changes) throw new Error('no such user');
  }
  function setRole(email, role) {
    if (!['user', 'admin'].includes(role)) throw new Error('role must be user or admin');
    const r = db.run('UPDATE users SET role = ? WHERE email = ?', role, String(email).trim().toLowerCase());
    if (!r.changes) throw new Error('no such user');
  }
  function createInvite(createdBy = null) {
    const code = crypto.randomBytes(6).toString('base64url');
    db.run('INSERT INTO invites(code, created_by, created_at) VALUES (?,?,?)', code, createdBy, Date.now());
    return code;
  }
  /** Self-service account creation, gated by the server's SIGNUP_MODE. */
  function signup(email, password, { mode = 'closed', invite = '' } = {}) {
    if (!SIGNUP_MODES.includes(mode)) throw new Error(`unknown sign-up mode "${mode}"`);
    if (mode === 'closed') throw new Error('sign-up is closed; ask the administrator for an account');
    let inv = null;
    if (mode === 'invite') {
      inv = db.get('SELECT code FROM invites WHERE code = ? AND used_at IS NULL', String(invite || '').trim());
      if (!inv) throw new Error('invalid or already used invite code');
    }
    if (db.get('SELECT 1 FROM users WHERE email = ?', String(email || '').trim().toLowerCase())) throw new Error('an account with this email already exists');
    const user = addUser(email, password);
    if (inv) db.run('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?', user.id, Date.now(), inv.code);
    return user;
  }
  return { login, loginApple, findOrLinkApple, linkApple, authorizeAppleLink, appleStatus, setPasswordFromApple, confirmPasswordFromApple, authenticate, revoke, cookieHeader, clearCookie, addUser, setPassword, setRole, createInvite, signup, issueToken, userForToken,
    beginTotp, confirmTotp, disableTotp, resetRecoveryCodes, regenerateRecovery, totpStatus };
}

module.exports = { createAuth, createLimiter, hashPassword, verifyPassword, SIGNUP_MODES, RECOVERY_COUNT, NO_PASSWORD };
