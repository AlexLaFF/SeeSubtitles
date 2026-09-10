#!/usr/bin/env node
'use strict';
// Play one recording into several live pipelines at once, at speaking pace, on one clock, and write down
// what each of them heard and when. One pass costs ten minutes of wall time however many arms it runs, so
// a whole shootout — engines, hotwords, translation models — is one sitting rather than one per variant.
//
//   node server/probe-ab.js talk.wav --arms arms.json --out run1        several pipelines at once
//   node server/probe-ab.js talk.wav --out run1                         the shipped one against the split one
//   node server/probe-ab.js --check-engines                             which engines 实时语音识别 serves
//   node server/probe-ab.js --check-params                              which tuning parameters it accepts
//
// An arm is {id, kind, ...}. kind 'translate' is 实时语音翻译 (recognises and translates in one stream);
// 'recognize' is 实时语音识别 alone, for comparing what engines hear without paying to translate it;
// 'split' is 实时语音识别 followed by our own 混元翻译 call. Every arm may carry hotwords.
//
//   {"id":"A", "kind":"translate", "source":"yue", "target":"zh", "transModel":"hunyuan-translation-lite"}
//   {"id":"yue-hot", "kind":"recognize", "engine":"16k_yue", "hotwords":"巨噬细胞|10,松果菊|10"}
//   {"id":"B", "kind":"split", "engine":"16k_yue", "model":"hy-mt2-lite", "rollMs":900}
//
// rollMs on a split arm translates the sentence *while it is still being spoken*, every rollMs, so the
// caption rolls the way 实时语音翻译's does instead of appearing all at once when the speaker stops.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { loadEnv, getCredentials, TranslationStream, resolveMainland, pinnedOptions, hotwordList } = require('@subs/core');

const HOST = 'asr.cloud.tencent.com';
const CHUNK_MS = 200;
const CHUNK_BYTES = 16000 * 2 * (CHUNK_MS / 1000);
const SILENCE = Buffer.alloc(CHUNK_BYTES);
const ENGINES = [
  '16k_zh', '16k_zh_large', '16k_zh-PY', '16k_zh_dialect', '16k_zh-TW', '16k_zh_en', '16k_zh_en_2.0',
  '16k_en', '16k_en_large', '16k_yue', '16k_ja', '16k_ko', '16k_vi', '16k_ms', '16k_id', '16k_fil',
  '16k_th', '16k_pt', '16k_tr', '16k_ar', '16k_es', '16k_hi', '16k_fr', '16k_de', '16k_multi_lang',
  '16k_zh_medical', '16k_ru', '16k_it',
];

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const med = (v) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null; };
const at = (v, q) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length * q)]) : null; };

// --------------------------------------------------------------------------- 实时语音识别 (/asr/v2/)

/** Sign one 实时语音识别 connection. Same recipe as 实时语音翻译, different path. */
function recognitionUrl(creds, params) {
  const enc = {};
  for (const [k, v] of Object.entries(params)) enc[k] = /[^A-Za-z0-9_.~-]/.test(String(v)) ? encodeURIComponent(String(v)) : String(v);
  const q = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const sig = crypto.createHmac('sha1', creds.secretKey).update(`${HOST}/asr/v2/${creds.appid}?${q}`, 'utf8').digest('base64');
  const qe = Object.keys(enc).sort().map((k) => `${k}=${enc[k]}`).join('&');
  return `wss://${HOST}/asr/v2/${creds.appid}?${qe}&signature=${encodeURIComponent(sig)}`;
}

function recognitionParams(creds, o) {
  const now = Math.floor(Date.now() / 1000);
  const hw = hotwordList(o.hotwords);
  return {
    secretid: creds.secretId,
    timestamp: now,
    expired: now + 24 * 3600,
    nonce: 1 + Math.floor(Math.random() * 999_999_999),
    engine_model_type: o.engine || '16k_yue',
    voice_id: crypto.randomUUID(),
    voice_format: 1, // PCM
    needvad: 1, // let the service decide where a sentence ends, as 实时语音翻译 does
    filter_punc: 0,
    filter_dirty: 0,
    filter_modal: 0,
    convert_num_mode: 1,
    ...(hw ? { hotword_list: hw } : {}),
    ...(o.maxSpeakTime ? { max_speak_time: Math.round(o.maxSpeakTime) } : {}),
    ...(o.vadSilenceTime ? { vad_silence_time: Math.round(o.vadSilenceTime) } : {}),
  };
}

