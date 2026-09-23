'use strict';
// Fun-ASR supplies automatic multilingual recognition. The existing split pipeline supplies rolling/final
// Hunyuan translations and its rate-limit fallback. Both credentials remain on the relay server.
const { SplitStream } = require('../../core/split-stream');
const { FunAsrStream } = require('./dashscope-stream');

class MultilingualStream extends SplitStream {
  constructor(opts = {}) {
    super(null, { ...opts, source: 'auto', fetchImpl: opts.fetchImpl || ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })) });
    this.key = opts.dashscopeKey;
    this.retryTimer = null;
  }

  _engine() { return 'fun-asr-realtime'; }
  _tuningKey() { return JSON.stringify([this.opts.target, this.opts.model]); }

  _connect() {
    if (!this.running) return;
    clearTimeout(this.retryTimer);
    const asr = new FunAsrStream({ key: this.key, model: this._engine(),
      vadSilenceTime: 400, url: this.opts.dashscopeUrl });
    const sock = { asr, voiceId: asr.taskId, streamMs: 0, timeOffset: null, openedAt: 0, finals: new Set() };
    this.sock = sock;
    this._setState(this.connects ? 'reconnecting' : 'connecting');
    const current = () => this.running && this.sock === sock;
    const failed = (message) => {
      if (!current()) return;
      this.lastError = { code: 'recognition', message };
      this._closeSock();
      this.rolling = null;
      this._retry(message);
    };
    sock.readyTimer = setTimeout(() => failed('multilingual recognition did not become ready'), 15_000);
    sock.readyTimer.unref?.();
    asr.on('ready', () => {
      if (!current()) return;
      clearTimeout(sock.readyTimer);
      sock.openedAt = Date.now();
      this.connects++;
      this.lastSentAt = Date.now();
      this.lastError = null;
      this._setState('ready');
      this._tick();
    });
    const rowFor = (r) => ({ ...r, voiceId: sock.voiceId,
      wallStart: sock.timeOffset == null ? null : sock.timeOffset + r.startMs,
      wallEnd: sock.timeOffset == null ? null : sock.timeOffset + r.endMs });
    asr.on('partial', (r) => { if (current() && !sock.finals.has(r.index)) this._onPartial(rowFor(r)); });
    asr.on('sentence', (r) => {
      if (!current() || sock.finals.has(r.index)) return;
      sock.finals.add(r.index);
      // Only a few recent IDs are needed to ignore duplicate final events on a long talk.
      if (sock.finals.size > 100) sock.finals.delete(sock.finals.values().next().value);
      this._onSentence(rowFor(r));
    });
    asr.on('error', (err) => failed(err.message));
    asr.on('close', (code) => failed(`multilingual connection closed (${code})`));
    asr.on('finished', () => failed('multilingual recognition session ended'));
    asr.start();
  }

  // Ignore translations completing after stop, reconnect or a target-language change.
  _emit(row, targetText, ended) {
    if (this.running && this.sock?.voiceId === row.voiceId) super._emit(row, targetText, ended);
  }

  push(chunk, meta = {}) {
    if (!this.running) return;
    const t0 = meta.t0 ?? Date.now() - chunk.length / 32;
    this.queue.push({ chunk, t0 });
    if (this.sock?.asr.ready) this._flush();
    // Same bounded reconnect buffer as the other live pipelines.
    while (this.queue.length > 5) this.dropped += this.queue.shift().chunk.length;
  }

  _flush() {
    while (this.queue.length && this.sock?.asr.ready) {
      const item = this.queue.shift();
      this._send(this.sock, item.chunk, item.t0);
    }
  }

  _send(sock, chunk, t0) {
    sock.timeOffset = t0 - sock.streamMs;
    sock.streamMs += chunk.length / 32;
    sock.asr.push(chunk);
    this.lastSentAt = Date.now();
  }

  _tick() {
    const sock = this.sock;
    if (!this.running || !sock?.asr.ready) return;
    if (Date.now() - sock.openedAt > 30_000) this.attempt = 0;
    this._flush();
    if (Date.now() - this.lastSentAt > 5000) {
      this._send(sock, Buffer.alloc(6400), Date.now() - 200);
      this.keepalives++;
    }
  }

  _retry(why) {
    if (!this.running) return;
    const delay = [500, 1000, 2000, 5000, 10000][Math.min(this.attempt++, 4)];
    this._setState('reconnecting');
    this._log(`multilingual recognition reconnecting in ${delay} ms (${why})`);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this._connect(), delay);
    this.retryTimer.unref?.();
  }

  _closeSock() {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    clearTimeout(sock.readyTimer);
    sock.asr.stop();
  }

  stop() {
    clearTimeout(this.retryTimer);
    super.stop();
    this.rolling = null;
  }
}
module.exports = { MultilingualStream };
