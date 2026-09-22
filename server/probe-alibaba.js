#!/usr/bin/env node
'use strict';
// Play one recording into Alibaba 百炼's live recognisers, at speaking pace, on one clock, and write down what
// each of them heard and when — the same shape as probe-ab.js, for a service the app does not yet speak to.
// A shootout, not a port: nothing here is wired into the pipeline.
//
//   node server/probe-alibaba.js talk.mp3 --lang ja --out run1
//   node server/probe-alibaba.js talk.mp3 --lang ja --start 600 --seconds 900 --baseline talk.ja.srt --out run1
//
// Arms (--arms, comma-separated; default all three):
//   fun         fun-asr-realtime            the DashScope inference protocol, run-task / result-generated
//   qwen        qwen3-asr-flash-realtime    the OpenAI-realtime-shaped protocol, at the service's default VAD
//   qwen-soft   the same, with the VAD threshold at 0 — hears the quietest speech it can, at the risk of noise
//
// --baseline is an SRT the app already made of the same recording (its 16k_ja pass); it is merged into the
// side-by-side so the three can be read against what we ship today. --start/--seconds pick a stretch of the
// recording (both in seconds), so a passage with soft speech can be tried without paying for the whole talk.
//
// Needs DASHSCOPE_API_KEY in .env (百炼 › API-Key, 华北2（北京） region). DASHSCOPE_WORKSPACE_ID switches to the
// per-workspace host the 2026 docs show; without it the classic dashscope.aliyuncs.com host is used.
// Billing: per second of audio sent, every arm separately — fun-asr-realtime ¥0.00033/s (¥1.19/h),
// qwen3-asr-flash-realtime about ¥1.12/h; a new account has 36,000 s free per model for 90 days.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { loadEnv } = require('@subs/core');
const PlainText = require('../core/plain-text');

const CHUNK_MS = 200;
const CHUNK_BYTES = 16000 * 2 * (CHUNK_MS / 1000);

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const med = (v) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null; };

function hosts() {
  const ws = (process.env.DASHSCOPE_WORKSPACE_ID || '').trim();
  const region = (process.env.DASHSCOPE_REGION || 'cn-beijing').trim();
  const base = ws ? `wss://${ws}.${region}.maas.aliyuncs.com/api-ws/v1` : 'wss://dashscope.aliyuncs.com/api-ws/v1';
  return { inference: `${base}/inference`, realtime: `${base}/realtime` };
}

/** Shared shape: 'sentence' {startMs, endMs, text, finalAt}, 'partial' {text}, 'ready', 'done', 'error'. */
class Arm extends EventEmitter {
  constructor(id, key, opts) {
    super();
    this.id = id; this.key = key; this.opts = opts;
    this.ws = null; this.rows = []; this.partials = 0; this.sent = 0; this.dropped = 0; this.audioStart = 0;
    this.ready = new Promise((res, rej) => { this.once('ready', res); this.once('error', rej); });
  }
  open(url, headers) {
    const ws = new WebSocket(url, { headers, handshakeTimeout: 10_000 });
    this.ws = ws;
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { this.emit('error', new Error(`HTTP ${res.statusCode} ${body.replace(/\s+/g, ' ').trim().slice(0, 160)}`)); ws.terminate(); });
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg = null;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this.onMessage(msg);
    });
    ws.on('error', (err) => this.emit('error', err));
    ws.on('close', (code, reason) => this.emit('close', code, String(reason || '')));
    return ws;
  }
  sendJson(obj) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }
  settle(row) { this.rows.push(row); this.emit('sentence', row); }
  stop() { if (this.ws) this.ws.close(); }
}

