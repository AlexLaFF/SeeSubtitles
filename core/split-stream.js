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
const dns = require('node:dns').promises;
const { EventEmitter } = require('node:events');
const { buildRecognition, resolveMainland, forgetMainland, isMainlandEdge, pinnedOptions, hotwordList, HOST } = require('./tencent');

const CHUNK_MS = 200;
const CHUNK_BYTES = 6400;
const SILENCE = Buffer.alloc(CHUNK_BYTES);
const MAX_QUEUE = 5; // ≤ 1 s of audio held while (re)connecting; there is nowhere to send it yet
const KEEPALIVE_MS = 5000; // 实时语音识别 hangs up after 15 s without audio, so never go quiet that long
const STABLE_MS = 30_000; // a connection this old counts as healthy, so the backoff starts over
const BACKOFF_MS = [500, 1000, 2000, 5000, 10_000];
const TRANSLATE_URL = 'https://tokenhub.tencentmaas.com/v1/api/translations';
// A model the account may not use (trial quota spent, postpaid billing off) is refused on every call. Step down
// and stay there: a lesser translation beats a subtitle track with nothing in it. Mirrors server/lib/tokenhub.js.
const NEXT_MODEL = { 'hy-mt2-pro': 'hy-mt2-plus', 'hy-mt2-plus': 'hy-mt2-lite' };
const refused = (status, body) => status === 402 || status === 403
  || /permission_error/.test(String((body && body.error && body.error.type) || ''))
  || /postpaid billing|free trial quota|not enabled/i.test(String((body && body.error && body.error.message) || ''));
// pro takes 60 requests a minute on the account and one talk makes about 45, so a second talk meets its limit
// (429). That minute passes: the line goes to plus at once, and so does everything for the next rateCooldownMs —
// draft and final on one model — before pro is asked again. Mirrors RATE_FALLBACK in server/lib/tokenhub.js.
const RATE_FALLBACK = { 'hy-mt2-pro': 'hy-mt2-plus' };
const rateLimited = (status, body) => status === 429
  || /RPM limit|request rate exceeds/i.test(String((body && body.error && body.error.message) || ''));

const EDGE_TRIES = 3; // mainland connections that may fail in a row before one attempt goes the ordinary way

/**
 * The Guangzhou edge. Outside the mainland, DNS answers with an overseas edge — Singapore, from the Hong Kong
 * server — and recognition reached there is billed 跨境: ¥11.00 an hour for 16k_zh_large against ¥4.80. The
 * resolver asks Chinese DNS with a mainland client subnet and skips whatever ordinary DNS returned; an answer is
 * used only once the edge has shown it is a mainland one, because a lookup that fails falls through to plain DNS.
 */
