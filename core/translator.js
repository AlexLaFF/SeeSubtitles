'use strict';
// Manages the Tencent 实时语音翻译 WebSocket: paced 200 ms sends, keepalive, auto-reconnect with
// backoff, and a seamless rotation to a fresh connection before the 5-hour cap.
const WebSocket = require('ws');
const { EventEmitter } = require('node:events');
const { buildConnection, resolveMainland, forgetMainland, pinnedOptions, hotwordList } = require('./tencent');
const dns = require('node:dns/promises');

const CHUNK_MS = 200;
const CHUNK_BYTES = 6400;
const SILENCE = Buffer.alloc(CHUNK_BYTES);
const MAX_QUEUE = 5; // ≤ 1 s of audio buffered while (re)connecting
const KEEPALIVE_MS = 4000; // server drops the connection after 6 s without audio
const STABLE_MS = 30_000; // connection older than this resets the backoff
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 10_000];
const ACCOUNT_BACKOFF_MS = 30_000; // auth / billing errors: retry slowly
const ACCOUNT_ERRORS = new Set([6002, 6003, 6004, 6005]);
const ROTATE_GRACE_MS = 5 * 60_000; // wait this long for a sentence boundary before forcing rotation
const DRAIN_MS = 5000; // how long a retiring socket may wait for its `final`

/** Tencent request parameters derived from the tuning options (omitted when at their defaults). */
function recognitionParams(opts) {
  const p = {};
  const hw = hotwordList(opts.hotwords);
  if (hw) p.hotword_list = hw;
  if (opts.vadSilenceTime && Number(opts.vadSilenceTime) !== 1000) p.vad_silence_time = Math.round(Number(opts.vadSilenceTime));
  if (opts.maxSpeakTime && Number(opts.maxSpeakTime) !== 10) p.max_speak_time = Math.round(Number(opts.maxSpeakTime) * 1000);
  if (opts.noiseThreshold && Number(opts.noiseThreshold) !== 0) p.noise_threshold = Number(opts.noiseThreshold);
  if (opts.filterModal && Number(opts.filterModal) !== 0) p.filter_modal = Number(opts.filterModal);
  return p;
}