/** fun-asr-realtime over the DashScope inference protocol. */
class FunArm extends Arm {
  start() {
    this.taskId = crypto.randomUUID();
    this.open(hosts().inference, { Authorization: `Bearer ${this.key}` });
    this.ws.on('open', () => this.sendJson({
      header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio', task: 'asr', function: 'recognition', model: 'fun-asr-realtime',
        parameters: {
          format: 'pcm', sample_rate: 16000, language_hints: [this.opts.lang],
          max_sentence_silence: this.opts.silenceMs, semantic_punctuation_enabled: false,
        },
        input: {},
      },
    }));
  }
  onMessage(msg) {
    const ev = msg.header && msg.header.event;
    if (ev === 'task-started') return this.emit('ready');
    if (ev === 'task-failed') return this.emit('error', new Error(`${msg.header.error_code}: ${msg.header.error_message}`));
    if (ev === 'task-finished') return this.emit('done');
    if (ev !== 'result-generated') return;
    const s = msg.payload && msg.payload.output && msg.payload.output.sentence;
    if (!s || !s.text) return;
    if (!s.sentence_end) { this.partials++; return this.emit('partial', { text: s.text }); }
    this.settle({ startMs: s.begin_time, endMs: s.end_time, text: s.text, finalAt: Date.now() });
  }
  push(chunk) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.ws.send(chunk, { binary: true }); this.sent += chunk.length; }
    else this.dropped += chunk.length;
  }
  end() { this.sendJson({ header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' }, payload: { input: {} } }); }
}

/** qwen3-asr-flash-realtime over the OpenAI-realtime-shaped protocol; the service's VAD cuts the sentences. */
class QwenArm extends Arm {
  start() {
    this.open(`${hosts().realtime}?model=qwen3-asr-flash-realtime`, { Authorization: `Bearer ${this.key}`, 'OpenAI-Beta': 'realtime=v1' });
    this.speechStart = null;
    this.ws.on('open', () => {
      this.sendJson({
        event_id: crypto.randomUUID(), type: 'session.update',
        session: {
          modalities: ['text'], input_audio_format: 'pcm', sample_rate: 16000,
          input_audio_transcription: { language: this.opts.lang },
          turn_detection: { type: 'server_vad', threshold: this.opts.threshold, silence_duration_ms: this.opts.silenceMs },
        },
      });
    });
  }
  onMessage(msg) {
    const t = msg.type || '';
    if (t === 'session.updated' || t === 'session.created') { if (!this.isReady) { this.isReady = true; this.emit('ready'); } return; }
    if (t === 'error') return this.emit('error', new Error(`${(msg.error && msg.error.code) || '?'}: ${(msg.error && msg.error.message) || JSON.stringify(msg).slice(0, 160)}`));
    if (t === 'session.finished') return this.emit('done');
    // this protocol carries no audio timestamps: a sentence spans from the VAD's speech_started to its
    // speech_stopped, both read off the playback clock
    if (t === 'input_audio_buffer.speech_started') { this.speechStart = Date.now() - this.audioStart; return; }
    if (t === 'input_audio_buffer.speech_stopped') { this.speechStop = Date.now() - this.audioStart; return; }
    if (t === 'conversation.item.input_audio_transcription.text') { this.partials++; return this.emit('partial', { text: msg.text || '' }); }
    if (t === 'conversation.item.input_audio_transcription.completed') {
      const text = (msg.transcript || '').trim();
      if (!text) return;
      const endMs = this.speechStop != null ? this.speechStop : Date.now() - this.audioStart;
      this.settle({ startMs: this.speechStart != null ? this.speechStart : endMs - 1000, endMs, text, finalAt: Date.now() });
      this.speechStart = null; this.speechStop = null;
    }
  }
  push(chunk) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendJson({ event_id: crypto.randomUUID(), type: 'input_audio_buffer.append', audio: chunk.toString('base64') });
      this.sent += chunk.length;
    } else this.dropped += chunk.length;
  }
  end() { this.sendJson({ event_id: crypto.randomUUID(), type: 'session.finish' }); }
}

// --------------------------------------------------------------------------- audio, SRT, report

/** Decode anything ffmpeg reads into 16 kHz mono 16-bit PCM, from --start for --seconds. */
function decode(file, start, seconds) {
  const a = ['-v', 'error', ...(start ? ['-ss', String(start)] : []), '-i', file, ...(seconds ? ['-t', String(seconds)] : []),
    '-ac', '1', '-ar', '16000', '-f', 's16le', '-'];
  const r = spawn(process.env.FFMPEG || 'ffmpeg', a, { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const out = []; let err = '';
    r.stdout.on('data', (c) => out.push(c));
    r.stderr.on('data', (c) => { err += c; });
    r.on('error', reject);
    r.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(0, 200)}`))));
  });
}

const stamp = (ms) => {
  const t = Math.max(0, Math.round(ms));
  return `${String(Math.floor(t / 3600000)).padStart(2, '0')}:${String(Math.floor(t / 60000) % 60).padStart(2, '0')}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')},${String(t % 1000).padStart(3, '0')}`;
};
const srt = (rows) => rows.map((r, i) => `${i + 1}\n${stamp(r.startMs)} --> ${stamp(r.endMs)}\n${r.text}\n`).join('\n');
const toMs = (s) => { const m = /(\d+):(\d{2}):(\d{2})[,.](\d{3})/.exec(s); return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] : 0; };

