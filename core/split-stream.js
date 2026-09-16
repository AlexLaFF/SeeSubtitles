'use strict';
// The live pipeline in two halves: 实时语音识别 returns the words, and we translate them ourselves with
// 混元翻译 on TokenHub. It stands in for TranslationStream — same start/push/stop, same `result` frames — so
// the relay, the transcript and the recorder do not know which one is running.
//
// Why two halves rather than Tencent's combined stream (docs/LIVE-PIPELINE-MEASUREMENTS.md): a line settles
// about a third of a second sooner, the pipeline never went silent after a network stall where the combined
// stream did, the translation can be a better model with the previous lines as context, and the spoken
// language is no longer limited to the nine 实时语音翻译 allows.
//
// The sentence being spoken is re-translated every rollMs so the caption rolls rather than appearing whole,
// and translated once more when the service settles it. Both calls go to the same model: mixing a fast model
// for the draft with a better one for the final doubles how often a line the audience has already read is
// rewritten.
const WebSocket = require('ws');
const { EventEmitter } = require('node:events');
const { buildRecognition, resolveMainland, pinnedOptions } = require('./tencent');

const CHUNK_MS = 200;
const CHUNK_BYTES = 6400;
const SILENCE = Buffer.alloc(CHUNK_BYTES);
const MAX_QUEUE = 5; // ≤ 1 s of audio buffered while (re)connecting
const KEEPALIVE_MS = 5000; // 实时语音识别 hangs up after 15 s without audio, so never go quiet that long
const STABLE_MS = 30_000; // a connection this old counts as healthy, so the backoff starts over
const BACKOFF_MS = [500, 1000, 2000, 5000, 10_000];
const TRANSLATE_URL = 'https://tokenhub.tencentmaas.com/v1/api/translations';
const TUNING_KEYS = ['hotwords', 'vadSilenceTime', 'maxSpeakTime', 'noiseThreshold', 'filterModal', 'engine'];

/** The recognition engine for a spoken language, unless one was named. 16k_zh_large also hears Cantonese. */
const ENGINE_FOR = {
  yue: '16k_zh_large', zh: '16k_zh_large', zh_en: '16k_zh_en_2.0', en: '16k_en_large', ja: '16k_ja', ko: '16k_ko',
  vi: '16k_vi', ms: '16k_ms', id: '16k_id', fil: '16k_fil', th: '16k_th', pt: '16k_pt', tr: '16k_tr', ar: '16k_ar',
  es: '16k_es', hi: '16k_hi', fr: '16k_fr', de: '16k_de',
};

class SplitStream extends EventEmitter {
  /**
   * @param {{appid:string, secretId:string, secretKey:string}|null} creds  own keys, or null when `urlFor` signs
   * @param {{source?:string, target?:string, engine?:string, model?:string, tokenhubKey?:string, rollMs?:number,
   *          contextLines?:number, hotwords?:string, vadSilenceTime?:number, maxSpeakTime?:number,
   *          noiseThreshold?:number, filterModal?:number, edge?:string, wsUrl?:string,
   *          fetchImpl?:Function, urlFor?:Function}} [opts]
   */
  constructor(creds, opts = {}) {
    super();
    this.creds = creds;
    this.opts = {
      source: 'yue', target: 'zh', model: 'hy-mt2-pro', rollMs: 900, contextLines: 2,
      vadSilenceTime: 700, maxSpeakTime: 6, edge: 'auto', ...opts,
    };
    this.fetch = opts.fetchImpl || ((...a) => fetch(...a));
    this.queue = [];
    this.pacer = null;
    this.sock = null;
    this.running = false;
    this.state = 'idle';
    this.attempt = 0;
    this.connects = 0;
    this.keepalives = 0;
    this.dropped = 0;
    this.calls = 0;
    this.retries = 0;
    this.failures = 0;
    this.lastError = null;
    this.lastSentAt = 0;
    this.mainland = { ip: null, bad: [] };
    this.done = []; // settled sentences, newest last — the context the next translation is given
    this.rolling = null; // the sentence being spoken right now
  }

