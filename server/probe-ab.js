#!/usr/bin/env node
'use strict';
// Side by side: the live pipeline we ship — 实时语音翻译, where Tencent recognises and translates in one
// stream — against a split one, where 实时语音识别 returns the words and 混元翻译 turns them into the
// subtitle. Both are fed the same recording at speaking pace, on the same clock, so the transcripts can be
// read against each other and the delays compared without one method getting easier audio than the other.
//
//   node server/probe-ab.js talk.wav [--engine 16k_yue] [--model hy-mt2-lite] [--source yue] [--target zh]
//                                    [--seconds 600] [--out ab] [--cn]
//   node server/probe-ab.js --check-engines [--cn]     which engines 实时语音识别 accepts (handshake only)
//
// Writes <out>/A.yue.srt, A.zh.srt, B.yue.srt, B.zh.srt and compare.json, and prints how long after the
// speaker stopped each method had the *translated* line ready — the only delay an audience ever sees.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { loadEnv, getCredentials, TranslationStream, resolveMainland, pinnedOptions } = require('@subs/core');

const HOST = 'asr.cloud.tencent.com';
const CHUNK_MS = 200;
const CHUNK_BYTES = 16000 * 2 * (CHUNK_MS / 1000);
// Every engine the batch service accepted, to find out which of them 实时语音识别 also serves. The two
// services share names but not necessarily coverage, which is the whole point of asking.
const ENGINES = [
  '16k_zh', '16k_zh_large', '16k_zh-PY', '16k_zh_dialect', '16k_zh-TW', '16k_zh_en', '16k_zh_en_2.0',
  '16k_en', '16k_en_large', '16k_yue', '16k_ja', '16k_ko', '16k_vi', '16k_ms', '16k_id', '16k_fil',
  '16k_th', '16k_pt', '16k_tr', '16k_ar', '16k_es', '16k_hi', '16k_fr', '16k_de', '16k_multi_lang',
  '16k_zh_medical', '16k_ru', '16k_it',
];

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

// --------------------------------------------------------------------------- 实时语音识别 (/asr/v2/)

/** Sign one 实时语音识别 connection. Same recipe as 实时语音翻译, different path. */
function recognitionUrl(creds, params) {
  const q = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const sig = crypto.createHmac('sha1', creds.secretKey).update(`${HOST}/asr/v2/${creds.appid}?${q}`, 'utf8').digest('base64');
  return `wss://${HOST}/asr/v2/${creds.appid}?${q}&signature=${encodeURIComponent(sig)}`;
}

function recognitionParams(creds, engine) {
  const now = Math.floor(Date.now() / 1000);
  return {
    secretid: creds.secretId,
    timestamp: now,
    expired: now + 24 * 3600,
    nonce: 1 + Math.floor(Math.random() * 999_999_999),
    engine_model_type: engine,
    voice_id: crypto.randomUUID(),
    voice_format: 1, // PCM
    needvad: 1, // let the service decide where a sentence ends, as the translation stream does
    filter_punc: 0,
    filter_dirty: 0,
    filter_modal: 0,
    convert_num_mode: 1,
  };
}

/**
 * Words only, as they are recognised. Emits 'sentence' {index, startMs, endMs, text} when the service
 * settles a sentence (slice_type 2) and 'partial' while it is still changing its mind.
 */
class RecognizeStream extends EventEmitter {
  constructor(creds, { engine = '16k_yue', ip = null } = {}) {
    super();
    this.creds = creds;
    this.engine = engine;
    this.ip = ip;
    this.ws = null;
    this.ready = false;
  }

  start() {
    const url = recognitionUrl(this.creds, recognitionParams(this.creds, this.engine));
    const ws = new WebSocket(url, { handshakeTimeout: 10_000, ...pinnedOptions(this.ip) });
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
      if (r.slice_type === 2) this.emit('sentence', row); else this.emit('partial', row);
    });
    ws.on('error', (err) => this.emit('error', err));
    ws.on('close', (code) => this.emit('close', code));
  }

  push(chunk) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(chunk, { binary: true }); }
  end() { if (this.ws && this.ws.readyState === WebSocket.OPEN) { try { this.ws.send(JSON.stringify({ type: 'end' })); } catch { /* going away */ } } }
  stop() { if (this.ws) { try { this.ws.terminate(); } catch { /* gone */ } } }
}

