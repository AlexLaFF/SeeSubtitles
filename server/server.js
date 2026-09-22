#!/usr/bin/env node
'use strict';
// Hosted server: login, live-session mirror (remote displays at /d/<code>), upload → subtitles jobs.
//   PORT (8080) HOST (0.0.0.0) DATA_DIR (../data) BASE_URL (public https URL, needed for long uploads)
//   TENCENT_APPID / TENCENT_SECRET_ID / TENCENT_SECRET_KEY   TOKENHUB_API_KEY + TRANSLATION_MODEL (hy-mt2-pro)   FFMPEG / FFPROBE (binaries; MP4 burn-in needs libass)
//   SUMMARY_MODEL (deepseek-v4-flash) SUMMARY_EFFORT (high): the model behind /api/summaries   IOS_APP_IDS: apps that may open this server's links
//   DASHSCOPE_API_KEY: Alibaba 百炼, which recognises Japanese uploads (fun-asr) far better than Tencent
//   TENCENT_WS_URL / TOKENHUB_BASE_URL / DASHSCOPE_BASE_URL / LIVE_METER_MS: stand-ins and a faster meter, for tests only (ios/e2e)
//   UPLOAD_IDLE_MS (120000): an upload connection that says nothing for this long is closed; the sender carries on from what arrived
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, getCredentials, schema, buildConnection, recognitionParams } = require('@subs/core');
const { openDb } = require('./lib/db');
const { createAuth } = require('./lib/auth');
const { LiveSessions } = require('./lib/live');
const { JobRunner, ENGINES, TARGETS } = require('./lib/jobs');
const { createLimiter, SIGNUP_MODES } = require('./lib/auth');
const { latestRelease } = require('./lib/updates');
const { UsageMonitor, parsePack } = require('./lib/usage');
const { createAccount } = require('./lib/account');
const { PLANS, Quotas } = require('./lib/plans');
const { createLiveProxy } = require('./lib/live-proxy');
const mail = require('./lib/mail');
const summaries = require('./lib/summaries');

loadEnv(path.join(__dirname, '..', '.env'));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const SECURE = /^https:/.test(BASE_URL);
// Accounts: closed (admin CLI creates users; default) · invite (sign-up with a code from `cli.js add-invite`) · open
const SIGNUP_MODE = SIGNUP_MODES.includes(process.env.SIGNUP_MODE) ? process.env.SIGNUP_MODE : 'closed';
const attempts = createLimiter({ max: 20, windowMs: 15 * 60_000 }); // login + sign-up attempts per IP and per email
// Signing requests per account. A talk needs one every half hour (rotation) plus a few on a bad network, so
// this is far above honest use — it exists to bound what a stolen or modified client can start, since the
// two-minute expiry limits how long a *leaked URL* is worth anything and says nothing about how often a
// caller who can still authenticate may ask for another.
const signings = createLimiter({ max: 40, windowMs: 10 * 60_000 });
const clientIp = (req) => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?');
// How long a signed live URL may be used to *open* a connection. Probed against the live API on 2026-09-11
// (server/probe-signature.js): `expired` gates the handshake and never cuts an established stream — a stream
// signed to expire in 45 s ran for its full 150 s hold — so this bounds only the window in which a stolen URL
// is worth anything, not the length of a talk.
const LIVE_URL_TTL_S = Number(process.env.LIVE_URL_TTL_SECONDS) || 120;
const LIVE_URL_MAX = 4; // per request: enough for the app to hold a couple in reserve, not enough to stockpile
const UPDATES_DIR = path.join(DATA_DIR, 'updates');
fs.mkdirSync(UPDATES_DIR, { recursive: true });
const WEB_DIR = path.join(__dirname, '..', 'web');
const SCHEMA_FILE = require.resolve('@subs/core/schema');
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_GB) || 8) * 1024 ** 3;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.wav': 'audio/wav',
};

function log(level, text) {
  const ts = new Date().toISOString().slice(11, 19);
  (level === 'error' ? console.error : console.log)(`${ts} ${level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·'} ${text}`);
}