class TranslationStream extends EventEmitter {
  /**
   * @param {{appid:string, secretId:string, secretKey:string}} creds
   * @param {{source?:string, target?:string, transModel?:string, rotateMs?:number}} [opts]
   */
  constructor(creds, opts = {}) {
    super();
    this.creds = creds;
    this.opts = { source: 'yue', target: 'zh', transModel: 'hunyuan-translation-lite', rotateMs: 290 * 60_000, edge: 'auto', ...opts };
    // edge: 'system' = normal DNS; 'cn' = always connect to the mainland edge (VPN users);
    // 'auto' = system first, switch to mainland after an HTTP 404 from an overseas edge
    this.mainland = { use: this.opts.edge === 'cn', ip: null, resolving: false, bad: [] }; // bad: edge IPs that answered 404
    this.queue = [];
    this.active = null; // socket receiving audio
    this.pending = null; // replacement socket being opened (rotation)
    this.retiring = null; // old socket draining after `end`
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
    this.rotateRetryAt = 0;
    this.accountError = false;
    this.inSentence = false;
    this.seq = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._connect('active');
    this.pacer = setInterval(() => this._tick(), CHUNK_MS);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.pacer);
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
    for (const s of [this.pending, this.active]) this._end(s);
    this.active = this.pending = null;
    this.queue.length = 0;
    this.inSentence = false;
    this._setState('stopped');
  }

  /** Change language/model; takes effect via a graceful rotation (or reconnect). */
  setOptions(patch) {
    Object.assign(this.opts, patch);
    if (this.running) this.reconnect('settings changed');
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
    if (this.active && this.active.authenticated) {
      this._rotate(reason);
    } else {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      for (const s of [this.pending, this.active]) this._end(s);
      this.active = this.pending = null;
      this._connect('active');
    }
  }

  status() {
    const a = this.active;
    return {
      state: this.state,
      stateSince: this.stateSince,
      running: this.running,
      voiceId: a ? a.voiceId : null,
      connectedAt: a ? a.openedAt : null,
      authenticated: !!(a && a.authenticated),
      connects: this.connects,
      reconnects: Math.max(0, this.connects - 1),
      queue: this.queue.length,
      dropped: this.dropped,
      keepalives: this.keepalives,
      lastError: this.lastError,
      retryAt: this.retryAt,
      rotating: !!this.pending,
      rotateAt: a && a.openedAt ? a.openedAt + this.opts.rotateMs : null,
      source: this.opts.source,
      target: this.opts.target,
      transModel: this.opts.transModel,
      tuning: recognitionParams(this.opts),
      edge: this.mainland.use ? `mainland${this.mainland.ip ? ` ${this.mainland.ip}` : ''}` : 'system',
    };
  }

  // ---------------------------------------------------------------- internals

  _connect(role) {
    if (!this.running) return null;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
    if (this.mainland.use && !this.mainland.ip) {
      if (this.mainland.resolving) return null;
      this.mainland.resolving = true;
      if (role === 'active') this._setState('connecting');
      this._systemIps()
        .then((sys) => resolveMainland({ force: this.mainland.bad.length > 0, avoid: [...this.mainland.bad, ...sys] }))
        .then((ip) => { this.mainland.ip = ip; this._log(`using mainland edge ${ip}`); })
        .catch((err) => { this.lastError = { message: err.message }; this._log(`✖ ${err.message}`); })
        .finally(() => {
          this.mainland.resolving = false;
          if (!this.running) return;
          if (this.mainland.ip) this._connectNow(role);
          else if (role === 'active') this._scheduleReconnect('mainland DNS lookup failed');
          else this.rotateRetryAt = Date.now() + 60_000;
        });
      return null;
    }
    return this._connectNow(role);
  }

  async _systemIps() {
    try { return (await dns.resolve4('asr.cloud.tencent.com')); } catch { return []; }
  }

  _connectNow(role) {
    let conn;
    try {
      conn = buildConnection(this.creds, { ...this.opts, extra: recognitionParams(this.opts) });
    } catch (err) {
      this.lastError = { message: err.message };
      this._log(`✖ cannot build connection: ${err.message}`);
      if (role === 'active') this._scheduleReconnect(err.message);
      return null;
    }
    const sock = { id: ++this.seq, role, ws: null, voiceId: conn.voiceId, open: false, authenticated: false, openedAt: null, ended: false, sent: 0, streamMs: 0, timeOffset: null };
    this.connects++;
    // opts.wsUrl lets tests point at a local mock server instead of Tencent
    const url = this.opts.wsUrl ? `${this.opts.wsUrl}${this.opts.wsUrl.includes('?') ? '&' : '?'}voice_id=${conn.voiceId}` : conn.url;
    const ws = new WebSocket(url, { handshakeTimeout: 10_000, ...pinnedOptions(this.mainland.use ? this.mainland.ip : null) });
    sock.ws = ws;
    if (role === 'active') {
      this.active = sock;
      this._setState('connecting');
    } else {
      this.pending = sock;
    }
    this._log(`#${sock.id} connecting (${role}) ${this.opts.source}→${this.opts.target} ${this.opts.transModel} voice_id=${sock.voiceId}`);

    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        let message = `HTTP ${res.statusCode}${text ? ` ${text}` : ''}`;
        if (res.statusCode === 404) {
          if (this.opts.edge === 'auto' && !this.mainland.use) {
            this.mainland.use = true;
            this.attempt = 0;
            message += ' — overseas edge has no route for 实时语音翻译 (VPN?), switching to the mainland edge';
          } else if (this.mainland.use) {
            if (this.mainland.ip && !this.mainland.bad.includes(this.mainland.ip)) this.mainland.bad.push(this.mainland.ip);
            this.mainland.ip = null; // re-resolve, skipping edges that answered 404
            forgetMainland();
            message += this.mainland.bad.length > 2
              ? ' — every edge refuses this appid: check APPID (10 digits, not the account UIN) and that 实时语音翻译 is activated'
              : ` — edge ${this.mainland.bad[this.mainland.bad.length - 1]} has no route; trying another resolver`;
          }
        }
        this.lastError = { message };
        this._log(`✖ #${sock.id} ${message}`);
        // with an 'unexpected-response' listener attached, ws leaves the socket in CONNECTING and
        // never emits 'close' on its own — terminate so the normal close → reconnect path runs
        ws.terminate();
      });
    });
    ws.on('open', () => {
      sock.open = true;
      sock.openedAt = Date.now();
      this._log(`#${sock.id} open`);
      if (sock === this.active) {
        this.lastSentAt = Date.now();
        this._setState('open');
      }
    });
    ws.on('message', (data, isBinary) => { if (!isBinary) this._onMessage(sock, data.toString()); });
    ws.on('error', (err) => {
      if (!this.lastError || !/^HTTP/.test(this.lastError.message)) this.lastError = { message: err.message };
      this._log(`✖ #${sock.id} ${err.message}`);
    });
    ws.on('close', (code, reason) => this._onClose(sock, code, reason.toString()));
    return sock;
  }

  _onMessage(sock, text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return this._log(`#${sock.id} non-JSON message: ${text.slice(0, 120)}`);
    }
    if (msg.code !== 0) {
      this.lastError = { code: msg.code, message: msg.message };
      this._log(`✖ #${sock.id} server error ${msg.code}: ${msg.message}`);
      this.emit('server-error', msg);
      if (ACCOUNT_ERRORS.has(msg.code)) this.accountError = true;
      setTimeout(() => { if (sock.ws.readyState === WebSocket.OPEN) sock.ws.close(1000); }, 1000).unref();
      return;
    }
    if (!sock.authenticated) {
      sock.authenticated = true;
      this.accountError = false;
      this.lastError = null;
      this.mainland.bad = [];
      this._log(`✔ #${sock.id} authenticated`);
      if (sock === this.pending) this._promote(sock);
      else if (sock === this.active) this._setState('ready');
    }
    if (msg.result) {
      const r = msg.result;
      if (sock === this.active) this.inSentence = !r.sentence_end;
      // map the server's stream-relative times to wall-clock using the last chunk sent on this socket
      const off = sock.timeOffset;
      this.emit('result', {
        voiceId: sock.voiceId,
        wallStart: off != null && r.start_time != null ? off + r.start_time : null,
        wallEnd: off != null && r.end_time != null ? off + r.end_time : null,
        sentenceId: msg.sentence_id || r.sentence_id || null,
        sourceText: r.source_text || '',
        targetText: r.target_text || '',
        startTime: r.start_time ?? null,
        endTime: r.end_time ?? null,
        sentenceEnd: !!r.sentence_end,
        source: r.source,
        target: r.target,
      });
    }
    if (msg.final) {
      sock.ended = true;
      this._log(`#${sock.id} final=${msg.final}`);
    }
  }

  _onClose(sock, code, reason) {
    this._log(`#${sock.id} closed code=${code}${reason ? ` ${reason}` : ''}`);
    if (sock === this.retiring) {
      clearTimeout(sock.drainTimer);
      this.retiring = null;
      return;
    }
    if (sock === this.pending) {
      this.pending = null;
      this.rotateRetryAt = Date.now() + 60_000;
      this._log('rotation attempt failed; will retry in 60 s');
      return;
    }
    if (sock === this.active) {
      this.active = null;
      this.inSentence = false;
      if (this.running) this._scheduleReconnect(this.lastError ? this.lastError.message : `closed ${code}`);
    }
  }

  _scheduleReconnect(why) {
    if (!this.running || this.retryTimer) return;
    const delay = this.accountError ? ACCOUNT_BACKOFF_MS : BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.retryAt = Date.now() + delay;
    this._setState('reconnecting');
    this._log(`reconnecting in ${delay} ms (${why})`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._connect('active');
    }, delay);
  }

  _rotate(reason) {
    if (this.pending || !this.running) return;
    this._log(`rotating connection: ${reason}`);
    this._connect('pending');
  }

  _promote(sock) {
    const old = this.active;
    this.pending = null;
    this.active = sock;
    sock.role = 'active';
    this.lastSentAt = Date.now();
    this._setState('ready');
    this._end(old);
    this._log(`#${sock.id} is now active`);
  }

  /** Politely finish a socket: send {"type":"end"}, let the server close it, force-close after DRAIN_MS. */
  _end(sock) {
    if (!sock || sock === this.retiring) return;
    if (this.retiring) {
      try { this.retiring.ws.terminate(); } catch { /* ignore */ }
      clearTimeout(this.retiring.drainTimer);
      this.retiring = null;
    }
    sock.role = 'retiring';
    const ws = sock.ws;
    if (ws.readyState === WebSocket.OPEN) {
      this.retiring = sock;
      try { ws.send(JSON.stringify({ type: 'end' })); } catch { /* ignore */ }
      sock.drainTimer = setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) ws.close(1000);
      }, DRAIN_MS);
      sock.drainTimer.unref();
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  }

  _tick() {
    if (!this.running) return;
    const now = Date.now();
    const sock = this.active;
    if (!sock || !sock.open || sock.ws.readyState !== WebSocket.OPEN) return;
    if (this.attempt && now - sock.openedAt > STABLE_MS) this.attempt = 0;

    // one chunk per tick keeps the rate at 1:1; allow a second one when the queue backs up so
    // timer drift never forces us to drop audio (server tolerates short bursts up to 3:1)
    const n = this.queue.length > 2 ? 2 : Math.min(1, this.queue.length);
    for (let i = 0; i < n; i++) { const item = this.queue.shift(); this._send(sock, item.chunk, item.t0); }
    if (!n && now - this.lastSentAt > KEEPALIVE_MS) {
      this._send(sock, SILENCE, now - CHUNK_MS);
      this.keepalives++;
    }

    if (sock.authenticated && !this.pending && now > this.rotateRetryAt) {
      const age = now - sock.openedAt;
      if (age > this.opts.rotateMs && (!this.inSentence || age > this.opts.rotateMs + ROTATE_GRACE_MS)) {
        this._rotate(`connection is ${Math.round(age / 60_000)} min old`);
      }
    }
  }

  _send(sock, chunk, t0) {
    try {
      sock.ws.send(chunk, { binary: true });
      sock.sent += chunk.length;
      sock.timeOffset = t0 - sock.streamMs; // wall time of this socket's stream position 0
      sock.streamMs += CHUNK_MS;
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

  _log(text) {
    this.emit('log', text);
  }
}

module.exports = { TranslationStream, recognitionParams, CHUNK_BYTES, CHUNK_MS };