  /** What a caller may show about the connection. */
  get status() {
    return {
      state: this.state, connects: this.connects, reconnects: Math.max(0, this.connects - 1),
      engine: this._engine(), model: this.opts.model, source: this.opts.source, target: this.opts.target,
      translateCalls: this.calls, translateRetries: this.retries, translateFailures: this.failures,
      keepalives: this.keepalives, droppedBytes: this.dropped, lastError: this.lastError,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._connect();
    this.pacer = setInterval(() => this._tick(), CHUNK_MS);
    this.pacer.unref?.();
  }

  stop() {
    this.running = false;
    clearInterval(this.pacer);
    this.pacer = null;
    this.queue.length = 0;
    this._closeSock(1000, 'stopped');
    this._setState('stopped');
  }

  /** Audio, 16 kHz mono 16-bit PCM, in the chunks the capture produces. `t0` is when it was captured. */
  push(chunk, meta = {}) {
    if (!this.running) return;
    this.queue.push({ chunk, t0: meta.t0 != null ? meta.t0 : Date.now() - CHUNK_MS });
    while (this.queue.length > MAX_QUEUE) { this.dropped += this.queue.shift().chunk.length; }
  }

  /** Change language, model or tuning. Anything the connection carries takes a fresh connection. */
  setOptions(next = {}) {
    const before = { ...this.opts };
    for (const [k, v] of Object.entries(next)) if (v !== undefined) this.opts[k] = v;
    const reconnect = this.opts.source !== before.source
      || TUNING_KEYS.some((k) => this.opts[k] !== before[k]);
    if (this.running && reconnect) this._reconnect('settings changed');
  }

  reconnect(reason = 'manual') { if (this.running) this._reconnect(reason); }

  // ---------------------------------------------------------------- the recognition connection

  _engine() { return this.opts.engine || ENGINE_FOR[this.opts.source] || '16k_zh_large'; }

  _log(text) { this.emit('log', text); }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('status', this.status);
  }

  async _connect() {
    if (!this.running) return;
    this._setState(this.connects ? 'reconnecting' : 'connecting');
    let url = this.opts.wsUrl || null;
    let voiceId = null;
    try {
      if (!url) {
        if (this.opts.urlFor) {
          const [signed] = await this.opts.urlFor({ source: this.opts.source, engine: this._engine(), tuning: this._tuning() });
          url = signed.url; voiceId = signed.voiceId;
        } else {
          const built = buildRecognition(this.creds, { engine: this._engine(), ...this._tuning() });
          url = built.url; voiceId = built.voiceId;
        }
      }
    } catch (err) {
      this._log(`✖ could not sign a recognition connection: ${err.message}`);
      return this._retry(err.message);
    }
    if (this.opts.edge === 'cn' && !this.mainland.ip) {
      this.mainland.ip = await resolveMainland({ bad: this.mainland.bad }).catch(() => null);
    }
    const ws = new WebSocket(url, { handshakeTimeout: 10_000, ...pinnedOptions(this.mainland.ip) });
    const sock = { ws, voiceId: voiceId || `v${Date.now()}`, openedAt: 0, authenticated: false, streamMs: 0, timeOffset: null, sent: 0 };
    this.sock = sock;
    ws.on('open', () => { sock.openedAt = Date.now(); this.connects++; });
    ws.on('unexpected-response', (_req, res) => {
      this._log(`✖ recognition refused: HTTP ${res.statusCode}`);
      try { ws.terminate(); } catch { /* going away */ }
    });
    ws.on('message', (data, isBinary) => { if (!isBinary) this._onMessage(sock, data.toString()); });
    ws.on('error', (err) => this._log(`✖ recognition socket: ${err.message}`));
    ws.on('close', (code, reason) => {
      if (this.sock !== sock) return;
      this.sock = null;
      if (!this.running) return;
      this._retry(`socket closed ${code}${reason ? ` ${reason}` : ''}`);
    });
  }

  _tuning() {
    const { hotwords, vadSilenceTime, maxSpeakTime, noiseThreshold, filterModal } = this.opts;
    return { hotwords, vadSilenceTime, maxSpeakTime, noiseThreshold, filterModal };
  }

  _retry(why) {
    if (!this.running) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this._setState('reconnecting');
    this._log(`reconnecting in ${delay} ms (${why})`);
    setTimeout(() => this._connect(), delay).unref?.();
  }

  _reconnect(reason) {
    this._log(`reconnect requested: ${reason}`);
    this._closeSock(1000, reason);
    this.rolling = null;
    this._connect();
  }

  _closeSock(code, reason) {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    try { sock.ws.close(code, reason); } catch { /* going away */ }
    setTimeout(() => { try { sock.ws.terminate(); } catch { /* gone */ } }, 1000).unref?.();
  }

  _tick() {
    if (!this.running) return;
    const sock = this.sock;
    const now = Date.now();
    if (!sock || sock.ws.readyState !== WebSocket.OPEN) return;
    if (this.attempt && now - sock.openedAt > STABLE_MS) this.attempt = 0;
    const n = this.queue.length > 2 ? 2 : Math.min(1, this.queue.length);
    for (let i = 0; i < n; i++) { const item = this.queue.shift(); this._send(sock, item.chunk, item.t0); }
    // silence rather than nothing: this endpoint drops a connection that has sent no audio for 15 s
    if (!n && now - this.lastSentAt > KEEPALIVE_MS) { this._send(sock, SILENCE, now - CHUNK_MS); this.keepalives++; }
  }

