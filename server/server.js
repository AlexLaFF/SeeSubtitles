#!/usr/bin/env node
'use strict';
// Hosted server: login, live-session mirror (remote displays at /d/<code>), upload → subtitles jobs.
//   PORT (8080) HOST (0.0.0.0) DATA_DIR (../data) BASE_URL (public https URL, needed for long uploads)
//   TENCENT_APPID / TENCENT_SECRET_ID / TENCENT_SECRET_KEY   TMT_REGION (ap-hongkong)   FFMPEG / FFPROBE (binaries; MP4 burn-in needs libass)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, getCredentials, schema } = require('@subs/core');
const { openDb } = require('./lib/db');
const { createAuth } = require('./lib/auth');
const { LiveSessions } = require('./lib/live');
const { JobRunner, ENGINES, TARGETS } = require('./lib/jobs');

loadEnv(path.join(__dirname, '..', '.env'));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const SECURE = /^https:/.test(BASE_URL);
const WEB_DIR = path.join(__dirname, '..', 'web');
const SCHEMA_FILE = require.resolve('@subs/core/schema');
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_GB) || 8) * 1024 ** 3;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.wav': 'audio/wav',
};

function log(level, text) {
  const ts = new Date().toISOString().slice(11, 19);
  (level === 'error' ? console.error : console.log)(`${ts} ${level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·'} ${text}`);
}

const db = openDb(DATA_DIR);
const auth = createAuth(db);
const live = new LiveSessions({ db, dir: path.join(DATA_DIR, 'sessions'), log });
let creds = null;
try { creds = getCredentials(); } catch (err) { log('error', `${err.message} — upload jobs will fail until the Tencent keys are set`); }
const jobs = new JobRunner({ db, dir: path.join(DATA_DIR, 'jobs'), creds, baseUrl: BASE_URL, log, tmtRegion: process.env.TMT_REGION || 'ap-hongkong', ffmpeg: process.env.FFMPEG || 'ffmpeg', ffprobe: process.env.FFPROBE || 'ffprobe' });
log('info', `clean transcripts ready for ${jobs.backfillPlainExports()} existing jobs`);
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
const fail = (res, code, error) => send(res, code, { error });
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
  if (p === '/api/login' && req.method === 'POST') {
    const body = await readJson(req, 1e4);
    const kind = body.kind === 'bearer' ? 'bearer' : 'cookie';
    const out = auth.login(body.email, body.password, kind, body.label || req.headers['user-agent']);
    if (!out) return fail(res, 401, 'wrong email or password');
    log('info', `login ${out.user.email} (${kind})`);
    const extra = kind === 'cookie' ? { 'set-cookie': auth.cookieHeader(out.token, SECURE) } : {};
    return send(res, 200, { ok: true, user: out.user, token: kind === 'bearer' ? out.token : (body.token ? out.token : undefined) }, undefined, extra);
  }
  if ((r = m(/^\/api\/d\/([a-z0-9]+)\/stream$/))) {
    if (!live.subscribe(r[1], req, res, schema.defaults())) return fail(res, 404, 'no such session');
    return undefined;
  }
  if (p === '/api/languages') return send(res, 200, { sources: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.label])), targets: TARGETS });

  if (!user) return fail(res, 401, 'login required');

  if (p === '/api/me') return send(res, 200, { user: { id: user.id, email: user.email }, baseUrl: BASE_URL, creds: !!creds });
  if (p === '/api/logout' && req.method === 'POST') { auth.revoke(user.token); return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.clearCookie() }); }

  // live sessions
  if (p === '/api/sessions' && req.method === 'GET') return send(res, 200, live.list(user.id).map((s) => ({ ...s, shareUrl: `${BASE_URL || ''}/d/${s.code}` })));
  if (p === '/api/sessions' && req.method === 'POST') {
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
      if (len > MAX_UPLOAD) return fail(res, 413, 'file too large');
      try { const bytes = await jobs.uploadStream(job, req); log('info', `job ${id}: uploaded ${(bytes / 1e6).toFixed(1)} MB ${job.filename}`); return send(res, 200, jobs.view(jobs.get(id))); } catch (err) { return fail(res, 500, err.message); }
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
    if (action === 'retry' && req.method === 'POST') { if (job.status !== 'failed') return fail(res, 409, 'job is not failed'); jobs._update(id, { status: 'queued', progress: 0, error: null, task_id: null }); jobs.kick(); return send(res, 200, { ok: true }); }
  }
  return fail(res, 404, 'unknown endpoint');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  let r;
  try {
    if (p.startsWith('/api/')) return await api(req, res, url, auth.authenticate(req));
    // public
    if ((r = /^\/media\/([a-f0-9]{32})\.mp3$/.exec(p))) {
      const job = db.get('SELECT id FROM jobs WHERE media_token = ?', r[1]);
      return serveFile(req, res, job ? path.join(jobs.jobDir(job.id), 'audio.mp3') : null);
    }
    if (/^\/d\/[a-z0-9]+$/.test(p)) return page(res, 'index.html');
    if (p === '/schema.js') return send(res, 200, fs.readFileSync(SCHEMA_FILE), MIME['.js']);
    if (p === '/login') return page(res, 'login.html');
    if (p === '/healthz') return send(res, 200, 'ok', MIME['.txt']);
    // pages that need a login
    const user = auth.authenticate(req);
    if (p === '/' || (r = /^\/jobs\/([a-f0-9]+)$/.exec(p))) {
      if (!user) return redirect(res, `/login?next=${encodeURIComponent(p)}`);
      return page(res, p === '/' ? 'app.html' : 'job.html');
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