const db = openDb(DATA_DIR);
const auth = createAuth(db);
const account = createAccount(db, { baseUrl: BASE_URL, log });
const quotas = new Quotas(db);
// A new account request can ping a chat webhook (Discord, Slack and anything that takes {text}/{content}).
// …and/or an email from the operator's own mailbox (SMTP_HOST/PORT/USER/PASS, MAIL_FROM, NOTIFY_EMAIL in deploy/.env).
const REQUEST_WEBHOOK_URL = (process.env.REQUEST_WEBHOOK_URL || '').trim();
const MAIL = mail.configFromEnv();
function notifyRequest(r) {
  const line = `${r.name || '(no name)'} <${r.email}> · ${r.org || '(no organisation)'} · plan: ${r.plan || 'not chosen'}`;
  const note = String(r.note || '').trim();
  if (REQUEST_WEBHOOK_URL) {
    const text = ['New account request · ' + line, note, `${BASE_URL}/account`].filter(Boolean).join('\n');
    fetch(REQUEST_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text.slice(0, 1900) }) })
      .then((res) => { if (!res.ok) log('warn', `request webhook: HTTP ${res.status}`); })
      .catch((err) => log('warn', `request webhook: ${err.message}`));
  }
  if (MAIL) {
    const body = ['Someone asked for a See Subtitles account.', '', `Name: ${r.name || '(no name)'}`, `Email: ${r.email}`, `Organisation or event: ${r.org || '(none)'}`, `Plan: ${r.plan || 'not chosen'}`, 'What they will subtitle:', note || '(nothing written)', '', `Handle it under Account › All accounts: ${BASE_URL}/account`, `Create the account with: node server/cli.js add-user ${r.email}`].join('\n');
    mail.sendMail(MAIL, { subject: `See Subtitles: account request from ${r.name || r.email}`, text: body })
      .then(() => log('info', `request emailed to ${MAIL.to}`))
      .catch((err) => log('warn', `request email: ${err.message}`));
  }
}
if (REQUEST_WEBHOOK_URL) log('info', 'account requests are posted to the webhook');
if (MAIL) log('info', `account requests are emailed to ${MAIL.to} via ${MAIL.host}`);
else if (process.env.SMTP_HOST || process.env.NOTIFY_EMAIL) log('warn', 'email is not configured: SMTP_HOST, SMTP_USER, SMTP_PASS and NOTIFY_EMAIL are all needed');
const planRow = (user) => account.userRow(user.id) || { id: user.id, role: 'user', plan: 'hobbyist' };
const entitlements = (user) => quotas.snapshot(planRow(user));
const live = new LiveSessions({ db, dir: path.join(DATA_DIR, 'sessions'), log });
let creds = null;
try { creds = getCredentials(); } catch (err) { log('error', `${err.message} — upload jobs will fail until the Tencent keys are set`); }
const billingCreds = process.env.TENCENT_BILLING_SECRET_ID && process.env.TENCENT_BILLING_SECRET_KEY ? { secretId: process.env.TENCENT_BILLING_SECRET_ID.trim(), secretKey: process.env.TENCENT_BILLING_SECRET_KEY.trim() } : null;
const usage = new UsageMonitor({ creds, billingCreds, pack: parsePack(process.env.TENCENT_PACK), pipeline: process.env.TENCENT_PACK_COVERS === 'all' ? 'all' : 'live', log });
if (process.env.TENCENT_PACK && !usage.pack) log('warn', `TENCENT_PACK "${process.env.TENCENT_PACK}" is not <hours>h@<YYYY-MM-DD>; the dashboard shows usage without the pack`);
const jobs = new JobRunner({
  db, dir: path.join(DATA_DIR, 'jobs'), creds, baseUrl: BASE_URL, log, tokenhubKey: (process.env.TOKENHUB_API_KEY || '').trim(), model: process.env.TRANSLATION_MODEL || process.env.HUNYUAN_MODEL || '', ffmpeg: process.env.FFMPEG || 'ffmpeg', ffprobe: process.env.FFPROBE || 'ffprobe',
  dashscopeKey: process.env.DASHSCOPE_API_KEY || '', dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || undefined,
  ...(Number(process.env.UPLOAD_IDLE_MS) > 0 ? { uploadIdleMs: Number(process.env.UPLOAD_IDLE_MS) } : {}),
  // the plan's file hours: refuse a file that does not fit in what is left this month, otherwise count it
  onDuration: (job, seconds) => {
    const row = account.userRow(job.user_id); if (!row) return;
    const left = quotas.remaining(row, 'file');
    if (left < seconds) throw new Error(`this file is ${Math.ceil(seconds / 60)} min; ${Math.floor(left / 60)} min of file subtitling remain in the ${quotas.snapshot(row).name} plan this month`);
    quotas.add(row.id, 'file', seconds);
  },
});
log('info', `clean transcripts ready for ${jobs.backfillPlainExports()} existing jobs`);
log('info', `accounts: sign-up ${SIGNUP_MODE}`);
// The Team page is for administrators. ADMIN_EMAIL names one; otherwise, while no account is an administrator, the
// first account created becomes one (a closed server has exactly the operator's account).
function ensureAdmin() {
  const wanted = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const admins = db.all("SELECT email FROM users WHERE role = 'admin'").map((u) => u.email);
  if (wanted && !admins.includes(wanted)) { const r = db.run("UPDATE users SET role = 'admin' WHERE email = ?", wanted); if (r.changes) log('info', `administrator: ${wanted} (ADMIN_EMAIL)`); else log('warn', `ADMIN_EMAIL ${wanted} has no account yet`); }
  else if (!admins.length) { const first = db.get('SELECT email FROM users ORDER BY id LIMIT 1'); if (first) { db.run("UPDATE users SET role = 'admin' WHERE email = ?", first.email); log('info', `administrator: ${first.email} (first account)`); } }
}
ensureAdmin();
log(jobs.backend === 'tokenhub' ? 'info' : 'warn', `translation backend: ${jobs.backend} (${jobs.model})${jobs.backend === 'hunyuan-legacy' ? ' — the standalone Hunyuan API stops on 2026-09-30; set TOKENHUB_API_KEY' : ''}`);
log(jobs.dashscopeKey ? 'info' : 'warn', jobs.dashscopeKey ? `file recognition: ${Object.entries(require('./lib/dashscope').MODELS).map(([l, m]) => `${l} at 百炼 ${m}`).join(', ')}, the rest at Tencent` : 'file recognition: every language at Tencent — set DASHSCOPE_API_KEY for 百炼 (Japanese hears far better there)');
const jobClients = new Map(); // job id -> Set<res>
jobs.on('update', (j) => {
  const set = jobClients.get(j.id);
  if (!set) return;
  const payload = `event: job\ndata: ${JSON.stringify(j)}\n\n`;
  for (const res of set) res.write(payload);
});

