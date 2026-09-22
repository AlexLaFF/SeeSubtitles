'use strict';
// Live recognition at Alibaba 百炼 (`fun-asr-realtime` and its siblings), in the shape probe-ab.js's Tencent
// RecognizeStream has: start / push / end / stop, and 'ready', 'partial', 'sentence', 'error', 'close'. It exists
// to answer whether live talks — where nearly all the running cost is — hear as well there for a quarter of the
// price (¥1.19/h against ¥4.80 for 16k_zh_large at the mainland rate). Nothing in the relay uses it yet.
//
// The protocol is DashScope's duplex WebSocket: a run-task instruction, then binary PCM, then finish-task.
// Sentences arrive as `result-generated` events, one per change, with `sentence_end` marking the settled one.
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

const URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const DEFAULT_MODEL = 'fun-asr-realtime';

class FunAsrStream extends EventEmitter {
  /**
   * @param {{key:string, model?:string, lang?:string, vadSilenceTime?:number, vocabularyId?:string, url?:string}} opts
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
        parameters: {
          format: 'pcm', sample_rate: 16000,
          ...(this.opts.lang ? { language_hints: [this.opts.lang] } : {}),
          ...(this.opts.vadSilenceTime ? { max_sentence_silence: Math.round(this.opts.vadSilenceTime) } : {}),
          ...(this.opts.vocabularyId ? { vocabulary_id: this.opts.vocabularyId } : {}),
          semantic_punctuation_enabled: false,
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
      const s = msg.payload && msg.payload.output && msg.payload.output.sentence;
      if (!s || !s.text) return;
      // sentence_id is not always there; a new sentence otherwise starts when the last one ended
      if (s.sentence_id != null) { if (s.sentence_id !== this.lastSentenceId) { this.lastSentenceId = s.sentence_id; this.index++; } }
      else if (!this.open) { this.open = true; this.index++; }
      const row = { index: this.index, startMs: Number(s.begin_time) || 0, endMs: Number(s.end_time) || 0, text: String(s.text) };
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

  stop() { if (this.ws) this.ws.close(); }
}

module.exports = { FunAsrStream, DEFAULT_MODEL };
