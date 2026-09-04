'use strict';
// Password hashing (scrypt, node:crypto) and token auth: HttpOnly cookie for browsers, bearer for the desktop app.
const crypto = require('node:crypto');

const COOKIE = 'sid';
const TOKEN_TTL_MS = 90 * 24 * 3600 * 1000;

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
  function login(email, password, kind, label) {
    const user = db.get('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(password || ''), user.pass_hash)) return null;
    return { user: { id: user.id, email: user.email }, token: issueToken(user.id, kind, label) };
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
    if (String(password || '').length < 8) throw new Error('password must be at least 8 characters');
    db.run('INSERT INTO users(email, pass_hash, created_at) VALUES (?,?,?)', clean, hashPassword(password), Date.now());
    return db.get('SELECT id, email FROM users WHERE email = ?', clean);
  }
  function setPassword(email, password) {
    if (String(password || '').length < 8) throw new Error('password must be at least 8 characters');
    const r = db.run('UPDATE users SET pass_hash = ? WHERE email = ?', hashPassword(password), String(email).trim().toLowerCase());
    if (!r.changes) throw new Error('no such user');
  }
  return { login, authenticate, revoke, cookieHeader, clearCookie, addUser, setPassword, issueToken };
}

module.exports = { createAuth, hashPassword, verifyPassword, parseCookies, COOKIE };
