'use strict';
// Cloud link: logs the desktop app into the hosted server and mirrors the local pipeline's events
// (settings, lines, clear) to a live session there, so any browser can show the subtitles at /d/<code>.
// Never blocks the local pipeline: events are queued, batched every 250 ms, retried with backoff and
// the queue is bounded (latest settings + the last 200 lines).
const DEFAULT_URL = 'https://seesubtitles.com'; // the hosted server; Settings can override it
const MAX_LINES = 200;
const FLUSH_MS = 250;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000];

class CloudLink {
  constructor({ log } = {}) {
    this.log = log || (() => {});
    this.cfg = { url: DEFAULT_URL, email: '', token: '' };
    this.core = null;
    this.session = null; // {id, code, shareUrl}
    this.queue = [];
    this.pendingSettings = null;
    this.timer = null;
    this.failures = 0;
    this.error = null;
    this.sent = 0;
    this.stopped = false;
    this.onPlan = null; // (plan) → void, whenever a plan snapshot arrives: the live route depends on it
  }

  status() {
    return {
      loggedIn: !!this.cfg.token,
      plan: this.plan || null, // /api/me plan snapshot: limits, what is used this month (null until fetched)
      url: this.cfg.url || null,
      email: this.cfg.email || null,
      session: this.session ? { id: this.session.id, code: this.session.code } : null,
      sessionName: this.session ? this.session.name : null,
      shareUrl: this.session ? this.session.shareUrl : null,
      queued: this.queue.length,
      sent: this.sent,
      error: this.error,
    };
  }

  /** The account's plan and this month's usage; refreshed on attach, every ten minutes and with every usage report. */
  async refreshPlan() {
    if (!this.cfg.token) { this.plan = null; return null; }
    try {
      const me = await this._fetch('/api/me', null, { method: 'GET' });
      this.plan = me && me.plan ? me.plan : null;
      if (this.onPlan) this.onPlan(this.plan);
      this.role = me && me.user ? me.user.role : null;
      if (this.role === 'admin' && this.onPending) { try { this.onPending(await this._fetch('/api/requests/pending', null, { method: 'GET' })); } catch { /* next time */ } }
    } catch (err) { this.log('warn', `plan: ${err.message}`); }
    return this.plan;
  }
  /** Seconds of live subtitles since the last report; the answer carries the plan so the app can stop at the limit. */
  async reportLive(seconds, detail = {}) {
    if (!this.cfg.token) return null;
    const r = await this._fetch('/api/usage/live', { seconds: Math.round(seconds), ...detail });
    if (r && r.plan) { this.plan = r.plan; if (this.onPlan) this.onPlan(this.plan); }
    return this.plan;
  }

  attach(core, cloudCfg) {
    this.core = core;
    this.cfg = { ...this.cfg, ...(cloudCfg || {}) };
    this.stopped = false;
    clearInterval(this.planTimer);
    if (this.cfg.token) { this.refreshPlan(); this.planTimer = setInterval(() => this.refreshPlan(), 10 * 60_000); this.planTimer.unref(); }
    if (this.cfg.token && this.cfg.publish) this.startSession().catch((err) => { this.error = err.message; this.log('warn', err.message); });
  }