/**
 * Words only, as they are recognised. Emits 'sentence' when the service settles one (slice_type 2) and
 * 'partial' while it is still changing its mind — both carry {index, startMs, endMs, text}.
 */
class RecognizeStream extends EventEmitter {
  constructor(creds, opts = {}) {
    super();
    this.creds = creds;
    this.opts = opts;
    this.ws = null;
    this.ready = false;
    this.sent = 0;
    this.dropped = 0;
  }

  start() {
    const ws = new WebSocket(recognitionUrl(this.creds, recognitionParams(this.creds, this.opts)),
      { handshakeTimeout: 10_000, ...pinnedOptions(this.opts.ip || null) });
    this.ws = ws;
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { this.emit('error', new Error(`HTTP ${res.statusCode} ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`)); ws.terminate(); });
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg = null;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.code !== 0) return this.emit('error', new Error(`${msg.code}: ${msg.message}`));
      if (!this.ready) { this.ready = true; this.emit('ready'); }
      const r = msg.result;
      if (!r || !r.voice_text_str) return;
      const row = { index: r.index, startMs: r.start_time, endMs: r.end_time, text: r.voice_text_str };
      this.emit(r.slice_type === 2 ? 'sentence' : 'partial', row);
    });
    ws.on('error', (err) => this.emit('error', err));
    ws.on('close', (code) => this.emit('close', code));
  }

  push(chunk) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.ws.send(chunk, { binary: true }); this.sent += chunk.length; }
    else this.dropped += chunk.length;
  }
  end() { if (this.ws && this.ws.readyState === WebSocket.OPEN) { try { this.ws.send(JSON.stringify({ type: 'end' })); } catch { /* going away */ } } }
  stop() { if (this.ws) { try { this.ws.terminate(); } catch { /* gone */ } } }
}

// --------------------------------------------------------------------------- 混元翻译, streaming