/** Handshake only, to see which engines this account may open on 实时语音识别. */
function tryEngine(creds, engine, ip) {
  return new Promise((resolve) => {
    const s = new RecognizeStream(creds, { engine, ip });
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); s.stop(); resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, why: 'timeout' }), 12_000);
    s.on('ready', () => finish({ ok: true, why: 'accepted' }));
    s.on('error', (err) => finish({ ok: false, why: err.message }));
    s.on('close', () => finish({ ok: false, why: 'closed before any frame' }));
    s.start();
  });
}

// --------------------------------------------------------------------------- 混元翻译, streaming

/**
 * Translate one finished sentence, reporting when the first characters arrive as well as when the line is
 * complete — a caption can be painted as it streams, so both numbers are real.
 * @returns {Promise<{text:string, firstMs:number, doneMs:number}>}
 */
function translateStreaming(key, { model, text, source, target }) {
  const body = JSON.stringify({ model, text, source, target, stream: true });
  const t0 = Date.now();
  let firstAt = null;
  return new Promise((resolve, reject) => {
    const req = https.request(`https://tokenhub.tencentmaas.com/v1/api/translations`, {
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
          } catch { /* a partial frame; the next one carries it */ }
        }
        resolve({ text: out.trim(), firstMs: firstAt - t0, doneMs: Date.now() - t0 });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
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
  const h = String(Math.floor(t / 3600000)).padStart(2, '0');
  const m = String(Math.floor(t / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(t / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${s},${String(t % 1000).padStart(3, '0')}`;
};
const srt = (rows, field) => rows.map((r, i) => `${i + 1}\n${stamp(r.startMs)} --> ${stamp(r.endMs)}\n${r[field] || ''}\n`).join('\n');

// --------------------------------------------------------------------------- the run

async function run(file, opts) {
  const creds = getCredentials();
  const key = (process.env.TOKENHUB_API_KEY || '').trim();
  if (!key) throw new Error('TOKENHUB_API_KEY is not set');
  const ip = opts.cn ? await resolveMainland({}) : null;
  if (ip) console.log(`# mainland edge ${ip}`);

  const pcm = await decode(file, opts.seconds);
  const totalMs = (pcm.length / (16000 * 2)) * 1000;
  console.log(`# ${path.basename(file)} — ${(totalMs / 60000).toFixed(1)} min of 16 kHz mono audio`);
  console.log(`# A 实时语音翻译 ${opts.source}→${opts.target} ${opts.transModel}`);
  console.log(`# B 实时语音识别 ${opts.engine} + 混元翻译 ${opts.model}\n`);

  const A = { rows: [], byId: new Map(), log: [] };
  const B = { rows: [], pending: [] };

  // ---- A: one Tencent stream doing both jobs
  const a = new TranslationStream(creds, {
    source: opts.source, target: opts.target, transModel: opts.transModel,
    edge: opts.cn ? 'cn' : 'auto',
  });
  a.on('log', (t) => A.log.push(t));
  a.on('server-error', (m) => console.log(`  A ✖ ${m.code}: ${m.message}`));
  a.on('result', (r) => {
    const id = r.sentenceId || `v:${r.voiceId}:${r.startTime}`;
    let row = A.byId.get(id);
    if (!row) { row = { id, startMs: null, endMs: null, source: '', target: '', firstTargetAt: null, finalAt: null, wallStart: null, wallEnd: null }; A.byId.set(id, row); A.rows.push(row); }
    if (r.targetText && row.firstTargetAt === null) row.firstTargetAt = Date.now();
    row.source = r.sourceText || row.source;
    row.target = r.targetText || row.target;
    if (r.sentenceEnd) {
      row.finalAt = Date.now();
      row.wallStart = r.wallStart;
      row.wallEnd = r.wallEnd;
    }
  });

  // ---- B: recognition here, translation ours
  const b = new RecognizeStream(creds, { engine: opts.engine, ip });
  b.on('error', (err) => console.log(`  B ✖ ${err.message}`));
  b.on('sentence', (s) => {
    const at = Date.now();
    const row = { index: s.index, startMs: s.startMs, endMs: s.endMs, source: s.text, target: '', sentenceAt: at, firstTargetAt: null, finalAt: null, wallEnd: null, transFirstMs: null, transDoneMs: null };
    B.rows.push(row);
    const p = translateStreaming(key, { model: opts.model, text: s.text, source: opts.source, target: opts.target })
      .then((t) => {
        row.target = t.text;
        row.transFirstMs = t.firstMs;
        row.transDoneMs = t.doneMs;
        row.firstTargetAt = at + t.firstMs;
        row.finalAt = at + t.doneMs;
      })
      .catch((err) => { row.target = `[翻译失败: ${err.message.slice(0, 60)}]`; row.finalAt = Date.now(); });
    B.pending.push(p);
  });

  // ---- both connected before a single sample is sent, so neither loses the opening words
  const ready = (em, event) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${event} never became ready`)), 25_000);
    em.on(event, () => { clearTimeout(t); res(); });
  });
  const aReady = new Promise((res) => { const h = (st) => { if (st.state === 'ready') { a.off('status', h); res(); } }; a.on('status', h); });
  a.start();
  b.start();
  await Promise.all([aReady, ready(b, 'ready')]);
  console.log('# both streams ready — playing the recording at speaking pace\n');

  // ---- feed, in step, at the pace a microphone would
  const audioStart = Date.now();
  let pos = 0;
  const totalChunks = Math.floor(pcm.length / CHUNK_BYTES);
  for (let i = 0; i < totalChunks; i++) {
    const target = audioStart + i * CHUNK_MS;
    const wait = target - Date.now();
    if (wait > 0) await sleep(wait);
    const chunk = pcm.subarray(pos, pos + CHUNK_BYTES);
    pos += CHUNK_BYTES;
    a.push(chunk, { t0: target });
    b.push(chunk);
    if (i && i % 300 === 0) console.log(`  ${Math.round((i * CHUNK_MS) / 1000)}s — A ${A.rows.filter((r) => r.finalAt).length} lines, B ${B.rows.length} lines`);
  }

  // ---- let the tails arrive
  b.end();
  await sleep(6000);
  a.stop();
  b.stop();
  await Promise.allSettled(B.pending);
  await sleep(500);

  // ---- delays, measured from the moment the speaker stopped
  const aFinal = A.rows.filter((r) => r.finalAt && r.wallEnd);
  const aDelay = aFinal.map((r) => r.finalAt - r.wallEnd);
  const aFirst = aFinal.filter((r) => r.firstTargetAt).map((r) => r.firstTargetAt - r.wallEnd);
  for (const r of B.rows) r.wallEnd = audioStart + r.endMs;
  const bFinal = B.rows.filter((r) => r.finalAt);
  const bDelay = bFinal.map((r) => r.finalAt - r.wallEnd);
  const bFirst = bFinal.filter((r) => r.firstTargetAt).map((r) => r.firstTargetAt - r.wallEnd);
  const bWords = B.rows.map((r) => r.sentenceAt - (audioStart + r.endMs));

  // A counts from its own socket's stream start, B from the file's. Both carry a wall-clock time, so
  // putting each back on the recording's own timeline is what makes the two SRTs readable side by side.
  const aRows = A.rows.filter((r) => r.finalAt && r.wallEnd != null).map((r) => ({
    ...r,
    startMs: Math.max(0, (r.wallStart != null ? r.wallStart : r.wallEnd) - audioStart),
    endMs: Math.max(0, r.wallEnd - audioStart),
  }));

  const out = opts.out;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `A.${opts.source}.srt`), srt(aRows, 'source'));
  fs.writeFileSync(path.join(out, `A.${opts.target}.srt`), srt(aRows, 'target'));
  fs.writeFileSync(path.join(out, `B.${opts.source}.srt`), srt(B.rows, 'source'));
  fs.writeFileSync(path.join(out, `B.${opts.target}.srt`), srt(B.rows, 'target'));

  const summary = {
    file: path.basename(file), minutes: +(totalMs / 60000).toFixed(1), at: new Date().toISOString(),
    a: { pipeline: '实时语音翻译', source: opts.source, target: opts.target, transModel: opts.transModel, lines: aRows.length,
      translatedDelayMs: { median: median(aDelay), p90: pct(aDelay, 0.9), min: Math.min(...aDelay), max: Math.max(...aDelay) },
      firstCharsDelayMs: { median: median(aFirst) } },
    b: { pipeline: `实时语音识别 ${opts.engine} + 混元翻译 ${opts.model}`, lines: B.rows.length,
      translatedDelayMs: { median: median(bDelay), p90: pct(bDelay, 0.9), min: Math.min(...bDelay), max: Math.max(...bDelay) },
      firstCharsDelayMs: { median: median(bFirst) },
      wordsDelayMs: { median: median(bWords) },
      translationCallMs: { median: median(B.rows.filter((r) => r.transDoneMs).map((r) => r.transDoneMs)) } },
  };
  fs.writeFileSync(path.join(out, 'compare.json'), JSON.stringify({ summary, a: aRows, b: B.rows, aLog: A.log.slice(-40) }, null, 2));

  const ms = (v) => (v == null ? '   —  ' : `${String(Math.round(v)).padStart(5)} ms`);
  console.log('\n  How long after the speaker stopped the translated line was ready');
  console.log(`  A  实时语音翻译          median ${ms(summary.a.translatedDelayMs.median)}   p90 ${ms(summary.a.translatedDelayMs.p90)}   (${aRows.length} lines)`);
  console.log(`  B  识别 + 混元翻译       median ${ms(summary.b.translatedDelayMs.median)}   p90 ${ms(summary.b.translatedDelayMs.p90)}   (${B.rows.length} lines)`);
  console.log(`     of which: words ready ${ms(summary.b.wordsDelayMs.median)}, translation call ${ms(summary.b.translationCallMs.median)}`);
  console.log(`\n  wrote ${out}/`);
  return summary;
}

async function main() {
  loadEnv(path.join(__dirname, '..', '.env'));
  if (args.includes('--check-engines')) {
    const creds = getCredentials();
    const ip = args.includes('--cn') ? await resolveMainland({}) : null;
    if (ip) console.log(`# mainland edge ${ip}`);
    console.log('\n▶ 实时语音识别 (/asr/v2/) — which engines this account may open');
    const ok = [];
    for (const e of ENGINES) {
      const r = await tryEngine(creds, e, ip);
      console.log(`  ${r.ok ? '✔' : '✖'} ${e.padEnd(18)} ${r.ok ? '' : r.why.slice(0, 90)}`);
      if (r.ok) ok.push(e);
      await sleep(200);
    }
    console.log(`  → ${ok.length} of ${ENGINES.length}: ${ok.join(' ')}`);
    return;
  }
  const takesValue = new Set(['--engine', '--model', '--source', '--target', '--seconds', '--out', '--trans-model']);
  let file = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { if (takesValue.has(args[i])) i++; continue; }
    file = args[i];
    break;
  }
  if (!file) throw new Error('usage: node server/probe-ab.js <audio file> [--engine 16k_yue] [--model hy-mt2-lite] [--seconds 600] [--out ab]');
  await run(file, {
    engine: flag('engine', '16k_yue'),
    model: flag('model', 'hy-mt2-lite'),
    source: flag('source', 'yue'),
    target: flag('target', 'zh'),
    transModel: flag('trans-model', 'hunyuan-translation-lite'),
    seconds: Number(flag('seconds', 0)) || 0,
    out: flag('out', 'ab'),
    cn: args.includes('--cn'),
  });
}

main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
