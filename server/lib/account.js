'use strict';
// Account, team and glossary behind the hosted Account page: change password, sign out other devices, list the team,
// invite codes, password reset links an administrator hands out, "request an account" from the website, and the
// per-user glossary (hotwords) the desktop app and the web share.
const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('./auth');
const { IDS: PLAN_IDS, monthKey } = require('./plans');

const RESET_TTL_MS = 24 * 3600 * 1000;
const GLOSSARY_MAX = 128;
const tokenId = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
/** A token's label is what the client sent at login: the desktop app names itself, browsers send their user agent. */
function deviceName(label, kind) {
  if (!label) return kind === 'bearer' ? 'See Subtitles app' : 'Browser';
  if (!/Mozilla\//.test(label)) return label;
  const os = /iPhone/.test(label) ? 'iPhone' : /iPad/.test(label) ? 'iPad' : /Android/.test(label) ? 'Android' : /Mac OS X/.test(label) ? 'Mac' : /Windows/.test(label) ? 'Windows' : /Linux/.test(label) ? 'Linux' : '';
  const browser = /Edg\//.test(label) ? 'Edge' : /OPR\//.test(label) ? 'Opera' : /Chrome\//.test(label) ? 'Chrome' : /Firefox\//.test(label) ? 'Firefox' : /Safari\//.test(label) ? 'Safari' : 'Browser';
  return os ? `${browser} on ${os}` : browser;
}

/** Validate a glossary as stored and edited on both sides: up to 128 terms, weight 1–11 or 100 (forced), short notes. */
function cleanGlossary(items) {
  if (!Array.isArray(items)) throw new Error('glossary must be a list');
  if (items.length > GLOSSARY_MAX) throw new Error(`at most ${GLOSSARY_MAX} terms`);
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const term = String((it && it.term) || '').trim().replace(/[|\n\r]/g, '');
    if (!term) continue;
    if (term.length > 40) throw new Error(`"${term.slice(0, 20)}…" is longer than 40 characters`);
    let weight = Number(it.weight);
    if (!Number.isFinite(weight)) weight = 6;
    weight = weight >= 100 ? 100 : Math.min(11, Math.max(1, Math.round(weight)));
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ term, weight, note: String((it && it.note) || '').trim().slice(0, 120) });
  }
  return out;
}
/** The text the recogniser takes: one `词|权重` per line. */
const hotwordsText = (items) => items.map((i) => `${i.term}|${i.weight}`).join('\n');