/** Translate one line, reporting when the first characters arrived as well as when it was complete. */
function translateStreaming(key, { model, text, source, target }) {
  const body = JSON.stringify({ model, text, source, target, stream: true });
  const t0 = Date.now();
  let firstAt = null;
  return new Promise((resolve, reject) => {
    const req = https.request('https://tokenhub.tencentmaas.com/v1/api/translations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (firstAt === null) firstAt = Date.now(); chunks.push(c); });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${raw.slice(0, 160)}`));
        let out = '';
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message);
            if (d && d.content) out += d.content;
          } catch { /* a split frame; the next one carries it */ }
        }
        resolve({ text: out.trim(), firstMs: firstAt - t0, doneMs: Date.now() - t0 });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

// --------------------------------------------------------------------------- arms

/**
 * One pipeline under test. Every arm records rows of {startMs, endMs, source, target} plus the wall-clock
 * moments that matter: firstTargetAt (translated text first on screen) and finalAt (it stopped changing).
 */
function createArm(spec, ctx) {
  const rows = [];
  const pending = [];
  const arm = { id: spec.id, spec, rows, pending, errors: [], calls: 0 };

  if (spec.kind === 'translate') {
    const stream = new TranslationStream(ctx.creds, {
      source: spec.source || ctx.source, target: spec.target || ctx.target,
      transModel: spec.transModel || 'hunyuan-translation-lite',
      hotwords: spec.hotwords || '',
      vadSilenceTime: spec.vadSilenceTime, maxSpeakTime: spec.maxSpeakTime,
      edge: ctx.ip ? 'cn' : 'auto',
    });
    const byId = new Map();
    stream.on('server-error', (m) => arm.errors.push(`${m.code}: ${m.message}`));
    stream.on('result', (r) => {
      const id = r.sentenceId || `${r.voiceId}:${r.startTime}`;
      let row = byId.get(id);
      if (!row) { row = { startMs: null, endMs: null, source: '', target: '', seen: [], firstTargetAt: null, finalAt: null, wallStart: null, wallEnd: null }; byId.set(id, row); rows.push(row); }
      if (r.targetText && row.firstTargetAt === null) row.firstTargetAt = Date.now();
      if (r.sourceText) row.source = r.sourceText;
      if (r.targetText && r.targetText !== row.target) { row.target = r.targetText; row.seen.push({ at: Date.now(), text: r.targetText }); }
      if (r.sentenceEnd) { row.finalAt = Date.now(); row.wallStart = r.wallStart; row.wallEnd = r.wallEnd; }
    });
    arm.ready = new Promise((res) => { const h = (st) => { if (st.state === 'ready') { stream.off('status', h); res(); } }; stream.on('status', h); });
    arm.start = () => stream.start();
    arm.push = (chunk, t0) => stream.push(chunk, { t0 });
    arm.end = () => {};
    arm.stop = () => stream.stop();
    // 实时语音翻译 counts from its own socket, so put its rows back on the recording's timeline
    arm.settle = () => { for (const r of rows) { if (r.wallEnd != null) { r.endMs = r.wallEnd - ctx.audioStart; r.startMs = Math.max(0, (r.wallStart ?? r.wallEnd) - ctx.audioStart); } } };
    return arm;
  }

  const stream = new RecognizeStream(ctx.creds, {
    engine: spec.engine, hotwords: spec.hotwords, ip: ctx.ip,
    maxSpeakTime: spec.maxSpeakTime, vadSilenceTime: spec.vadSilenceTime,
  });
  const split = spec.kind === 'split';
  const model = spec.model || 'hy-mt2-lite';
  let rolling = null; // the sentence being spoken right now, when rollMs is on

  const translate = (row, text, { partial = false } = {}) => {
    arm.calls++;
    const p = translateStreaming(ctx.key, { model, text, source: spec.source || ctx.source, target: spec.target || ctx.target })
      .then((t) => {
        // a later answer for the same row must never overwrite a newer one
        if (row.settled && partial) return;
        if (partial) row.settled = false; else row.settled = true;
        if (t.text && t.text !== row.target) row.seen.push({ at: Date.now(), text: t.text });
        row.target = t.text;
        if (row.firstTargetAt == null) row.firstTargetAt = Date.now();
        if (!partial) { row.finalAt = Date.now(); row.transDoneMs = t.doneMs; row.transFirstMs = t.firstMs; }
      })
      .catch((err) => { arm.errors.push(err.message.slice(0, 90)); if (!partial) row.finalAt = Date.now(); });
    pending.push(p);
    return p;
  };

  stream.on('error', (err) => arm.errors.push(err.message.slice(0, 90)));
  stream.on('partial', (s) => {
    if (!split || !spec.rollMs) return;
    if (!rolling || rolling.index !== s.index) rolling = { index: s.index, row: null, lastAt: 0, lastText: '' };
    const now = Date.now();
    if (now - rolling.lastAt < spec.rollMs) return;
    if (s.text === rolling.lastText || s.text.length < 4) return;
    rolling.lastAt = now;
    rolling.lastText = s.text;
    if (!rolling.row) { rolling.row = { index: s.index, startMs: s.startMs, endMs: s.endMs, source: s.text, target: '', seen: [], firstTargetAt: null, finalAt: null, sentenceAt: null }; rows.push(rolling.row); }
    rolling.row.endMs = s.endMs;
    rolling.row.source = s.text;
    translate(rolling.row, s.text, { partial: true });
  });
  stream.on('sentence', (s) => {
    const now = Date.now();
    let row = rolling && rolling.index === s.index && rolling.row ? rolling.row : null;
    if (!row) { row = { index: s.index, startMs: s.startMs, endMs: s.endMs, source: '', target: '', seen: [], firstTargetAt: null, finalAt: null, sentenceAt: null }; rows.push(row); }
    rolling = null;
    row.startMs = s.startMs;
    row.endMs = s.endMs;
    row.source = s.text;
    row.sentenceAt = now;
    if (!split) { row.finalAt = now; row.firstTargetAt = now; return; }
    translate(row, s.text);
  });

  arm.ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${spec.id}: never became ready`)), 12_000);
    stream.on('ready', () => { clearTimeout(t); res(); });
  });
  arm.start = () => stream.start();
  arm.push = (chunk) => stream.push(chunk);
  arm.audio = () => ({ sent: stream.sent, dropped: stream.dropped });
  arm.end = () => stream.end();
  arm.stop = () => stream.stop();
  // 实时语音识别 counts from the first byte it received, which includes the silence sent while the other
  // arms were still connecting — take that back off or every time is late by the warm-up.
  arm.settle = (warmMs = 0) => {
    for (const r of rows) { r.startMs -= warmMs; r.endMs -= warmMs; r.wallEnd = ctx.audioStart + r.endMs; }
  };
  return arm;
}

/** What one arm's rows say about it. */
function statsOf(arm) {
  const rows = arm.rows.filter((r) => r.endMs != null && r.wallEnd != null && r.endMs >= 0);
  const spans = rows.map((r) => r.endMs - r.startMs).filter((x) => x >= 0);
  const first = rows.map((r) => (r.firstTargetAt ? r.firstTargetAt - r.wallEnd : null));
  const final = rows.map((r) => (r.finalAt ? r.finalAt - r.wallEnd : null));
  return {
    id: arm.id, kind: arm.spec.kind, engine: arm.spec.engine || null, model: arm.spec.model || arm.spec.transModel || null,
    hotwords: !!arm.spec.hotwords, rollMs: arm.spec.rollMs || null,
    lines: rows.length,
    chars: rows.reduce((n, r) => n + String(r.source || '').replace(/[，。！？、\s]/g, '').length, 0),
    firstMs: med(first), finalMs: med(final), finalP90: at(final, 0.9),
    spanMed: med(spans), spanMax: spans.length ? Math.max(...spans) : null,
    longLines: spans.filter((x) => x > 10_000).length,
    audio: arm.audio ? arm.audio() : null,
    revisions: med(rows.map((r) => (r.seen ? r.seen.length : 0))),
    keptPrefix: (() => {
      const f = [];
      for (const r of rows) {
        const v = r.seen || [];
        for (let i = 1; i < v.length; i++) {
          const a = v[i - 1].text; const b = v[i].text;
          let n = 0;
          while (n < a.length && n < b.length && a[n] === b[n]) n++;
          if (a.length) f.push(n / a.length);
        }
      }
      return f.length ? Math.round(100 * f.reduce((x, y) => x + y, 0) / f.length) : null;
    })(),
    translateCalls: arm.calls,
    translateMs: med(rows.map((r) => r.transDoneMs)),
    recogniseMs: med(rows.map((r) => (r.sentenceAt ? r.sentenceAt - r.wallEnd : null))),
    errors: arm.errors.slice(0, 5),
  };
}

// --------------------------------------------------------------------------- audio and SRT

/** Decode anything ffmpeg reads into 16 kHz mono 16-bit PCM. */
function decode(file, seconds) {
  const a = ['-v', 'error', '-i', file, ...(seconds ? ['-t', String(seconds)] : []), '-ac', '1', '-ar', '16000', '-f', 's16le', '-'];
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
const srt = (rows, field) => rows.filter((r) => r[field]).map((r, i) => `${i + 1}\n${stamp(r.startMs)} --> ${stamp(r.endMs)}\n${r[field]}\n`).join('\n');

// --------------------------------------------------------------------------- the run

const DEFAULT_ARMS = [
  { id: 'A', kind: 'translate', transModel: 'hunyuan-translation-lite' },
  { id: 'B', kind: 'split', engine: '16k_yue', model: 'hy-mt2-lite' },
];

async function run(file, opts) {
  const creds = getCredentials();
  const key = (process.env.TOKENHUB_API_KEY || '').trim();
  const specs = opts.armsFile ? JSON.parse(fs.readFileSync(opts.armsFile, 'utf8')) : DEFAULT_ARMS;
  if (!key && specs.some((s) => s.kind !== 'recognize')) throw new Error('TOKENHUB_API_KEY is not set');
  const ip = opts.cn ? await resolveMainland({}) : null;
  if (ip) console.log(`# mainland edge ${ip}`);

  const pcm = await decode(file, opts.seconds);
  const totalMs = (pcm.length / (16000 * 2)) * 1000;
  console.log(`# ${path.basename(file)} — ${(totalMs / 60000).toFixed(1)} min, ${specs.length} arms`);
  for (const s of specs) console.log(`#   ${s.id.padEnd(16)} ${s.kind.padEnd(10)} ${s.engine || s.transModel || ''} ${s.hotwords ? '+hotwords' : ''} ${s.rollMs ? `roll ${s.rollMs}ms` : ''}`);

  const ctx = { creds, key, ip, source: opts.source, target: opts.target, audioStart: 0 };
  const arms = specs.map((s) => createArm(s, ctx));
  for (const a of arms) a.start();

  // 实时语音识别 hangs up on a connection that sends nothing for 15 seconds, so an arm that is slow to
  // connect must not hold the others silent while it tries — the ones already up are fed silence until
  // everybody is in or the deadline passes.
  const state = arms.map(() => 'connecting');
  arms.forEach((a, i) => a.ready.then(() => { state[i] = 'ready'; }, () => { state[i] = 'dead'; }));
  const deadline = Date.now() + 14_000;
  while (Date.now() < deadline && state.includes('connecting')) {
    await sleep(CHUNK_MS);
    const now = Date.now();
    arms.forEach((a, i) => { if (state[i] === 'ready') { a.push(SILENCE, now - CHUNK_MS); a.warm = (a.warm || 0) + CHUNK_MS; } });
  }
  const dead = arms.filter((_, i) => state[i] !== 'ready').map((a) => a.id);
  if (dead.length) console.log(`# ✖ never connected: ${dead.join(', ')}`);
  const live = arms.filter((_, i) => state[i] === 'ready');
  if (!live.length) throw new Error('no arm connected');
  console.log(`\n# ${live.length} arms ready — playing the recording at speaking pace\n`);

  ctx.audioStart = Date.now();
  let pos = 0;
  const chunks = Math.floor(pcm.length / CHUNK_BYTES);
  for (let i = 0; i < chunks; i++) {
    const t0 = ctx.audioStart + i * CHUNK_MS;
    const wait = t0 - Date.now();
    if (wait > 0) await sleep(wait);
    const chunk = pcm.subarray(pos, pos + CHUNK_BYTES);
    pos += CHUNK_BYTES;
    for (const a of live) a.push(chunk, t0);
    if (i && i % 600 === 0) console.log(`  ${Math.round((i * CHUNK_MS) / 1000)}s — ${live.map((a) => `${a.id} ${a.rows.length}`).join('  ')}`);
  }

  for (const a of live) a.end();
  await sleep(6000);
  for (const a of live) a.stop();
  await Promise.allSettled(live.flatMap((a) => a.pending));
  await sleep(500);
  for (const a of live) a.settle(a.warm || 0);

  fs.mkdirSync(opts.out, { recursive: true });
  const summary = { file: path.basename(file), minutes: +(totalMs / 60000).toFixed(1), at: new Date().toISOString(), source: opts.source, target: opts.target, arms: live.map(statsOf) };
  fs.writeFileSync(path.join(opts.out, 'arms.json'), JSON.stringify({ summary, arms: live.map((a) => ({ id: a.id, spec: a.spec, rows: a.rows })) }, null, 2));
  for (const a of live) {
    fs.writeFileSync(path.join(opts.out, `${a.id}.${opts.source}.srt`), srt(a.rows, 'source'));
    if (a.spec.kind !== 'recognize') fs.writeFileSync(path.join(opts.out, `${a.id}.${opts.target}.srt`), srt(a.rows, 'target'));
  }

  const ms = (v) => (v == null ? '     —' : `${String(Math.round(v)).padStart(5)}`);
  console.log('\n  arm              lines  chars   首字 ms   定稿 ms    p90   每句 s  >10s  改写次  保留%  调用');
  for (const s of summary.arms) {
    console.log(`  ${s.id.padEnd(16)} ${String(s.lines).padStart(5)} ${String(s.chars).padStart(6)}  ${ms(s.firstMs)}   ${ms(s.finalMs)}  ${ms(s.finalP90)}   ${((s.spanMed || 0) / 1000).toFixed(1)}/${((s.spanMax || 0) / 1000).toFixed(0)}  ${String(s.longLines).padStart(4)}  ${String(s.revisions ?? '—').padStart(5)}  ${String(s.keptPrefix ?? '—').padStart(5)}  ${String(s.translateCalls).padStart(4)}${s.audio ? `  ${Math.round(s.audio.sent / 32000)}s sent${s.audio.dropped ? ` ${Math.round(s.audio.dropped / 32000)}s DROPPED` : ''}` : ''}${s.errors.length ? `   ✖ ${s.errors[0]}` : ''}`);
  }
  console.log(`\n  wrote ${opts.out}/`);
  return summary;
}

// --------------------------------------------------------------------------- checks

function tryRecognize(creds, opts, ip) {
  return new Promise((resolve) => {
    const s = new RecognizeStream(creds, { ...opts, ip });
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); s.stop(); resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, why: 'timeout' }), 12_000);
    s.on('ready', () => finish({ ok: true, why: '' }));
    s.on('error', (err) => finish({ ok: false, why: err.message }));
    s.on('close', () => finish({ ok: false, why: 'closed before any frame' }));
    s.start();
  });
}

