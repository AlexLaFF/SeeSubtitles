'use strict';
const { fromTexts } = require('@subs/core/plain-text');
// Live session mirror: the desktop app posts settings/line/clear events; browsers at /d/<code> follow them over SSE.
// State per session is kept in memory (latest settings + the most recent lines) and every event is appended
// to sessions/<id>.jsonl so a session can be reviewed or exported afterwards.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_LINES = 300;
const INIT_LINES = 50;

class LiveSessions {
  constructor({ db, dir, log }) {
    this.db = db;
    this.dir = dir;
    this.log = log || (() => {});
    this.active = new Map(); // id -> state
    fs.mkdirSync(dir, { recursive: true });
  }

  _state(id) {
    let st = this.active.get(id);
    if (st) return st;
    const row = this.db.get('SELECT * FROM live_sessions WHERE id = ?', id);
    if (!row) return null;
    st = { id, code: row.code, name: row.name, settings: null, lines: [], byId: new Map(), clients: new Set(), live: !row.ended_at, seq: 0, file: path.join(this.dir, `${id}.jsonl`), lastEventAt: row.created_at, peak: row.peak_viewers || 0, total: row.total_viewers || 0 };
    // rebuild the tail of the transcript from the log so a viewer that opens later still sees recent lines
    try {
      const text = fs.readFileSync(st.file, 'utf8');
      const rows = text.split('\n').filter(Boolean).slice(-2000);
      for (const r of rows) { try { const e = JSON.parse(r); this._apply(st, e.ev, e.data, false); } catch { /* skip */ } }
    } catch { /* no log yet */ }
    this.active.set(id, st);
    return st;
  }

  create(userId, name) {
    const id = crypto.randomBytes(8).toString('hex');
    let code;
    for (;;) {
      code = crypto.randomBytes(3).toString('hex').replace(/[^a-z0-9]/g, 'x').slice(0, 6);
      if (!this.db.get('SELECT 1 FROM live_sessions WHERE code = ?', code)) break;
    }
    this.db.run('INSERT INTO live_sessions(id, code, name, user_id, created_at) VALUES (?,?,?,?,?)', id, code, String(name || '').slice(0, 120), userId, Date.now());
    this.log('info', `live session ${id} (${code}) created by user ${userId}`);
    return { id, code };
  }

  byCode(code) {
    const row = this.db.get('SELECT id FROM live_sessions WHERE code = ?', String(code || '').toLowerCase());
    return row ? this._state(row.id) : null;
  }

  owner(id) {
    const row = this.db.get('SELECT user_id FROM live_sessions WHERE id = ?', id);
    return row ? row.user_id : null;
  }

  ingest(id, events) {
    const st = this._state(id);
    if (!st) throw new Error('unknown session');
    let n = 0;
    const out = [];
    for (const e of events || []) {
      if (!e || typeof e.ev !== 'string') continue;
      if (this._apply(st, e.ev, e.data, true)) { out.push(JSON.stringify({ t: Date.now(), ev: e.ev, data: e.data })); n++; }
    }
    // Synchronous append: keeps batches in arrival order (concurrent async appends may complete out of
    // order) and makes transcript() see the event as soon as ingest() returns. Batches are a few KB at most.
    if (out.length) {
      try { fs.appendFileSync(st.file, `${out.join('\n')}\n`); } catch (err) { this.log('error', `session log ${id}: ${err.message}`); }
    }
    st.lastEventAt = Date.now();
    if (n) this.db.run('UPDATE live_sessions SET lines = ? WHERE id = ?', st.byId.size, id);
    return n;
  }

  _apply(st, ev, data, broadcast) {
    if (ev === 'settings') {
      if (!data || typeof data.settings !== 'object') return false;
      st.settings = data.settings;
      if (broadcast) this._broadcast(st, 'settings', { settings: st.settings, changed: [], from: 'desktop' });
      return true;
    }
    if (ev === 'line') {
      if (!data || data.id == null) return false;
      const cur = st.byId.get(data.id);
      if (cur) Object.assign(cur, data);
      else {
        st.byId.set(data.id, data);
        st.lines.push(data);
        if (st.lines.length > MAX_LINES) st.byId.delete(st.lines.shift().id);
      }
      if (broadcast) this._broadcast(st, 'line', cur || data);
      return true;
    }
    if (ev === 'clear') {
      st.lines = [];
      st.byId.clear();
      if (broadcast) this._broadcast(st, 'clear', {});
      return true;
    }
    return false;
  }

  end(id) {
    const st = this._state(id);
    this.db.run('UPDATE live_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL', Date.now(), id);
    if (st) { st.live = false; this._broadcast(st, 'status', this._status(st)); }
  }

  _status(st) {
    return { remote: true, live: st.live, viewers: st.clients.size, peak: st.peak, lastEventAt: st.lastEventAt, stream: { state: st.live ? 'remote' : 'ended' }, now: Date.now() };
  }

  _broadcast(st, ev, data) {
    if (!st.clients.size) return;
    const payload = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of st.clients) res.write(payload);
  }

  /** Attach an SSE viewer to a session found by its share code. */
  subscribe(code, req, res, defaults) {
    const st = this.byCode(code);
    if (!st) return false;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(':ok\n\n');
    st.clients.add(res);
    // every phone that opens the link counts once; the peak is the most that followed at the same time
    st.total += 1;
    st.peak = Math.max(st.peak, st.clients.size);
    this.db.run('UPDATE live_sessions SET peak_viewers = ?, total_viewers = ? WHERE id = ?', st.peak, st.total, st.id);
    const init = { serverId: `remote-${st.id}`, remote: true, session: { code: st.code, name: st.name }, settings: { ...defaults, ...(st.settings || {}) }, lines: st.lines.slice(-INIT_LINES), status: this._status(st) };
    res.write(`event: init\ndata: ${JSON.stringify(init)}\n\n`);
    const hb = setInterval(() => { res.write(':hb\n\n'); }, 15_000);
    const statusTimer = setInterval(() => res.write(`event: status\ndata: ${JSON.stringify(this._status(st))}\n\n`), 5000);
    req.on('close', () => { clearInterval(hb); clearInterval(statusTimer); st.clients.delete(res); });
    return true;
  }

  list(userId) {
    return this.db.all('SELECT id, code, name, created_at, ended_at, lines, peak_viewers, total_viewers FROM live_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', userId)
      .map((r) => ({ ...r, viewers: this.active.has(r.id) ? this.active.get(r.id).clients.size : 0 }));
  }

  transcript(id, plain = null) {
    const st = this._state(id);
    if (!st) return null;
    const rows = [];
    try {
      const text = fs.readFileSync(st.file, 'utf8');
      const byId = new Map();
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          if (e.ev === 'line') { if (byId.has(e.data.id)) Object.assign(byId.get(e.data.id), e.data); else byId.set(e.data.id, { ...e.data }); }
        } catch { /* skip */ }
      }
      if (plain) return fromTexts([...byId.values()].filter(l => l.ended).map(l => plain === 'source' ? l.sourceText : l.targetText));
      for (const l of byId.values()) if (l.ended) rows.push(`${new Date(l.wallStart || 0).toISOString().slice(11, 19)}  ${l.targetText || ''}\n          ${l.sourceText || ''}`);
    } catch { /* none */ }
    return rows.join('\n');
  }
}

module.exports = { LiveSessions };