/** The app's SRT of the same recording, shifted to the stretch played, as rows. */
function readBaseline(file, startMs, totalMs) {
  const rows = [];
  for (const block of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => /-->/.test(l));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    const s = toMs(a) - startMs; const e = toMs(b) - startMs;
    if (e < 0 || s > totalMs) continue;
    rows.push({ startMs: s, endMs: e, text: PlainText.clean(lines.slice(at + 1).join(' ')) });
  }
  return rows;
}

/** One table, thirty seconds a row, every arm's sentences in its column: read down for the wording, across for the gaps. */
function sideBySide(columns, totalMs) {
  const WINDOW = 30_000;
  const out = [`| time | ${columns.map((c) => c.id).join(' | ')} |`, `|---|${columns.map(() => '---').join('|')}|`];
  for (let t = 0; t < totalMs; t += WINDOW) {
    const cells = columns.map((c) => c.rows.filter((r) => r.startMs >= t && r.startMs < t + WINDOW).map((r) => r.text).join(' ／ ').replace(/\|/g, '｜'));
    if (cells.every((x) => !x)) continue;
    out.push(`| ${stamp(t).slice(0, 8)} | ${cells.join(' | ')} |`);
  }
  return out.join('\n') + '\n';
}

function statsOf(arm, totalMs) {
  const rows = arm.rows;
  const chars = rows.reduce((n, r) => n + r.text.length, 0);
  const covered = rows.reduce((n, r) => n + Math.max(0, r.endMs - r.startMs), 0);
  // how long after the speaker's last word (the sentence's own end_time, on the playback clock) the line settled
  const settle = rows.map((r) => r.finalAt - (arm.audioStart + r.endMs)).filter((x) => x > -5000 && x < 30_000);
  return { id: arm.id, sentences: rows.length, characters: chars, coveredSeconds: Math.round(covered / 1000),
    coveredPct: Math.round((100 * covered) / totalMs), partials: arm.partials, settleMs: med(settle),
    sentKB: Math.round(arm.sent / 1024), droppedKB: Math.round(arm.dropped / 1024), error: arm.err || null };
}

// --------------------------------------------------------------------------- the run

