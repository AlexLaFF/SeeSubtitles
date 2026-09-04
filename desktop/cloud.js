'use strict';
// Cloud link: logs the desktop app into the hosted server and mirrors the local pipeline's events
// (settings, lines, clear) to a live session there, so any browser can show the subtitles at /d/<code>.
// Never blocks the local pipeline: events are queued, batched every 250 ms, retried with backoff and
// the queue is bounded (latest settings + the last 200 lines).
const MAX_LINES = 200;
const FLUSH_MS = 250;
const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000];

class CloudLink {
  constructor({ log } = {}) {
    this.log = log || (() => {});
    this.cfg = { url: '', email: '', token: '' };
    this.core = null;
    this.session = null; // {id, code, shareUrl}
    this.queue = [];
    this.pendingSettings = null;
    this.timer = null;
    this.failures = 0;
    this.error = null;
    this.sent = 0;
    this.stopped = false;
  }

  status() {
    return {
      loggedIn: !!this.cfg.token,
      url: this.cfg.url || null,
      email: this.cfg.email || null,
      session: this.session ? { id: this.session.id, code: this.session.code } : null,
      shareUrl: this.session ? this.session.shareUrl : null,
      queued: this.queue.length,
      sent: this.sent,
      error: this.error,
    };
  }

  attach(core, cloudCfg) {
    this.core = core;
    this.cfg = { ...this.cfg, ...(cloudCfg || {}) };
    this.stopped = false;
    if (this.cfg.token && this.cfg.publish) this.startSession().catch((err) => { this.error = err.message; this.log('warn', err.message); });
  }

  detach() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
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
      if (!res.ok) throw new Error((json && json.error) || `${res.status} ${res.statusText}`);
      return json;
    } finally { clearTimeout(t); }
  }

  async login(url, email, password) {
    const clean = String(url || '').trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(clean)) throw new Error('server URL must start with http:// or https://');
    this.cfg.url = clean;
    const r = await this._fetch('/api/login', { email, password }, { auth: false });
    if (!r || !r.token) throw new Error('login did not return a token');
    this.cfg.token = r.token;
    this.cfg.email = email;
    this.error = null;
    this.log('info', `logged in to ${clean} as ${email}`);
    return { url: clean, token: r.token };
  }

  async startSession(name) {
    if (this.session) return this.session;
    const r = await this._fetch('/api/sessions', { name: name || `Live ${new Date().toLocaleString()}` });
    this.session = { id: r.id, code: r.code, shareUrl: `${this.cfg.url}/d/${r.code}` };
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

module.exports = { CloudLink };