// ------------------------------------------------------------------ helpers
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const fail = (res, code, error, extra) => send(res, code, { error, ...(extra || {}) });
/** A machine-readable code for the auth messages the pages translate (see web/locales.js err.*). */
const errCode = (message) => (/closed/.test(message) ? 'signup_closed' : /invite/.test(message) ? 'bad_invite' : /already exists/.test(message) ? 'email_exists' : /at least 8/.test(message) ? 'password_short' : /invalid email/.test(message) ? 'bad_email' : undefined);
function readJson(req, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > limit) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
function serveFile(req, res, file, download) {
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', MIME['.txt']);
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (download) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  return fs.createReadStream(file).pipe(res);
}
function page(res, name, extra = {}) {
  return send(res, 200, fs.readFileSync(path.join(WEB_DIR, name)), MIME['.html'], extra);
}
function redirect(res, to) { res.writeHead(302, { location: to }); res.end(); }
const sse = (res) => { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' }); res.write(':ok\n\n'); };

// ------------------------------------------------------------------ routes
async function api(req, res, url, user) {
  const p = url.pathname;
  const m = (re) => re.exec(p);
  let r;

  // public
  if (p === '/api/config') return send(res, 200, { signup: SIGNUP_MODE, baseUrl: BASE_URL });
  if (p === '/api/desktop/version') {
    const rel = latestRelease(UPDATES_DIR);
    return send(res, 200, rel ? { version: rel.version, releaseDate: rel.releaseDate, dmg: rel.dmg ? `${BASE_URL}/updates/${encodeURIComponent(rel.dmg)}` : null, zip: rel.zip ? `${BASE_URL}/updates/${encodeURIComponent(rel.zip)}` : null } : { version: null });
  }
  if (p === '/api/login' && req.method === 'POST') {
    const body = await readJson(req, 1e4);
    const kind = body.kind === 'bearer' ? 'bearer' : 'cookie';
    const email = String(body.email || '').trim().toLowerCase();
    if (!attempts.allow(`ip:${clientIp(req)}`) || !attempts.allow(`email:${email}`)) return fail(res, 429, 'too many attempts; try again in a few minutes', { code: 'rate_limited' });
    const out = auth.login(email, body.password, kind, body.label || req.headers['user-agent'], { code: body.code });
    if (!out) return fail(res, 401, 'wrong email or password', { code: 'bad_login' });
    if (out.totpRequired) return fail(res, 401, 'enter the 6-digit code from your authenticator app', { code: 'totp_required' });
    if (out.totpBad) return fail(res, 401, 'that code is not right — try again, or use one of your recovery codes', { code: 'totp_bad' });
    log('info', `login ${out.user.email} (${kind})`);
    const extra = kind === 'cookie' ? { 'set-cookie': auth.cookieHeader(out.token, SECURE) } : {};
    return send(res, 200, { ok: true, user: out.user, token: kind === 'bearer' ? out.token : (body.token ? out.token : undefined) }, undefined, extra);
  }
  if (p === '/api/signup' && req.method === 'POST') {
    const body = await readJson(req, 1e4);
    if (!attempts.allow(`ip:${clientIp(req)}`)) return fail(res, 429, 'too many attempts; try again in a few minutes', { code: 'rate_limited' });
    let created;
    try { created = auth.signup(body.email, body.password, { mode: SIGNUP_MODE, invite: body.invite }); } catch (err) { return fail(res, SIGNUP_MODE === 'closed' ? 403 : 400, err.message, { code: errCode(err.message) }); }
    const kind = body.kind === 'bearer' ? 'bearer' : 'cookie';
    const token = auth.issueToken(created.id, kind, body.label || req.headers['user-agent']);
    log('info', `sign-up ${created.email} (${SIGNUP_MODE}${body.invite ? ', invite' : ''}, ${kind})`);
    ensureAdmin();
    return send(res, 200, { ok: true, user: created, token: kind === 'bearer' ? token : undefined }, undefined, kind === 'cookie' ? { 'set-cookie': auth.cookieHeader(token, SECURE) } : {});
  }
  if ((r = m(/^\/api\/d\/([a-z0-9]+)\/stream$/))) {
    if (!live.subscribe(r[1], req, res, schema.defaults())) return fail(res, 404, 'no such session');
    return undefined;
  }
  if (p === '/api/languages') return send(res, 200, { sources: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.label])), targets: TARGETS });
  if (p === '/api/request-account' && req.method === 'POST') {
    if (!attempts.allow(`ip:${clientIp(req)}`)) return fail(res, 429, 'too many attempts; try again in a few minutes');
    const body = await readJson(req, 1e4);
    try { const r = account.requestAccount(body); notifyRequest(body); return send(res, 200, { ok: true, ...r }); } catch (err) { return fail(res, 400, err.message); }
  }
  if ((r = m(/^\/api\/reset\/([A-Za-z0-9_-]+)$/)) && req.method === 'GET') { const info = account.resetInfo(r[1]); return info ? send(res, 200, { ok: true, email: info.email }) : fail(res, 404, 'this reset link is invalid or has expired'); }
  if (p === '/api/reset' && req.method === 'POST') {
    if (!attempts.allow(`ip:${clientIp(req)}`)) return fail(res, 429, 'too many attempts; try again in a few minutes');
    const body = await readJson(req, 1e4);
    try { return send(res, 200, { ok: true, email: account.resetPassword(body.token, body.password) }); } catch (err) { return fail(res, 400, err.message); }
  }

  if (!user) return fail(res, 401, 'login required');

  if (p === '/api/me') { const u = account.userRow(user.id) || {}; return send(res, 200, { user: { id: user.id, email: user.email, role: u.role === 'admin' ? 'admin' : 'user', created_at: u.created_at || null }, plan: entitlements(user), baseUrl: BASE_URL, creds: !!creds, signup: SIGNUP_MODE }); }
  // the desktop app reports the seconds its live subtitles ran; the answer carries the plan so the app can stop at the limit
  if (p === '/api/usage/live' && req.method === 'POST') { const body = await readJson(req, 1e3); quotas.add(user.id, 'live', Math.min(3600, Math.max(0, Number(body.seconds) || 0))); return send(res, 200, { ok: true, plan: entitlements(user) }); }
  if (p === '/api/usage') return send(res, 200, await usage.snapshot());
  // account
  if (p === '/api/account/password' && req.method === 'POST') { const body = await readJson(req, 1e4); try { account.changePassword(user, body.current, body.next); return send(res, 200, { ok: true }); } catch (err) { return fail(res, 400, err.message); } }
  if (p === '/api/account/totp' && req.method === 'GET') return send(res, 200, auth.totpStatus(user.id));
  if (p === '/api/account/totp/begin' && req.method === 'POST') { try { return send(res, 200, { ok: true, ...auth.beginTotp(user.id) }); } catch (err) { return fail(res, 400, err.message); } }
  if (p === '/api/account/totp/confirm' && req.method === 'POST') { const body = await readJson(req, 1e4); try { return send(res, 200, { ok: true, ...auth.confirmTotp(user.id, body.code) }); } catch (err) { return fail(res, 400, err.message); } }
  if (p === '/api/account/totp/disable' && req.method === 'POST') { const body = await readJson(req, 1e4); try { auth.disableTotp(user.id, body.password); return send(res, 200, { ok: true }); } catch (err) { return fail(res, 400, err.message); } }
  if (p === '/api/account/totp/recovery' && req.method === 'POST') { const body = await readJson(req, 1e4); try { return send(res, 200, { ok: true, codes: auth.regenerateRecovery(user.id, body.password) }); } catch (err) { return fail(res, 400, err.message); } }
  if (p === '/api/account/tokens' && req.method === 'GET') return send(res, 200, account.listTokens(user));
  if (p === '/api/account/tokens/revoke' && req.method === 'POST') { const body = await readJson(req, 1e4); return send(res, 200, { ok: true, revoked: account.revokeTokens(user, { id: body.id, all: !!body.all }) }); }
  // team (Enterprise): the owner adds members, hands them a set-password link, sees their hours
  if (p === '/api/org' && req.method === 'GET') return send(res, 200, account.teamView(user.id));
  if (p === '/api/org/name' && req.method === 'POST') { const body = await readJson(req, 1e4); try { account.setTeamName(user.id, body.name); return send(res, 200, { ok: true }); } catch (err) { return fail(res, 400, err.message); } }
  if (p === '/api/org/members' && req.method === 'POST') { const body = await readJson(req, 1e4); try { return send(res, 200, { ok: true, ...account.addMember(user.id, body.email) }); } catch (err) { return fail(res, 400, err.message); } }
  if ((r = m(/^\/api\/org\/members\/(\d+)\/reset$/)) && req.method === 'POST') { try { return send(res, 200, { ok: true, ...account.memberReset(user.id, r[1]) }); } catch (err) { return fail(res, 400, err.message); } }
  if ((r = m(/^\/api\/org\/members\/(\d+)$/)) && req.method === 'DELETE') { try { account.removeMember(user.id, r[1]); return send(res, 200, { ok: true }); } catch (err) { return fail(res, 400, err.message); } }
  if (p === '/api/requests/pending' && req.method === 'GET') { if (!account.isAdmin(user)) return fail(res, 403, 'administrators only'); return send(res, 200, account.pendingRequests()); }
  if (p === '/api/glossary' && req.method === 'GET') return send(res, 200, account.getGlossary(user.id));
  if (p === '/api/glossary' && req.method === 'PUT') { const body = await readJson(req, 2e5); try { return send(res, 200, account.putGlossary(user.id, body.items)); } catch (err) { return fail(res, 400, err.message); } }
  // team (administrators)
  if (p.startsWith('/api/team')) {
    if (!account.isAdmin(user)) return fail(res, 403, 'administrators only');
    try {
      if (p === '/api/team' && req.method === 'GET') return send(res, 200, { ...account.team(), plans: PLANS });
      if (p === '/api/team/invites' && req.method === 'POST') return send(res, 200, { ok: true, code: account.createInvite(user.id) });
      if ((r = m(/^\/api\/team\/invites\/([A-Za-z0-9_-]+)$/)) && req.method === 'DELETE') { account.deleteInvite(r[1]); return send(res, 200, { ok: true }); }
      if ((r = m(/^\/api\/team\/users\/(\d+)\/role$/)) && req.method === 'POST') { const body = await readJson(req, 1e4); account.setRole(user, Number(r[1]), body.role); return send(res, 200, { ok: true }); }
      if ((r = m(/^\/api\/team\/users\/(\d+)\/plan$/)) && req.method === 'POST') { const body = await readJson(req, 1e4); account.setPlan(Number(r[1]), body.plan); return send(res, 200, { ok: true }); }
      if ((r = m(/^\/api\/team\/users\/(\d+)\/reset$/)) && req.method === 'POST') return send(res, 200, { ok: true, ...account.createReset(Number(r[1])) });
      if ((r = m(/^\/api\/team\/requests\/(\d+)\/handled$/)) && req.method === 'POST') { account.handleRequest(Number(r[1]), user.id); return send(res, 200, { ok: true }); }
    } catch (err) { return fail(res, 400, err.message); }
  }
  // The live pipeline, without ever handing out a key. The server signs one WebSocket URL per connection and
  // returns only the finished wss:// address; the app opens it straight to Tencent, so the audio path is
  // untouched and nothing is proxied. Every issue is a chance to check the plan, which is what makes the live
  // quota an actual limit rather than something the app is asked to respect.
  if (p === '/api/desktop/live-url' && req.method === 'POST') {
    if (!creds) return fail(res, 503, 'the server has no Tencent keys configured');
    // A direct connection cannot be metered, so it is offered only to accounts that pay the Tencent bill —
    // administrators. For everyone else the audio goes through /api/desktop/live, where it is counted.
    if (!entitlements(user).limits.directLive) {
      return fail(res, 403, 'this account connects through the subtitle server, not directly', { code: 'not_trusted' });
    }
    const body = await readJson(req, 2e5);
    const source = String(body.source || '');
    const target = String(body.target || '');
    if (!schema.LIVE_PAIRS[source]) return fail(res, 400, `"${source}" is not a spoken language 实时语音翻译 accepts`, { code: 'bad_language' });
    if (!schema.targetsFor(source).includes(target)) return fail(res, 400, `${source} → ${target} is not a pair 实时语音翻译 accepts`, { code: 'bad_language' });
    if (quotas.remaining(planRow(user), 'live') <= 0) return fail(res, 403, 'the live subtitle hours of this month are used up', { code: 'plan_quota' });
    if (!signings.allow(`live:${user.id}`)) {
      log('warn', `signing rate limit hit by ${user.email} — far more connections than a talk needs`);
      return fail(res, 429, 'too many connection requests; try again in a few minutes', { code: 'rate_limited' });
    }
    const transModel = ['hunyuan-translation-lite', 'hunyuan-translation'].includes(body.transModel) ? body.transModel : 'hunyuan-translation-lite';
    const tuning = recognitionParams(body.tuning && typeof body.tuning === 'object' ? body.tuning : {});
    const count = Math.min(LIVE_URL_MAX, Math.max(1, Math.round(Number(body.count) || 1)));
    const now = Math.floor(Date.now() / 1000);
    const urls = [];
    for (let i = 0; i < count; i++) {
      const conn = buildConnection(creds, { source, target, transModel, extra: { ...tuning, expired: now + LIVE_URL_TTL_S } });
      urls.push({ url: conn.url, voiceId: conn.voiceId, expiresAt: (now + LIVE_URL_TTL_S) * 1000 });
    }
    log('info', `signed ${count} live URL${count === 1 ? '' : 's'} for ${user.email} (${source}→${target}, good for ${LIVE_URL_TTL_S} s)`);
    return send(res, 200, { urls, expiresIn: LIVE_URL_TTL_S });
  }
  // Summaries, without the TokenHub key leaving either. The desktop points the Anthropic SDK at this path
  // and authenticates as itself; the server adds its own key and streams the answer straight back, so a
  // long summary still arrives token by token rather than waiting on one large response.
  if (p === '/api/desktop/tokenhub/v1/messages' && req.method === 'POST') {
    if (!entitlements(user).limits.summaries) return fail(res, 403, 'AI summaries are not in this plan', { code: 'plan_summaries' });
    const key = (process.env.TOKENHUB_API_KEY || '').trim();
    if (!key) return fail(res, 503, 'the server has no TokenHub key configured');
    const body = JSON.stringify(await readJson(req, 3e7)); // a whole transcript, so generous
    let upstream;
    try {
      upstream = await fetch('https://tokenhub.tencentmaas.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          ...(req.headers['anthropic-version'] ? { 'anthropic-version': req.headers['anthropic-version'] } : {}),
        },
        body,
      });
    } catch (err) {
      return fail(res, 502, `the summary service could not be reached: ${err.message}`);
    }
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    });
    if (!upstream.body) return res.end();
    const { Readable } = require('node:stream');
    Readable.fromWeb(upstream.body).pipe(res);
    return;
  }
  // A learning summary made here: the iOS app sends a recording's cues and reads the Markdown as it is written.
  // The prompt is core/summary.js, the same one the Mac uses; the key never leaves this process.
  if (p === '/api/summaries' && req.method === 'POST') {
    if (!entitlements(user).limits.summaries) return fail(res, 403, 'AI summaries are not in this plan', { code: 'plan_summaries' });
    const key = (process.env.TOKENHUB_API_KEY || '').trim();
    if (!key) return fail(res, 503, 'the server has no TokenHub key configured', { code: 'no_key' });
    const body = await readJson(req, 1e7);
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); }); // the client gave up: stop paying for the answer
    sse(res);
    const event = (name, data) => { try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* going away */ } };
    const beat = setInterval(() => { try { res.write(':\n\n'); } catch { /* going away */ } }, 15_000); // a thinking model is silent for a while
    try {
      const out = await summaries.summarise(body, {
        key, signal: abort.signal,
        baseUrl: process.env.TOKENHUB_BASE_URL || undefined,
        model: process.env.SUMMARY_MODEL || undefined,
        effort: process.env.SUMMARY_EFFORT || undefined,
        onStage: (stage) => event('stage', { stage }),
        onDelta: (text) => event('delta', { text }),
      });
      log('info', `summary for ${user.email}: ${out.meta.cues} cues → ${out.meta.chars} chars, ${out.meta.usage.input}+${out.meta.usage.output} tokens, ${out.meta.seconds} s`);
      event('done', out);
    } catch (err) {
      if (!abort.signal.aborted) { log('warn', `summary for ${user.email} failed: ${err.message}`); event('error', { code: err.code || 'summary_failed', message: err.message }); }
    } finally {
      clearInterval(beat);
      res.end();
    }
    return;
  }
  if (p === '/api/logout' && req.method === 'POST') { auth.revoke(user.token); return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.clearCookie() }); }

  // live sessions
  if (p === '/api/sessions' && req.method === 'GET') return send(res, 200, live.list(user.id).map((s) => ({ ...s, shareUrl: `${BASE_URL || ''}/d/${s.code}` })));
  if (p === '/api/sessions' && req.method === 'POST') {
    if (!entitlements(user).limits.sharing) return fail(res, 403, 'sharing to phones and screens is not in the Hobbyist plan', { code: 'plan_sharing' });
    const body = await readJson(req, 1e4);
    const s = live.create(user.id, body.name);
    return send(res, 200, { ...s, shareUrl: `${BASE_URL || ''}/d/${s.code}` });
  }
  if ((r = m(/^\/api\/sessions\/([a-f0-9]+)\/(events|end|transcript)$/))) {
    const [, id, action] = r;
    if (live.owner(id) !== user.id) return fail(res, 404, 'no such session');
    if (action === 'events' && req.method === 'POST') { const body = await readJson(req, 5e6); return send(res, 200, { ok: true, applied: live.ingest(id, body.events) }); }
    if (action === 'end' && req.method === 'POST') { live.end(id); return send(res, 200, { ok: true }); }
    if (action === 'transcript') {
      const which = url.searchParams.get('plain');
      if (which && !['source', 'target'].includes(which)) return fail(res, 400, 'plain must be source or target');
      return send(res, 200, live.transcript(id, which) || '', MIME['.txt'], { 'content-disposition': `attachment; filename="session-${id}${which ? `-${which}.plain` : ''}.txt"` });
    }
  }

  // jobs
  if (p === '/api/jobs' && req.method === 'GET') return send(res, 200, jobs.list(user.id));
  if (p === '/api/jobs' && req.method === 'POST') {
    const body = await readJson(req, 1e4);
    if (Number(body.size) > MAX_UPLOAD) return fail(res, 413, `file is larger than ${MAX_UPLOAD / 1024 ** 3} GB`);
    if (quotas.remaining(planRow(user), 'file') <= 0) return fail(res, 403, 'the file subtitling hours of this month are used up', { code: 'plan_quota' });
    try { const j = jobs.create(user.id, { filename: body.filename, size: body.size, sourceLang: body.sourceLang, targetLang: body.targetLang }); return send(res, 200, jobs.view(j)); } catch (err) { return fail(res, 400, err.message); }
  }
  if ((r = m(/^\/api\/jobs\/([a-f0-9]+)(?:\/([a-z0-9]+))?$/))) {
    const [, id, action] = r;
    const job = jobs.get(id);
    if (!job || job.user_id !== user.id) return fail(res, 404, 'no such job');
    if (!action && req.method === 'GET') return send(res, 200, jobs.view(job));
    if (!action && req.method === 'DELETE') { try { jobs.remove(id); return send(res, 200, { ok: true }); } catch (err) { return fail(res, 409, err.message); } }
    if (action === 'upload' && req.method === 'PUT') {
      if (job.status !== 'uploading') return fail(res, 409, 'already uploaded');
      const len = Number(req.headers['content-length'] || 0);
      // ?offset=N carries on a file the server already has N bytes of (GET the job: `received`)
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return fail(res, 400, 'offset must be a whole number of bytes');
      if (len + offset > MAX_UPLOAD) { jobs._update(id, { status: 'failed', error: 'file too large' }); return fail(res, 413, 'file too large'); }
      try {
        const bytes = await jobs.uploadStream(job, req, offset);
        log('info', `job ${id}: uploaded ${(bytes / 1e6).toFixed(1)} MB ${job.filename}${offset ? ` (carried on from ${(offset / 1e6).toFixed(1)} MB)` : ''}`);
        return send(res, 200, jobs.view(jobs.get(id)));
      } catch (err) {
        if (err.code === 'upload_offset') return fail(res, 409, err.message, { code: err.code, received: err.received });
        return fail(res, 500, err.message);
      }
    }
    if (action === 'stream') {
      sse(res);
      res.write(`event: job\ndata: ${JSON.stringify(jobs.view(job))}\n\n`);
      let set = jobClients.get(id);
      if (!set) { set = new Set(); jobClients.set(id, set); }
      set.add(res);
      const hb = setInterval(() => res.write(':hb\n\n'), 15_000);
      req.on('close', () => { clearInterval(hb); set.delete(res); if (!set.size) jobClients.delete(id); });
      return undefined;
    }
    if (action === 'cues' && req.method === 'GET') return send(res, 200, jobs.cues(id) || { cues: [] });
    if (action === 'cues' && req.method === 'PUT') { const body = await readJson(req, 20e6); return send(res, 200, jobs.saveCues(id, body.cues)); }
    if (action === 'mp4' && req.method === 'POST') {
      const body = await readJson(req, 1e4);
      jobs.renderMp4(id, { which: body.which, fontSize: Number(body.fontSize) || undefined }).catch((err) => { log('error', `job ${id} mp4: ${err.message}`); jobs.emit('update', { ...jobs.view(jobs.get(id)), renderError: err.message }); });
      return send(res, 200, { ok: true });
    }
    if (action === 'regenerate' && req.method === 'POST') {
      const body = await readJson(req, 1e4);
      // heard as another language the file is recognised again, which is file time again; a new subtitle language alone is not
      if (body.sourceLang !== job.source_lang && quotas.remaining(planRow(user), 'file') <= 0) return fail(res, 403, 'the file subtitling hours of this month are used up', { code: 'plan_quota' });
      try { return send(res, 200, jobs.view(jobs.regenerate(id, { sourceLang: body.sourceLang, targetLang: body.targetLang }))); } catch (err) { return fail(res, 409, err.message); }
    }
    if (action === 'retry' && req.method === 'POST') { if (job.status !== 'failed') return fail(res, 409, 'job is not failed'); jobs._update(id, { status: 'queued', progress: 0, error: null, task_id: null }); jobs.kick(); return send(res, 200, { ok: true }); }
  }
  return fail(res, 404, 'unknown endpoint');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  let r;
  try {
    // For the deploy script only: answers from inside the container and never through Caddy. Which talks the
    // relay is carrying, so an update can wait for them to end rather than cut them off (deploy/talks.sh).
    if (p === '/internal/talks') {
      if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '')) return fail(res, 404, 'unknown endpoint');
      return send(res, 200, { talks: liveProxy.status() });
    }
    if (p.startsWith('/api/')) return await api(req, res, url, auth.authenticate(req));
    // public
    if ((r = /^\/media\/([a-f0-9]{32})\.mp3$/.exec(p))) {
      const job = db.get('SELECT id FROM jobs WHERE media_token = ?', r[1]);
      return serveFile(req, res, job ? path.join(jobs.jobDir(job.id), 'audio.mp3') : null);
    }
    if (/^\/d\/[a-z0-9]+$/.test(p)) return page(res, 'index.html');
    if ((r = /^\/updates\/([^/]+)$/.exec(p))) {
      const name = path.basename(decodeURIComponent(r[1]));
      return serveFile(req, res, /^[\w.@() -]+$/.test(name) ? path.join(UPDATES_DIR, name) : null, name.endsWith('.dmg'));
    }
    if (p === '/schema.js') return send(res, 200, fs.readFileSync(SCHEMA_FILE), MIME['.js']);
    if (p === '/login') return page(res, 'login.html');
    if (p === '/poster') return page(res, 'poster.html');
    if (/^\/reset\/[A-Za-z0-9_-]+$/.test(p)) return page(res, 'reset.html');
    if (p === '/healthz') return send(res, 200, 'ok', MIME['.txt']);
    // Universal links: lets the iOS app open /d/<code> share links itself, so the Camera's scan of a talk's QR
    // code lands in the app's reader. Apple fetches this file when the app is installed; it grants nothing else.
    if (p === '/.well-known/apple-app-site-association') {
      const appIDs = (process.env.IOS_APP_IDS || '6DZ5Z54SPQ.com.algernonlabs.seesubtitles').split(',').map((v) => v.trim()).filter(Boolean);
      return send(res, 200, { applinks: { details: [{ appIDs, components: [{ '/': '/d/*', comment: 'a talk\'s share link' }] }] } });
    }
    // pages that need a login; the front page is the website for everyone else
    const user = auth.authenticate(req);
    if (p === '/' && !user) return page(res, 'site.html');
    if (p === '/' || p === '/account' || (r = /^\/jobs\/([a-f0-9]+)$/.exec(p))) {
      if (!user) return redirect(res, `/login?next=${encodeURIComponent(p)}`);
      return page(res, p === '/' ? 'app.html' : p === '/account' ? 'account.html' : 'job.html');
    }
    if ((r = /^\/jobs\/([a-f0-9]+)\/versions\/(\d+)\/files\/(.+)$/.exec(p))) {
      if (!user) return fail(res, 401, 'login required');
      const job = jobs.get(r[1]);
      if (!job || job.user_id !== user.id) return fail(res, 404, 'no such job');
      return serveFile(req, res, jobs.versionFile(job.id, r[2], decodeURIComponent(r[3])), url.searchParams.has('download'));
    }
    if ((r = /^\/jobs\/([a-f0-9]+)\/files\/(.+)$/.exec(p))) {
      if (!user) return fail(res, 401, 'login required');
      const job = jobs.get(r[1]);
      if (!job || job.user_id !== user.id) return fail(res, 404, 'no such job');
      const name = path.basename(decodeURIComponent(r[2]));
      const file = name === 'source' ? jobs.sourceFile(job.id) : path.join(jobs.jobDir(job.id), name);
      return serveFile(req, res, file, url.searchParams.has('download'));
    }
    // static assets
    const full = path.join(WEB_DIR, path.normalize(p.slice(1)));
    if (!full.startsWith(WEB_DIR + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory() || full.endsWith('.html')) return send(res, 404, 'not found', MIME['.txt']);
    return send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
  } catch (err) {
    log('error', `${req.method} ${p}: ${err.message}`);
    if (!res.headersSent) fail(res, 500, err.message);
  }
});

