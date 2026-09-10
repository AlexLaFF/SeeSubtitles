'use strict';
// The live pipeline when the hosted server runs it. Same shape as TranslationStream — push() audio, listen
// for 'result' — but the socket goes to our own server, which holds the Tencent credentials, opens the real
// stream and meters the audio as it passes. Nothing about the pipeline downstream can tell the difference.
//
// Why the server is in the path at all: an ephemeral token is the usual answer (Deepgram, AssemblyAI and
// OpenAI all mint one rather than proxy) and it works because their token carries a session limit the
// provider enforces. Tencent's signature carries no such thing, so a token here bounds nothing once the
// stream is open. See server/lib/live-proxy.js.
const WebSocket = require('ws');
const { EventEmitter } = require('node:events');

const CHUNK_MS = 200;
const CHUNK_BYTES = 6400;
const SILENCE = Buffer.alloc(CHUNK_BYTES);
const MAX_QUEUE = 5; // ≤ 1 s of audio held while (re)connecting, same as the direct stream
const KEEPALIVE_MS = 4000;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 10_000];
const STABLE_MS = 30_000;

class RemoteTranslationStream extends EventEmitter {
  /**
   * @param {{url:string, token:string}} cloud  the hosted server and this account's bearer token
   * @param {{source?:string, target?:string, transModel?:string}} [opts]
   */
  constructor(cloud, opts = {}) {
    super();
    this.cloud = cloud;
    this.opts = { source: 'yue', target: 'zh', transModel: 'hunyuan-translation-lite', ...opts };
    this.queue = [];
    this.ws = null;
    this.running = false;
    this.state = 'idle';
    this.stateSince = Date.now();
    this.attempt = 0;
    this.connects = 0;
    this.dropped = 0;
    this.keepalives = 0;
    this.lastSentAt = 0;
    this.lastError = null;
    this.retryAt = null;
    this.retryTimer = null;
    this.openedAt = null;
    this.remote = null; // the server's own view of the Tencent connection
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._connect();
    this.pacer = setInterval(() => this._tick(), CHUNK_MS);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.pacer);
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'stop' })); } catch { /* going away */ }
    }
    this._closeSocket();
    this.queue.length = 0;
    this._setState('stopped');
  }

  setOptions(patch) {
    Object.assign(this.opts, patch);
    // languages are in the query string, so they need a new socket; tuning can be sent down the open one
    const relevant = ['source', 'target', 'transModel'];
    if (relevant.some((k) => k in patch)) return this.reconnect('settings changed');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'settings', ...this.opts })); } catch { /* next connection */ }
    }
  }

  /** Queue one 200 ms chunk of 16 kHz mono 16-bit PCM. `meta.t0` = wall-clock ms when the chunk began. */
  push(chunk, meta = {}) {
    if (!this.running) return;
    this.queue.push({ chunk, t0: meta.t0 != null ? meta.t0 : Date.now() - CHUNK_MS });
    if (this.queue.length > MAX_QUEUE) {
      const excess = this.queue.length - MAX_QUEUE;
      this.queue.splice(0, excess);
      this.dropped += excess;
    }
  }

  reconnect(reason = 'manual') {
    if (!this.running) return;
    this._log(`reconnect requested: ${reason}`);
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this._closeSocket();
    this._connect();
  }

  status() {
    const r = this.remote || {};
    return {
      // the operator cares about the pipeline, which is the server's Tencent connection; the socket to the
      // server is reported alongside it rather than in place of it
      state: this.state === 'ready' && r.state ? r.state : this.state,
      stateSince: this.stateSince,
      running: this.running,
      voiceId: r.voiceId || null,
      connectedAt: this.openedAt,
      authenticated: this.state === 'ready',
      connects: this.connects,
      reconnects: Math.max(0, this.connects - 1),
      queue: this.queue.length,
      dropped: this.dropped + (r.dropped || 0),
      keepalives: this.keepalives,
      lastError: this.lastError,
      retryAt: this.retryAt,
      rotating: !!r.rotating,
      rotateAt: r.rotateAt || null,
      source: this.opts.source,
      target: this.opts.target,
      transModel: this.opts.transModel,
      tuning: r.tuning || {},
      edge: r.edge ? `server · ${r.edge}` : 'server',
      viaServer: true,
    };
  }

  // ---------------------------------------------------------------- internals

  _connect() {
    if (!this.running) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
    const base = String(this.cloud.url || '').replace(/^http/, 'ws').replace(/\/$/, '');
    const q = new URLSearchParams({ source: this.opts.source, target: this.opts.target, transModel: this.opts.transModel });
    this.connects++;
    this._setState('connecting');
    const ws = new WebSocket(`${base}/api/desktop/live?${q}`, {
      handshakeTimeout: 10_000,
      headers: { authorization: `Bearer ${this.cloud.token}` },
    });
    this.ws = ws;

    ws.on('unexpected-response', (_req, res) => {
      const why = res.statusCode === 401 ? 'the server rejected this login — log in again in Settings'
        : res.statusCode === 503 ? 'the server has no Tencent keys configured'
          : `HTTP ${res.statusCode}`;
      this.lastError = { message: why };
      this._log(`✖ ${why}`);
      try { ws.terminate(); } catch { /* already gone */ }
    });
    ws.on('open', () => {
      this.openedAt = Date.now();
      this.lastSentAt = Date.now();
      this._log('connected to the subtitle server');
    });
    ws.on('message', (data, isBinary) => { if (!isBinary) this._onMessage(data.toString()); });
    ws.on('error', (err) => {
      if (!this.lastError || !/^HTTP|log in again/.test(this.lastError.message)) this.lastError = { message: err.message };
      this._log(`✖ ${err.message}`);
    });
    ws.on('close', (code, reason) => {
      if (ws !== this.ws) return;
      this.ws = null;
      this._log(`server connection closed${code ? ` (${code})` : ''}${reason && reason.length ? ` ${reason}` : ''}`);
      if (this.running) this._scheduleReconnect(this.lastError ? this.lastError.message : `closed ${code}`);
    });
  }

  _onMessage(text) {
    let msg = null;
    try { msg = JSON.parse(text); } catch { return this._log(`odd message from the server: ${text.slice(0, 120)}`); }
    if (msg.type === 'ready') {
      this.lastError = null;
      this._setState('ready');
      // hotwords and the recognition tuning are not in the query string, so they follow the handshake
      try { this.ws.send(JSON.stringify({ type: 'settings', ...this.opts })); } catch { /* it will close */ }
      return;
    }
    if (msg.type === 'result') return this.emit('result', msg.result);
    if (msg.type === 'status') { this.remote = msg.status; return this.emit('status', this.status()); }
    if (msg.type === 'log') return this._log(`server: ${msg.text}`);
    if (msg.type === 'error') {
      this.lastError = { code: msg.code, message: msg.message };
      this._log(`✖ ${msg.message}`);
      // a plan refusal is not something to retry into: the answer will not change this month
      if (msg.code === 'plan_quota' || msg.code === 'bad_language') this.attempt = BACKOFF_MS.length;
      this.emit('server-error', { code: msg.code, message: msg.message });
    }
  }

  _closeSocket() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try { ws.readyState === WebSocket.OPEN ? ws.close(1000) : ws.terminate(); } catch { /* already gone */ }
  }

  _scheduleReconnect(why) {
    if (!this.running || this.retryTimer) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.retryAt = Date.now() + delay;
    this._setState('reconnecting');
    this._log(`reconnecting in ${delay} ms (${why})`);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this._connect(); }, delay);
  }

  _tick() {
    if (!this.running) return;
    const now = Date.now();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (this.attempt && this.openedAt && now - this.openedAt > STABLE_MS) this.attempt = 0;
    const n = this.queue.length > 2 ? 2 : Math.min(1, this.queue.length);
    for (let i = 0; i < n; i++) { const item = this.queue.shift(); this._send(item.chunk, item.t0); }
    if (!n && now - this.lastSentAt > KEEPALIVE_MS) { this._send(SILENCE, now - CHUNK_MS); this.keepalives++; }
  }

  /**
   * One audio frame: eight bytes of capture time, then the PCM. The timestamp travels with the audio so the
   * server maps results onto *this* machine's clock — the recording's cue times come from it, and the
   * network delay between here and the server must not shift them.
   */
  _send(chunk, t0) {
    const frame = Buffer.allocUnsafe(8 + chunk.length);
    frame.writeDoubleBE(t0, 0);
    chunk.copy(frame, 8);
    try {
      this.ws.send(frame, { binary: true });
      this.lastSentAt = Date.now();
    } catch (err) {
      this._log(`send failed: ${err.message}`);
    }
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.stateSince = Date.now();
    this.emit('status', this.status());
  }

  _log(text) { this.emit('log', text); }
}

module.exports = { RemoteTranslationStream, CHUNK_BYTES, CHUNK_MS };