async function main() {
  loadEnv();
  const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!file || file.startsWith('--')) throw new Error('usage: probe-alibaba.js talk.mp3 --lang ja --out dir [--start s] [--seconds s] [--arms fun,qwen,qwen-soft] [--baseline app.ja.srt]');
  const key = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!key) throw new Error('DASHSCOPE_API_KEY is not set (百炼 › API-Key, 华北2（北京）)');
  const opts = {
    lang: flag('lang', 'ja'), out: flag('out', 'probe-alibaba-out'), start: Number(flag('start', 0)) || 0,
    seconds: Number(flag('seconds', 0)) || 0, silenceMs: Number(flag('silence', 700)) || 700, threshold: Number(flag('threshold', 0.2)),
  };
  const wanted = flag('arms', 'fun,qwen,qwen-soft').split(',').map((s) => s.trim()).filter(Boolean);
  const make = {
    fun: () => new FunArm('fun-asr-realtime', key, opts),
    qwen: () => new QwenArm('qwen3-asr-flash-realtime', key, opts),
    'qwen-soft': () => new QwenArm('qwen3-asr-flash-realtime (vad 0)', key, { ...opts, threshold: 0 }),
  };
  const arms = wanted.map((w) => { if (!make[w]) throw new Error(`unknown arm ${w}`); return make[w](); });

  const pcm = await decode(file, opts.start, opts.seconds);
  const totalMs = (pcm.length / (16000 * 2)) * 1000;
  console.log(`# ${path.basename(file)} — ${(totalMs / 60000).toFixed(1)} min from ${opts.start}s, ${opts.lang}, silence ${opts.silenceMs} ms, ${arms.length} arms via ${hosts().inference.replace(/\/api-ws.*/, '')}`);
  console.log(`# about ¥${((totalMs / 3600000) * 1.2 * arms.length).toFixed(2)} at list price if the free quota is spent`);

  for (const a of arms) { a.on('error', (e) => { a.err = String(e.message || e); console.log(`  ✖ ${a.id}: ${a.err}`); }); a.start(); }
  const state = arms.map(() => 'connecting');
  arms.forEach((a, i) => a.ready.then(() => { state[i] = 'ready'; }, () => { state[i] = 'dead'; }));
  const deadline = Date.now() + 14_000;
  while (Date.now() < deadline && state.includes('connecting')) await sleep(CHUNK_MS);
  const live = arms.filter((_, i) => state[i] === 'ready');
  const dead = arms.filter((_, i) => state[i] !== 'ready');
  if (dead.length) console.log(`# ✖ never connected: ${dead.map((a) => a.id).join(', ')}`);
  if (!live.length) throw new Error('no arm connected');
  console.log(`\n# ${live.length} arms ready — playing the recording at speaking pace\n`);
  for (const a of live) a.on('sentence', (r) => console.log(`  ${stamp(r.startMs).slice(3, 8)} ${a.id.padEnd(34)} ${r.text}`));

  const audioStart = Date.now();
  for (const a of live) a.audioStart = audioStart;
  let pos = 0;
  const chunks = Math.floor(pcm.length / CHUNK_BYTES);
  for (let i = 0; i < chunks; i++) {
    const t0 = audioStart + i * CHUNK_MS;
    const wait = t0 - Date.now();
    if (wait > 0) await sleep(wait);
    const chunk = pcm.subarray(pos, pos + CHUNK_BYTES);
    pos += CHUNK_BYTES;
    for (const a of live) if (!a.err) a.push(chunk);
  }
  for (const a of live) a.end();
  await Promise.race([sleep(8000), Promise.all(live.map((a) => new Promise((r) => a.once('done', r))))]);
  for (const a of live) a.stop();
  await sleep(300);

  fs.mkdirSync(opts.out, { recursive: true });
  const columns = [];
  const baseline = flag('baseline', null);
  if (baseline) columns.push({ id: 'app today (16k_ja)', rows: readBaseline(baseline, opts.start * 1000, totalMs) });
  for (const a of live) {
    const slug = a.id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    fs.writeFileSync(path.join(opts.out, `${slug}.srt`), srt(a.rows));
    fs.writeFileSync(path.join(opts.out, `${slug}.jsonl`), a.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    columns.push({ id: a.id, rows: a.rows });
  }
  fs.writeFileSync(path.join(opts.out, 'side-by-side.md'), `# ${path.basename(file)} from ${opts.start}s, ${(totalMs / 60000).toFixed(1)} min\n\n${sideBySide(columns, totalMs)}`);
  const summary = { file: path.basename(file), start: opts.start, minutes: +(totalMs / 60000).toFixed(1), lang: opts.lang, silenceMs: opts.silenceMs,
    at: new Date().toISOString(), arms: live.map((a) => statsOf(a, totalMs)) };
  if (baseline) summary.baseline = { sentences: columns[0].rows.length, characters: columns[0].rows.reduce((n, r) => n + r.text.length, 0) };
  fs.writeFileSync(path.join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  console.log('\n# summary');
  if (baseline) console.log(`  ${'app today (16k_ja)'.padEnd(36)} ${String(summary.baseline.sentences).padStart(5)} lines ${String(summary.baseline.characters).padStart(6)} chars`);
  for (const s of summary.arms) {
    console.log(`  ${s.id.padEnd(36)} ${String(s.sentences).padStart(5)} lines ${String(s.characters).padStart(6)} chars  speech ${s.coveredPct}%  settles ${s.settleMs ?? '–'} ms  ${s.partials} partials${s.droppedKB ? `  dropped ${s.droppedKB} KB` : ''}${s.error ? `  ✖ ${s.error}` : ''}`);
  }
  console.log(`\n# written to ${opts.out}/ — read side-by-side.md`);
}

main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