// The live pipeline runs through here, so the hours an account uses are measured rather than reported.
// A signed URL cannot be metered: once handed over it opens a stream the server is not part of, cannot see
// and cannot close. Deepgram, AssemblyAI and OpenAI all hand clients an ephemeral token instead of proxying,
// and they can, because their token carries a maximum session duration the *provider* enforces and usage the
// provider attributes back. Tencent's signature carries neither — `expired` gates the handshake and nothing
// else — so a token here is a promise with no one behind it. Measured cost of the extra hop from the box in
// Hong Kong to the Guangzhou edge: 34 ms round trip, against a pipeline that waits a second of silence to
// end a sentence.
// TENCENT_WS_URL and TOKENHUB_BASE_URL point the live pipeline and the summaries at stand-ins. They exist for the
// iOS app's end-to-end tests (ios/e2e), which run this very server on a Mac with no keys; a server carrying real
// talks never sets them, and says so loudly if it does.
const STANDINS = { wsUrl: (process.env.TENCENT_WS_URL || '').trim() || null, tokenhub: (process.env.TOKENHUB_BASE_URL || '').trim() || null };
if (STANDINS.wsUrl || STANDINS.tokenhub) log('warn', `STAND-INS IN USE — recognition: ${STANDINS.wsUrl || 'Tencent'}, TokenHub: ${STANDINS.tokenhub || 'TokenHub'}. This is a test server.`);
const liveProxy = createLiveProxy({ creds, authenticate: (req) => auth.authenticate(req), quotas, planRow, log, env: process.env,
  tokenhubKey: (process.env.TOKENHUB_API_KEY || '').trim(), wsUrl: STANDINS.wsUrl,
  translateUrl: STANDINS.tokenhub ? new URL('/v1/api/translations', STANDINS.tokenhub).href : null,
  ...(Number(process.env.LIVE_METER_MS) > 0 ? { meterMs: Number(process.env.LIVE_METER_MS) } : {}) });
// An upload takes as long as the file and the line need. Node gives a whole request five minutes unless told
// otherwise, which ended every file that needed longer — a 1.3 GB video stopped at 809 MB, 307 s in (2026-09-21).
// What ends a connection is silence (UPLOAD_IDLE_MS), and the sender carries on from what arrived: jobs.uploadStream.
server.requestTimeout = 0;
server.on('upgrade', (req, socket, head) => {
  if (liveProxy.upgrade(req, socket, head)) return;
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  log('info', `listening on http://${HOST}:${PORT}  data=${DATA_DIR}  base=${BASE_URL || '(unset)'}`);
  if (!db.get('SELECT 1 FROM users LIMIT 1')) log('warn', 'no users yet: node server/cli.js add-user <email>');
  jobs.resume();
});
function shutdown() { log('info', 'shutting down'); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => { log('error', `uncaught: ${err.stack || err.message}`); });
process.on('unhandledRejection', (err) => { log('error', `unhandled rejection: ${err && err.stack ? err.stack : err}`); });