  detach() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    clearInterval(this.planTimer);
    this.planTimer = null;
    this.plan = null;
    if (this.session) this.stopSession().catch(() => {});
    this.core = null;
  }

  async _fetch(path, body, { auth = true, method = 'POST' } = {}) {
    if (!this.cfg.url) throw new Error('cloud server URL is not set');
    const headers = { 'content-type': 'application/json' };
    if (auth) {
      if (!this.cfg.token) throw new Error('not logged in');
      headers.authorization = `Bearer ${this.cfg.token}`;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    try {
      const res = await fetch(`${this.cfg.url.replace(/\/$/, '')}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
      if (!res.ok) { const err = new Error((json && json.error) || `${res.status} ${res.statusText}`); err.status = res.status; if (json && json.code) err.code = json.code; throw err; }
      return json;
    } finally { clearTimeout(t); }
  }

  /**
   * A learning summary, written by the server from a recording's cues (POST /api/summaries — the route the iPhone
   * uses, so no model key and no prompt live on this Mac). Resolves with the server's `done` event, { markdown, meta };
   * onStage(stage) and onDelta(text) follow the summary as it is written. No overall timeout: a thinking model is
   * silent for minutes and the server heartbeats every 15 s; `signal` gives it up.
   */
  async summarise(req, { onStage = () => {}, onDelta = () => {}, signal } = {}) {
    if (!this.cfg.url) throw new Error('cloud server URL is not set');
    if (!this.cfg.token) { const e = new Error('not logged in'); e.code = 'summary_login'; throw e; }
    const res = await fetch(`${this.cfg.url.replace(/\/$/, '')}/api/summaries`, {
      method: 'POST', headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' }, body: JSON.stringify(req), signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      const err = new Error((json && json.error) || `${res.status} ${res.statusText}`); err.status = res.status; if (json && json.code) err.code = json.code; throw err;
    }
    // server-sent events: blocks of `event:` + `data:` lines, a blank line between; a bare `:` block is a heartbeat
    let finished = null;
    const block = (b) => {
      const e = /^event: (.+)$/m.exec(b); const d = /^data: (.+)$/m.exec(b);
      if (!e || !d) return;
      const data = JSON.parse(d[1]);
      if (e[1] === 'stage') onStage(data.stage);
      else if (e[1] === 'delta') onDelta(data.text);
      else if (e[1] === 'done') finished = data;
      else if (e[1] === 'error') { const err = new Error(data.message || 'the summary failed'); err.code = data.code || 'summary_failed'; throw err; }
    };
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) { block(buffer.slice(0, i)); buffer = buffer.slice(i + 2); }
    }
    if (buffer.trim()) block(buffer);
    if (!finished) throw new Error('the connection closed before the summary was finished');
    return finished;
  }

  // ---- upload jobs (used by "Re-subtitle this recording")
  createJob({ filename, size, sourceLang, targetLang }) {
    return this._fetch('/api/jobs', { filename, size, sourceLang, targetLang });
  }
  getJob(id) {
    return this._fetch(`/api/jobs/${id}`, null, { method: 'GET' });
  }
  /** Make a job's subtitles again in other languages, from the file the server already has (it keeps the old ones as a version). */
  regenerateJob(id, { sourceLang, targetLang }) {
    return this._fetch(`/api/jobs/${id}/regenerate`, { sourceLang, targetLang });
  }
  deleteJob(id) {
    return this._fetch(`/api/jobs/${id}`, null, { method: 'DELETE' });
  }
  /**
   * Stream a file into a job (PUT). onProgress(bytesSent). No overall timeout: recordings can be hours long; `signal`
   * gives it up. `offset` carries on a file the server already has that much of (getJob: `received`).
   */
  async uploadJob(id, file, onProgress, signal, offset = 0) {
    if (!this.cfg.url) throw new Error('cloud server URL is not set');
    if (!this.cfg.token) throw new Error('not logged in');
    const { Readable } = require('node:stream');
    const fs = require('node:fs');
    let sent = 0;
    // small pieces: each one read is one the connection had room for, which is how the sender tells a slow line from a dead one (lib/uploads.js)
    const src = fs.createReadStream(file, { highWaterMark: 128 * 1024, start: offset });
    src.on('data', (d) => { sent += d.length; if (onProgress) onProgress(sent); });
    const res = await fetch(`${this.cfg.url.replace(/\/$/, '')}/api/jobs/${id}/upload${offset ? `?offset=${offset}` : ''}`, {
      method: 'PUT', duplex: 'half',
      headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/octet-stream' },
      body: Readable.toWeb(src),
      signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) { const err = new Error((json && json.error) || `upload failed: ${res.status} ${res.statusText}`); err.status = res.status; if (json && json.code) err.code = json.code; throw err; }
    return json;
  }
  /** Download one of a job's output files to `dest` (written as dest.part, then renamed). */
  async downloadJobFile(id, name, dest) {
    if (!this.cfg.token) throw new Error('not logged in');
    const fs = require('node:fs');
    const { pipeline } = require('node:stream/promises');
    const { Readable } = require('node:stream');
    const res = await fetch(`${this.cfg.url.replace(/\/$/, '')}/jobs/${id}/files/${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${this.cfg.token}` } });
    if (!res.ok) throw Object.assign(new Error(`download ${name}: ${res.status} ${res.statusText}`), { status: res.status });
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${dest}.part`));
    fs.renameSync(`${dest}.part`, dest);
    return dest;
  }

  _useUrl(url) {
    const clean = String(url || DEFAULT_URL).trim().replace(/\/$/, '') || DEFAULT_URL;
    if (!/^https?:\/\//.test(clean)) throw new Error('server URL must start with http:// or https://');
    this.cfg.url = clean;
    return clean;
  }
  async login(url, email, password, code = '') {
    const clean = this._useUrl(url);
    const r = await this._fetch('/api/login', { email, password, code, kind: 'bearer', label: 'See Subtitles desktop app' }, { auth: false });
    if (!r || !r.token) throw new Error('login did not return a token');
    this.cfg.token = r.token;
    this.cfg.email = email;
    this.error = null;
    this.log('info', `logged in to ${clean} as ${email}`);
    return { url: clean, token: r.token };
  }
  async beginAppleDesktop(url, challenge) {
    this._useUrl(url);
    return this._fetch('/api/apple/desktop/start', { challenge }, { auth: false });
  }
  async claimAppleDesktop(ticket, state, verifier) {
    const r = await this._fetch('/api/apple/desktop/claim', { ticket, state, verifier }, { auth: false });
    if (!r || !r.token || !r.user || !r.user.email) throw new Error('Apple sign-in did not return an account');
    this.cfg.token = r.token;
    this.cfg.email = r.user.email;
    this.error = null;
    return r;
  }
  /** Create an account (the server must be in invite or open sign-up mode) and log in. */
  async signup(url, email, password, invite) {
    const clean = this._useUrl(url);
    const r = await this._fetch('/api/signup', { email, password, invite: invite || '', kind: 'bearer', label: 'See Subtitles desktop app' }, { auth: false });
    if (!r || !r.token) throw new Error('sign-up did not return a token');
    this.cfg.token = r.token;
    this.cfg.email = email;
    this.error = null;
    this.log('info', `account created on ${clean} as ${email}`);
    return { url: clean, token: r.token };
  }
  /**
   * Signed WebSocket URLs, for an account the server trusts to send its audio straight to Tencent. The
   * Tencent key stays on the server; this returns only finished wss:// addresses, each good for a couple of
   * minutes to *open* one connection. Everyone else is refused (code not_trusted) and goes through the server.
   * @returns {Promise<Array<{url:string, voiceId:string, expiresAt:number}>>}
   */
  async liveUrls({ source, target, transModel, tuning, count } = {}) {
    const r = await this._fetch('/api/desktop/live-url', { source, target, transModel, tuning, count });
    return (r && Array.isArray(r.urls)) ? r.urls : [];
  }
  /** Newest published desktop build: {version, dmg, zip} or {version: null}. Public. */
  checkVersion() {
    return this._fetch('/api/desktop/version', null, { method: 'GET', auth: false });
  }

  async startSession(name) {
    if (this.session) return this.session;
    const r = await this._fetch('/api/sessions', { name: name || `Live ${new Date().toLocaleString()}` });
    this.session = { id: r.id, code: r.code, name: name || '', shareUrl: `${this.cfg.url}/d/${r.code}` };
    this.error = null;
    this.failures = 0;
    // seed the session with the current state so a display that opens now is not blank
    if (this.core) {
      const snap = this.core.stateSnapshot();
      this.pendingSettings = snap.settings;
      for (const line of snap.lines) this.queue.push({ ev: 'line', data: line });
    }
    this._schedule();
    this.log('info', `publishing to ${this.session.shareUrl}`);
    return this.session;
  }

  async stopSession() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.queue = [];
    this.pendingSettings = null;
    clearTimeout(this.timer);
    this.timer = null;
    try { await this._fetch(`/api/sessions/${s.id}/end`, {}); } catch (err) { this.log('warn', `ending session: ${err.message}`); }
    this.log('info', 'stopped publishing');
  }

  onEvent(ev, data) {
    if (!this.session || this.stopped) return;
    if (ev === 'settings') { this.pendingSettings = data.settings; }
    else if (ev === 'line') {
      // coalesce partial updates of the same sentence that are still queued
      const i = this.queue.findIndex((q) => q.ev === 'line' && q.data.id === data.id);
      if (i >= 0) this.queue[i] = { ev, data };
      else this.queue.push({ ev, data });
      const lines = this.queue.filter((q) => q.ev === 'line').length;
      if (lines > MAX_LINES) { const j = this.queue.findIndex((q) => q.ev === 'line'); this.queue.splice(j, 1); }
    } else if (ev === 'clear') { this.queue = this.queue.filter((q) => q.ev !== 'line'); this.queue.push({ ev, data: {} }); }
    else return;
    this._schedule();
  }

  _schedule(delay = FLUSH_MS) {
    if (this.timer || !this.session) return;
    this.timer = setTimeout(() => { this.timer = null; this._flush(); }, delay);
  }

  async _flush() {
    if (!this.session || this.stopped) return;
    if (!this.queue.length && !this.pendingSettings) return;
    const batch = this.queue.splice(0, 100);
    const settings = this.pendingSettings;
    this.pendingSettings = null;
    const events = [];
    if (settings) events.push({ ev: 'settings', data: { settings } });
    events.push(...batch);
    try {
      await this._fetch(`/api/sessions/${this.session.id}/events`, { events });
      this.sent += events.length;
      this.failures = 0;
      if (this.error) { this.error = null; this.log('info', 'cloud link recovered'); }
      if (this.queue.length || this.pendingSettings) this._schedule();
    } catch (err) {
      // put the batch back (settings first) and retry later
      this.queue.unshift(...batch);
      if (settings && !this.pendingSettings) this.pendingSettings = settings;
      const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
      this.failures++;
      if (this.failures === 1 || this.failures % 10 === 0) this.log('warn', `mirror failed (${err.message}), retrying in ${delay / 1000} s`);
      this.error = err.message;
      if (/401|403|not logged in/.test(err.message)) { this.log('error', 'cloud rejected the login token; log in again in Settings'); this.session = null; return; }
      this._schedule(delay);
    }
  }
}

module.exports = { CloudLink, DEFAULT_URL };