async function main() {
  loadEnv(path.join(__dirname, '..', '.env'));
  const ip = args.includes('--cn') ? await resolveMainland({}) : null;
  if (ip) console.log(`# mainland edge ${ip}`);

  if (args.includes('--check-engines')) {
    const creds = getCredentials();
    console.log('\n▶ 实时语音识别 (/asr/v2/) — which engines this account may open');
    const ok = [];
    for (const e of ENGINES) {
      const r = await tryRecognize(creds, { engine: e }, ip);
      console.log(`  ${r.ok ? '✔' : '✖'} ${e.padEnd(18)} ${r.why.slice(0, 90)}`);
      if (r.ok) ok.push(e);
      await sleep(200);
    }
    return console.log(`  → ${ok.length} of ${ENGINES.length}: ${ok.join(' ')}`);
  }
  if (args.includes('--check-params')) {
    const creds = getCredentials();
    console.log('\n▶ 实时语音识别 — which tuning parameters it accepts');
    const cases = [
      ['baseline', {}],
      ['hotwords', { hotwords: '巨噬细胞|10,松果菊|10' }],
      ['max_speak_time', { maxSpeakTime: 10_000 }],
      ['vad_silence_time', { vadSilenceTime: 800 }],
      ['all together', { hotwords: '巨噬细胞|10', maxSpeakTime: 10_000, vadSilenceTime: 800 }],
    ];
    for (const [name, o] of cases) {
      const r = await tryRecognize(creds, { engine: '16k_yue', ...o }, ip);
      console.log(`  ${r.ok ? '✔' : '✖'} ${name.padEnd(18)} ${r.why.slice(0, 90)}`);
      await sleep(200);
    }
    return;
  }

  const takesValue = new Set(['--arms', '--source', '--target', '--seconds', '--out']);
  let file = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { if (takesValue.has(args[i])) i++; continue; }
    file = args[i];
    break;
  }
  if (!file) throw new Error('usage: node server/probe-ab.js <audio file> [--arms arms.json] [--seconds 600] [--out run1]');
  await run(file, {
    armsFile: flag('arms', null),
    source: flag('source', 'yue'),
    target: flag('target', 'zh'),
    seconds: Number(flag('seconds', 0)) || 0,
    out: flag('out', 'ab'),
    cn: args.includes('--cn'),
  });
}

main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