  _send(sock, chunk, t0) {
    try {
      sock.ws.send(chunk, { binary: true });
      sock.sent += chunk.length;
      sock.timeOffset = t0 - sock.streamMs; // wall time of this socket's stream position 0
      sock.streamMs += CHUNK_MS;
      this.lastSentAt = Date.now();
    } catch (err) {
      this._log(`✖ sending audio: ${err.message}`);
    }
  }

  _onMessage(sock, text) {
    let msg = null;
    try { msg = JSON.parse(text); } catch { return this._log(`non-JSON message: ${text.slice(0, 120)}`); }
    if (msg.code !== 0) {
      this.lastError = { code: msg.code, message: msg.message };
      this._log(`✖ recognition error ${msg.code}: ${msg.message}`);
      this.emit('server-error', msg);
      return;
    }
    if (!sock.authenticated) {
      sock.authenticated = true;
      this.lastError = null;
      this._setState('ready');
      this._log(`✔ recognition ready (${this._engine()} → ${this.opts.model})`);
    }
    const r = msg.result;
    if (!r || !r.voice_text_str) return;
    const row = {
      index: r.index,
      startMs: r.start_time ?? null,
      endMs: r.end_time ?? null,
      text: r.voice_text_str,
      wallStart: sock.timeOffset != null && r.start_time != null ? sock.timeOffset + r.start_time : null,
      wallEnd: sock.timeOffset != null && r.end_time != null ? sock.timeOffset + r.end_time : null,
      voiceId: sock.voiceId,
    };
    if (r.slice_type === 2) this._onSentence(row);
    else this._onPartial(row);
  }

  // ---------------------------------------------------------------- translation

  /** The words so far, before any translation: the source track appears without waiting for the subtitle. */
  _emit(row, targetText, ended) {
    this.emit('result', {
      voiceId: row.voiceId,
      sentenceId: `${row.voiceId}:${row.index}`,
      sourceText: row.text,
      targetText: targetText || '',
      startTime: row.startMs,
      endTime: row.endMs,
      wallStart: row.wallStart,
      wallEnd: row.wallEnd,
      sentenceEnd: !!ended,
      source: this.opts.source,
      target: this.opts.target,
    });
  }

  _context() {
    const n = Number(this.opts.contextLines) || 0;
    return n ? this.done.slice(-n).join('') : '';
  }

  _onPartial(row) {
    if (!this.rolling || this.rolling.index !== row.index) this.rolling = { index: row.index, lastAt: 0, lastText: '', gen: 0 };
    this._emit(row, this.rolling.target, false);
    const now = Date.now();
    if (!this.opts.rollMs || now - this.rolling.lastAt < this.opts.rollMs) return;
    if (row.text === this.rolling.lastText || row.text.length < 4) return;
    this.rolling.lastAt = now;
    this.rolling.lastText = row.text;
    const gen = ++this.rolling.gen;
    const roll = this.rolling;
    this._translate(row.text, { final: false }).then((out) => {
      if (!out || this.rolling !== roll || gen !== roll.gen || roll.settled) return;
      roll.target = out;
      this._emit(row, out, false);
    });
  }

  _onSentence(row) {
    const roll = this.rolling;
    if (roll) roll.settled = true;
    this.rolling = null;
    this._emit(row, roll ? roll.target : '', false); // the settled words, translation to follow
    const context = this._context();
    this._translate(row.text, { final: true, context }).then((out) => {
      this.done.push(row.text);
      if (this.done.length > 8) this.done.shift();
      this._emit(row, out || (roll && roll.target) || '', true);
    });
  }

  /** One translation. Finals are retried once: a line with no subtitle is worse than one that lands late. */
  async _translate(text, { final = false, context = '' } = {}) {
    const key = (this.opts.tokenhubKey || '').trim();
    if (!key) return '';
    for (let attempt = 0; attempt <= (final ? 1 : 0); attempt++) {
      this.calls++;
      if (attempt) this.retries++;
      try {
        const res = await this.fetch(TRANSLATE_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.opts.model, text, source: this.opts.source, target: this.opts.target,
            ...(context ? { context } : {}),
          }),
        });
        const body = await res.json();
        if (res.ok && body && body.choices && body.choices[0]) return (body.choices[0].message.content || '').trim();
        const message = (body && body.error && body.error.message) || `HTTP ${res.status}`;
        if (!final || attempt) { this.failures++; this._log(`✖ translation: ${message.slice(0, 120)}`); }
      } catch (err) {
        if (!final || attempt) { this.failures++; this._log(`✖ translation: ${err.message.slice(0, 120)}`); }
      }
    }
    return '';
  }
}

module.exports = { SplitStream, ENGINE_FOR };