function createAccount(db, { baseUrl = '', log = () => {} } = {}) {
  const userRow = (id) => db.get('SELECT id, email, role, plan, created_at FROM users WHERE id = ?', id);
  const isAdmin = (user) => { const u = userRow(user.id); return !!u && u.role === 'admin'; };

  function changePassword(user, current, next) {
    const u = db.get('SELECT pass_hash FROM users WHERE id = ?', user.id);
    if (!u || !verifyPassword(String(current || ''), u.pass_hash)) throw new Error('the current password is wrong');
    if (String(next || '').length < 8) throw new Error('the new password must be at least 8 characters');
    db.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(next), user.id);
    db.run('DELETE FROM tokens WHERE user_id = ? AND token <> ?', user.id, user.token || '');
    log('info', `password changed for ${user.email}; other devices signed out`);
  }

  function listTokens(user) {
    return db.all('SELECT token, kind, label, created_at, last_used FROM tokens WHERE user_id = ? ORDER BY last_used DESC', user.id)
      .map((t) => ({ id: tokenId(t.token), kind: t.kind, label: deviceName(t.label, t.kind), created_at: t.created_at, last_used: t.last_used, current: t.token === user.token }));
  }
  function revokeTokens(user, { id = null, all = false } = {}) {
    let n = 0;
    for (const t of db.all('SELECT token FROM tokens WHERE user_id = ?', user.id)) {
      if (t.token === user.token) continue;
      if (all || (id && tokenId(t.token) === id)) { db.run('DELETE FROM tokens WHERE token = ?', t.token); n++; }
    }
    return n;
  }

  // ---- team (administrators)
  function team() {
    const users = db.all(`SELECT u.id, u.email, u.role, u.plan, u.created_at, (SELECT MAX(last_used) FROM tokens t WHERE t.user_id = u.id) AS last_active,
      (SELECT COUNT(*) FROM live_sessions s WHERE s.user_id = u.id) AS sessions, (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id) AS jobs,
      COALESCE((SELECT live_seconds FROM usage x WHERE x.user_id = u.id AND x.month = ?), 0) AS live_seconds,
      COALESCE((SELECT file_seconds FROM usage x WHERE x.user_id = u.id AND x.month = ?), 0) AS file_seconds FROM users u ORDER BY u.id`, monthKey(), monthKey());
    const invites = db.all(`SELECT i.code, i.created_at, i.used_at, c.email AS created_by, u.email AS used_by FROM invites i
      LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 100`);
    const requests = db.all('SELECT id, name, email, org, note, created_at, handled_at FROM requests ORDER BY (handled_at IS NOT NULL), created_at DESC LIMIT 100');
    return { users, invites, requests };
  }
  function setPlan(userId, plan) {
    if (!PLAN_IDS.includes(plan)) throw new Error(`plan must be one of ${PLAN_IDS.join(', ')}`);
    const r = db.run('UPDATE users SET plan = ? WHERE id = ?', plan, Number(userId));
    if (!r.changes) throw new Error('no such user');
    log('info', `plan of user ${userId} set to ${plan}`);
  }
  function createInvite(byUserId) {
    const code = crypto.randomBytes(6).toString('base64url');
    db.run('INSERT INTO invites(code, created_by, created_at) VALUES (?,?,?)', code, byUserId, Date.now());
    return code;
  }
  function deleteInvite(code) {
    const r = db.run('DELETE FROM invites WHERE code = ? AND used_at IS NULL', String(code));
    if (!r.changes) throw new Error('no such unused invite');
  }
  function setRole(byUser, userId, role) {
    if (!['user', 'admin'].includes(role)) throw new Error('role must be user or admin');
    const target = userRow(userId);
    if (!target) throw new Error('no such user');
    if (role === 'user' && target.role === 'admin' && db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n <= 1) throw new Error('that is the only administrator');
    db.run('UPDATE users SET role = ? WHERE id = ?', role, userId);
    log('info', `${byUser.email} made ${target.email} ${role}`);
  }
  function createReset(userId) {
    const target = userRow(userId);
    if (!target) throw new Error('no such user');
    const token = crypto.randomBytes(18).toString('base64url');
    db.run('INSERT INTO resets(token, user_id, created_at) VALUES (?,?,?)', token, userId, Date.now());
    return { token, email: target.email, url: `${baseUrl}/reset/${token}`, expiresAt: Date.now() + RESET_TTL_MS };
  }
  function resetInfo(token) {
    const r = db.get('SELECT r.user_id, r.created_at, r.used_at, u.email FROM resets r JOIN users u ON u.id = r.user_id WHERE r.token = ?', String(token || ''));
    if (!r || r.used_at || Date.now() - r.created_at > RESET_TTL_MS) return null;
    return { email: r.email.replace(/^(.).*(@.*)$/, '$1•••$2'), userId: r.user_id };
  }
  function resetPassword(token, password) {
    const info = resetInfo(token);
    if (!info) throw new Error('this reset link is invalid or has expired');
    if (String(password || '').length < 8) throw new Error('the password must be at least 8 characters');
    db.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(password), info.userId);
    db.run('UPDATE resets SET used_at = ? WHERE token = ?', Date.now(), token);
    db.run('DELETE FROM tokens WHERE user_id = ?', info.userId);
    const u = userRow(info.userId);
    log('info', `password reset for ${u.email}; all devices signed out`);
    return u.email;
  }

  // ---- website: request an account
  function requestAccount({ name, email, org, note, plan } = {}) {
    const clean = String(email || '').trim().toLowerCase();
    const wanted = /^[a-z]{1,20}$/i.test(String(plan || '')) ? String(plan).toLowerCase() : '';
    note = [wanted ? `plan: ${wanted}` : '', String(note || '').trim()].filter(Boolean).join(' · ');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('please give an email address we can reply to');
    const r = db.run('INSERT INTO requests(name, email, org, note, created_at) VALUES (?,?,?,?,?)', String(name || '').trim().slice(0, 80), clean, String(org || '').trim().slice(0, 120), String(note || '').trim().slice(0, 1000), Date.now());
    log('info', `account requested by ${clean}`);
    return { id: Number(r.lastInsertRowid) };
  }
  function handleRequest(id, byUserId) {
    const r = db.run('UPDATE requests SET handled_at = ?, handled_by = ? WHERE id = ? AND handled_at IS NULL', Date.now(), byUserId, Number(id));
    if (!r.changes) throw new Error('no such open request');
  }

  // ---- glossary
  function getGlossary(userId) {
    const row = db.get('SELECT items, updated_at FROM glossary WHERE user_id = ?', userId);
    if (!row) return { items: [], updatedAt: null };
    try { return { items: cleanGlossary(JSON.parse(row.items)), updatedAt: row.updated_at }; } catch { return { items: [], updatedAt: row.updated_at }; }
  }
  function putGlossary(userId, items) {
    const clean = cleanGlossary(items);
    const now = Date.now();
    db.run('INSERT INTO glossary(user_id, items, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at', userId, JSON.stringify(clean), now);
    return { items: clean, updatedAt: now };
  }

  return { isAdmin, userRow, changePassword, listTokens, revokeTokens, team, setPlan, createInvite, deleteInvite, setRole, createReset, resetInfo, resetPassword, requestAccount, handleRequest, getGlossary, putGlossary };
}

module.exports = { createAccount, cleanGlossary, hotwordsText, deviceName, RESET_TTL_MS, GLOSSARY_MAX };
