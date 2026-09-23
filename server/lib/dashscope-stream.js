'use strict';
// Live recognition at Alibaba 百炼 (`fun-asr-realtime` and its siblings), in the shape probe-ab.js's Tencent
// RecognizeStream has: start / push / end / stop, and 'ready', 'partial', 'sentence', 'error', 'close'. It exists
// to answer whether live talks — where nearly all the running cost is — hear as well there for a quarter of the
// price (¥1.19/h against ¥4.80 for 16k_zh_large at the mainland rate). Nothing in the relay uses it yet.
//
// The protocol is DashScope's duplex WebSocket: a run-task instruction, then binary PCM, then finish-task.
// Sentences arrive as `result-generated` events, one per change, with `sentence_end` marking the settled one.
//
// Two models, two shapes. `fun-asr-realtime` recognises, and is told the language by `language_hints` (or told
// nothing, and decides for itself). `gummy-realtime-v1` recognises *and* translates in the same stream, takes
// `source_language: 'auto'` over 14 languages including Cantonese, and answers with both texts — which is what a
// talk where several people answer each other in different languages needs from one connection.
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

const URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const DEFAULT_MODEL = 'fun-asr-realtime';

class FunAsrStream extends EventEmitter {
  /**
   * @param {{key:string, model?:string, lang?:string, langs?:string[], target?:string, vadSilenceTime?:number,
   *          vocabularyId?:string, semantic?:boolean, url?:string}} opts  `target` turns on gummy's translation
   */
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.key = String(opts.key || '').trim();
    this.model = opts.model || DEFAULT_MODEL;
    this.ws = null;
    this.taskId = crypto.randomUUID();
    this.ready = false;
    this.sent = 0;
    this.dropped = 0;
    this.index = 0;
    this.lastSentenceId = null;
    this.gummy = /^gummy/.test(this.model);
  }

  start() {
    if (!this.key) { this.emit('error', new Error('no DASHSCOPE_API_KEY')); return; }
    const ws = new WebSocket(this.opts.url || URL, { headers: { Authorization: `Bearer ${this.key}` }, handshakeTimeout: 10_000 });
    this.ws = ws;
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { this.emit('error', new Error(`HTTP ${res.statusCode} ${body.replace(/\s+/g, ' ').trim().slice(0, 140)}`)); ws.terminate(); });
    });
    ws.on('open', () => ws.send(JSON.stringify({
      header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio', task: 'asr', function: 'recognition', model: this.model,
        parameters: this.gummy ? {
          format: 'pcm', sample_rate: 16000,
          source_language: this.opts.lang || 'auto', // 'auto' = decide per sentence, which a mixed talk needs
          transcription_enabled: true,
          translation_enabled: !!this.opts.target,
          ...(this.opts.target ? { translation_enabled: true, translation_target_languages: [this.opts.target] } : {}),
          ...(this.opts.vadSilenceTime ? { max_end_silence: Math.round(this.opts.vadSilenceTime) } : {}),
          ...(this.opts.vocabularyId ? { vocabulary_id: this.opts.vocabularyId } : {}),
        } : {
          format: 'pcm', sample_rate: 16000,
          // no hint at all = the service detects the language itself; a list narrows it to the ones expected
          ...(this.opts.langs && this.opts.langs.length ? { language_hints: this.opts.langs }
            : this.opts.lang ? { language_hints: [this.opts.lang] } : {}),
          ...(this.opts.vadSilenceTime ? { max_sentence_silence: Math.round(this.opts.vadSilenceTime) } : {}),
          ...(this.opts.vocabularyId ? { vocabulary_id: this.opts.vocabularyId } : {}),
          // semantic: end a sentence where the meaning ends rather than where the speaker pauses — the cure, if any,
          // for fun-asr running several speakers' turns into one line
          semantic_punctuation_enabled: !!this.opts.semantic,
        },
        input: {},
      },
    })));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg = null;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      const ev = msg.header && msg.header.event;
      if (ev === 'task-started') { this.ready = true; return this.emit('ready'); }
      if (ev === 'task-failed') return this.emit('error', new Error(`${msg.header.error_code || '?'}: ${msg.header.error_message || 'failed'}`));
      if (ev === 'task-finished') return this.emit('finished');
      if (ev !== 'result-generated') return;
      const out = (msg.payload && msg.payload.output) || {};
      // gummy carries the recognised sentence under `transcription`, and its translation beside it
      const s = this.gummy ? out.transcription : out.sentence;
      const translated = this.gummy && Array.isArray(out.translations) ? out.translations[0] : null;
      if (!s || !s.text) return;
      // sentence_id is not always there; a new sentence otherwise starts when the last one ended
      const sentenceId = s.sentence_id ?? s.begin_time;
      if (sentenceId != null) { if (sentenceId !== this.lastSentenceId) { this.lastSentenceId = sentenceId; this.index++; } }
      else if (!this.open) { this.open = true; this.index++; }
      const row = { index: this.index, startMs: Number(s.begin_time) || 0, endMs: Number(s.end_time) || 0, text: String(s.text),
        ...(s.language || s.lang ? { lang: s.language || s.lang } : {}),
        ...(translated && translated.text ? { target: String(translated.text) } : {}) };
      if (s.sentence_end) { this.open = false; this.emit('sentence', row); } else this.emit('partial', row);
    });
    ws.on('error', (err) => this.emit('error', err));
    ws.on('close', (code) => this.emit('close', code));
  }

  push(chunk) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.ready) { this.ws.send(chunk, { binary: true }); this.sent += chunk.length; }
    else this.dropped += chunk.length;
  }

  /** Tell the service the audio is over; it answers 'task-finished' once the last sentence is out. */
  end() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' }, payload: { input: {} } }));
  }

  stop() {
    this.ready = false;
    const ws = this.ws;
    if (!ws) return;
    ws.close();
    setTimeout(() => { if (ws.readyState !== WebSocket.CLOSED) ws.terminate(); }, 1000).unref?.();
  }
}

module.exports = { FunAsrStream, DEFAULT_MODEL };