async function mainlandEdge({ force }) {
  const avoid = await dns.resolve4(HOST).catch(() => []);
  for (let tries = 0; tries < 3; tries++) {
    const ip = await resolveMainland({ force: force || tries > 0, avoid });
    if (await isMainlandEdge(ip)) return ip;
    avoid.push(ip);
    forgetMainland();
  }
  throw new Error(`no edge that serves the mainland (tried ${avoid.join(', ')})`);
}

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
   *          fetchImpl?:Function, urlFor?:Function, resolveEdge?:Function}} [opts]
   *   edge: 'cn' reaches Tencent through the Guangzhou edge (billed as mainland use); anything else uses ordinary DNS.
   */
  constructor(creds, opts = {}) {
    super();
    this.creds = creds;
    this.opts = {
      source: 'yue', target: 'zh', model: 'hy-mt2-pro', rollMs: 900, contextLines: 2,
      vadSilenceTime: 700, maxSpeakTime: 6, edge: 'auto', rateCooldownMs: 20_000, ...opts,
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
    this.modelFallback = null; // {from, to, reason} once a refused model has been stepped down from
    this.rateLimitedUntil = 0; // until then, calls go to RATE_FALLBACK[model]
    this.rateFallbacks = 0; // calls sent to the stand-in because the model was at its limit
    this.lastSentAt = 0;
    this.connectSeq = 0; // the newest connect in progress; an older one that finds itself superseded gives up
    this.resolveEdge = opts.resolveEdge || mainlandEdge;
    this.mainland = { ip: null, failures: 0 }; // failures: connections through it that failed in a row
    this.edge = null; // where the current connection went: 'mainland <ip>', 'overseas' or 'system'
    this.done = []; // settled sentences, newest last — the context the next translation is given
    this.rolling = null; // the sentence being spoken right now
  }

  /** What a caller may show about the connection. A method, as TranslationStream's is: the relay, the route and the
   * app all call `stream.status()`, and a getter here made every one of those throw on a split talk. */
  status() {
    return {
      state: this.state, connects: this.connects, reconnects: Math.max(0, this.connects - 1),
      keyless: !this.creds || !!this.opts.urlFor,
      engine: this._engine(), model: this.opts.model, source: this.opts.source, target: this.opts.target,
      translateCalls: this.calls, translateRetries: this.retries, translateFailures: this.failures,
      keepalives: this.keepalives, droppedBytes: this.dropped, lastError: this.lastError, modelFallback: this.modelFallback,
      transcribing: this._transcribing(),
      rateLimited: Date.now() < this.rateLimitedUntil, rateFallbacks: this.rateFallbacks,
      edge: this.edge,
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

  /**
   * Audio, 16 kHz mono 16-bit PCM, in the chunks the capture produces. `t0` is when it was captured.
   * It goes out the moment it arrives. 实时语音翻译 refuses more than three seconds of audio in one second
   * (error 6000), which is why that pipeline paces its sends; 实时语音识别 has no such rule, and holding a
   * chunk back for the next tick would put about 100 ms between the speaker and every subtitle.
   */
  push(chunk, meta = {}) {
    if (!this.running) return;
    const t0 = meta.t0 != null ? meta.t0 : Date.now() - CHUNK_MS;
    const sock = this.sock;
    if (sock && sock.ws.readyState === WebSocket.OPEN) return this._send(sock, chunk, t0);
    this.queue.push({ chunk, t0 });
    while (this.queue.length > MAX_QUEUE) { this.dropped += this.queue.shift().chunk.length; }
  }

  /** Change language, model or tuning. Anything the connection carries takes a fresh connection. */
  setOptions(next = {}) {
    const before = this._tuningKey();
    for (const [k, v] of Object.entries(next)) if (v !== undefined) this.opts[k] = v;
    if (this.running && this._tuningKey() !== before) this._reconnect('settings changed');
  }

  /**
   * What the recognition connection would actually carry, normalised the way buildRecognition sends it. The app
   * repeats its settings right after the relay's `ready`, with a 0 or '' where an option is unset; compared raw, that
   * looked like a change, and every talk began by throwing its first connection away.
   */
  _tuningKey() {
    const o = this.opts;
    const n = (v) => Number(v) || 0;
    return JSON.stringify([o.source, this._engine(), hotwordList(o.hotwords), Math.round(n(o.vadSilenceTime)),
      n(o.maxSpeakTime), n(o.noiseThreshold), n(o.filterModal)]);
  }

  reconnect(reason = 'manual') { if (this.running) this._reconnect(reason); }

  // ---------------------------------------------------------------- the recognition connection

  _engine() { return this.opts.engine || ENGINE_FOR[this.opts.source] || '16k_zh_large'; }

  /**
   * Subtitles in the language being spoken (普通话 → 简体中文, say): the words recognised are the subtitle. Nothing
   * goes to the translator — a line then settles the moment recognition ends rather than a translation call later,
   * costs nothing to translate, and no model gets the chance to reword what the speaker said.
   */
  _transcribing() { return this.opts.source === this.opts.target; }

  _log(text) { this.emit('log', text); }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('status', this.status());
  }

  async _connect() {
    if (!this.running) return;
    // A connect waits on signing and on finding the mainland edge; a reconnect asked for meanwhile starts another.
    // The older one must then give up, or it opens a second connection that receives no audio and is hung up on
    // fifteen seconds later (4008) — which the relay passes on to the app as an error.
    const seq = ++this.connectSeq;
    const superseded = () => !this.running || seq !== this.connectSeq;
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
      if (superseded()) return;
      this._log(`✖ could not sign a recognition connection: ${err.message}`);
      return this._retry(err.message);
    }
    if (superseded()) return;
    const ip = await this._edgeIp();
    if (superseded()) return;
    const ws = new WebSocket(url, { handshakeTimeout: 10_000, ...pinnedOptions(ip) });
    const sock = { ws, ip, voiceId: voiceId || `v${Date.now()}`, openedAt: 0, authenticated: false, streamMs: 0, timeOffset: null, sent: 0 };
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
      if (sock.ip && !sock.authenticated) this._edgeFailed(sock.ip);
      this._retry(`socket closed ${code}${reason ? ` ${reason}` : ''}`);
    });
  }

  /** The address to pin this connection to, or null for ordinary DNS. */
  async _edgeIp() {
    if (this.opts.edge !== 'cn' || this.opts.wsUrl) { this.edge = 'system'; return null; }
    const m = this.mainland;
    // a talk with subtitles billed 跨境 beats a talk without: after EDGE_TRIES failures in a row, one attempt goes overseas
    if (m.failures && m.failures % EDGE_TRIES === 0) {
      this._log(`✖ the mainland edge failed ${m.failures} connections in a row — this one goes the ordinary way (billed 跨境)`);
      this.edge = 'overseas';
      return null;
    }
    if (!m.ip) {
      m.ip = await this.resolveEdge({ force: m.failures > 0 }).catch((err) => { this._log(`✖ mainland edge: ${err.message}`); return null; });
      if (m.ip) this._log(`using the mainland edge ${m.ip}`);
    }
    this.edge = m.ip ? `mainland ${m.ip}` : 'overseas';
    return m.ip;
  }

  /** A connection through the mainland edge closed before it was ready: look the edge up afresh next time. */
  _edgeFailed(ip) {
    this.mainland.failures++;
    if (this.mainland.ip === ip) { this.mainland.ip = null; forgetMainland(); }
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

  /** Flush whatever arrived while the socket was down, then keep the connection from going quiet. */
  _tick() {
    if (!this.running) return;
    const sock = this.sock;
    const now = Date.now();
    if (!sock || sock.ws.readyState !== WebSocket.OPEN) return;
    if (this.attempt && now - sock.openedAt > STABLE_MS) this.attempt = 0;
    const held = this.queue.length;
    while (this.queue.length) { const item = this.queue.shift(); this._send(sock, item.chunk, item.t0); }
    // silence rather than nothing: this endpoint drops a connection that has sent no audio for 15 s
    if (!held && now - this.lastSentAt > KEEPALIVE_MS) { this._send(sock, SILENCE, now - CHUNK_MS); this.keepalives++; }
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
      if (sock.ip) this.mainland.failures = 0;
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

  /** The lines before this one, which both the draft and the final translation are given. */
  _context(exclude = null) {
    const n = Number(this.opts.contextLines) || 0;
    if (!n) return '';
    return this.done.filter((r) => r !== exclude).slice(-n).map((r) => r.text).join('');
  }

  _onPartial(row) {
    if (!this.rolling || this.rolling.index !== row.index) this.rolling = { index: row.index, lastAt: 0, lastText: '', gen: 0 };
    if (this._transcribing()) return this._emit(row, row.text, false);
    this._emit(row, this.rolling.target, false);
    const now = Date.now();
    if (!this.opts.rollMs || now - this.rolling.lastAt < this.opts.rollMs) return;
    if (row.text === this.rolling.lastText || row.text.length < 4) return;
    this.rolling.lastAt = now;
    this.rolling.lastText = row.text;
    const gen = ++this.rolling.gen;
    const roll = this.rolling;
    // the draft is given the same context as the final will be: translated without it, the draft reads
    // differently, and every line is then rewritten the moment it settles
    this._translate(row.text, { final: false, context: this._context(row) }).then((out) => {
      if (!out || this.rolling !== roll || gen !== roll.gen || roll.settled) return;
      roll.target = out;
      this._emit(row, out, false);
    });
  }

  _onSentence(row) {
    const roll = this.rolling;
    if (roll) roll.settled = true;
    this.rolling = null;
    const context = this._context(row);
    this.done.push(row); // in place before the next sentence starts, so its draft has this line too
    if (this.done.length > 8) this.done.shift();
    if (this._transcribing()) return this._emit(row, row.text, true);
    this._emit(row, roll ? roll.target : '', false); // the settled words, translation to follow
    this._translate(row.text, { final: true, context }).then((out) => {
      this._emit(row, out || (roll && roll.target) || '', true);
    });
  }

  /** One translation. Finals are retried once: a line with no subtitle is worse than one that lands late. */
  async _translate(text, { final = false, context = '' } = {}) {
    const key = (this.opts.tokenhubKey || '').trim();
    if (!key) return '';
    let limited = false; // this call has met the limit itself, so it stays on the stand-in whatever the clock says
    for (let attempt = 0; attempt <= (final ? 1 : 0); attempt++) {
      const base = this.opts.model; // what this call is for — another call may step down meanwhile
      const busy = (limited || Date.now() < this.rateLimitedUntil) && RATE_FALLBACK[base];
      const model = busy || base;
      if (busy) this.rateFallbacks++;
      this.calls++;
      if (attempt) this.retries++;
      try {
        const res = await this.fetch(TRANSLATE_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, text, source: this.opts.source, target: this.opts.target,
            ...(context ? { context } : {}),
          }),
        });
        const body = await res.json();
        if (res.ok && body && body.choices && body.choices[0]) return (body.choices[0].message.content || '').trim();
        const message = (body && body.error && body.error.message) || `HTTP ${res.status}`;
        if (model === base && RATE_FALLBACK[base] && rateLimited(res.status, body)) {
          if (Date.now() >= this.rateLimitedUntil) this._log(`${base} is at its rate limit — ${RATE_FALLBACK[base]} for the next ${Math.round(this.opts.rateCooldownMs / 1000)} s`);
          this.rateLimitedUntil = Date.now() + this.opts.rateCooldownMs;
          limited = true;
          attempt--; // the same line again, on the stand-in, at once
          continue;
        }
        if (refused(res.status, body) && model === base) {
          if (this.opts.model === model && NEXT_MODEL[model]) {
            this.modelFallback = { from: model, to: NEXT_MODEL[model], reason: message.slice(0, 160) };
            this.opts.model = NEXT_MODEL[model];
            this._log(`✖ TokenHub refused ${model} (${message.slice(0, 120)}) — translating with ${this.opts.model} from now on`);
            this.emit('status', this.status());
          }
          // a model that has since been stepped down from is simply asked again on the current one
          if (this.opts.model !== model) { attempt--; continue; }
        }
        if (!final || attempt) { this.failures++; this._log(`✖ translation: ${message.slice(0, 120)}`); }
      } catch (err) {
        if (!final || attempt) { this.failures++; this._log(`✖ translation: ${err.message.slice(0, 120)}`); }
      }
    }
    return '';
  }
}

module.exports = { SplitStream, ENGINE_FOR };
