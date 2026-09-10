#!/usr/bin/env node
'use strict';
// Which languages does this Tencent account actually serve? Asks the three services directly instead of
// trusting the documentation, and prints tables that can be pasted into core/schema.js and server/lib/jobs.js.
//
//   node server/probe-languages.js              everything below
//   node server/probe-languages.js --live       实时语音翻译: every source→target pair (WebSocket handshake only)
//   node server/probe-languages.js --translate  TokenHub 混元翻译: every target language
//   node server/probe-languages.js --engines    录音文件识别: every EngineModelType (1 s of silence each)
//   … --json out.json                           also write the raw results
//
// The live probe sends no audio and the engine probe sends one second of silence, so a full run costs
// a fraction of a cent. Add --cn to pin the mainland edge (needed behind a VPN).
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { loadEnv, getCredentials, buildConnection, resolveMainland, pinnedOptions } = require('@subs/core');
const { asr } = require('./lib/tc3');
const tokenhub = require('./lib/tokenhub');

// Everything worth asking about: the nine the 实时语音翻译 docs list, plus the languages the batch engines
// and 混元翻译 cover, so the probe also reports what is *not* available rather than only confirming the list.
const LIVE_LANGS = ['zh', 'en', 'zh_en', 'ja', 'ko', 'yue', 'id', 'th', 'ru', 'vi', 'es', 'fr', 'de', 'pt', 'ar', 'ms', 'hi', 'tr'];
const TRANSLATE_TARGETS = [
  'zh', 'zh-TR', 'yue', 'en', 'ja', 'ko', 'ru', 'th', 'id', 'vi', 'ms', 'fil', 'es', 'fr', 'de', 'pt', 'it',
  'ar', 'hi', 'tr', 'nl', 'pl', 'cs', 'da', 'sv', 'nb', 'fi', 'he', 'bn', 'ur', 'fa', 'uk', 'el', 'hu', 'ro',
  'bo', 'ug', 'mn', 'ii',
];
const ENGINES = [
  '16k_zh', '16k_zh_en', '16k_zh_en_2.0', '16k_zh_en_meeting', '16k_en', '16k_en_large', '16k_yue', '16k_zh-PY',
  '16k_zh-TW', '16k_ja', '16k_ko', '16k_vi', '16k_ms', '16k_id', '16k_fil', '16k_th', '16k_pt', '16k_tr',
  '16k_ar', '16k_es', '16k_hi', '16k_fr', '16k_de', '16k_multi_lang', '16k_zh_medical', '16k_zh_large',
];

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const want = (name) => args.includes(`--${name}`) || !args.some((a) => ['--live', '--translate', '--engines'].includes(a));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One 16 kHz mono 16-bit WAV of `seconds` of silence — enough for the engine to accept or refuse the job. */
function silentWav(seconds = 1) {
  const rate = 16000;
  const data = Buffer.alloc(rate * 2 * seconds);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** Open one 实时语音翻译 connection and report what the server said about this language pair. No audio. */
function tryPair(creds, source, target, ip) {
  return new Promise((resolve) => {
    let conn;
    try { conn = buildConnection(creds, { source, target, transModel: 'hunyuan-translation-lite' }); }
    catch (err) { return resolve({ ok: false, why: `build: ${err.message}` }); }
    const ws = new WebSocket(conn.url, { handshakeTimeout: 8000, ...pinnedOptions(ip) });
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { ws.terminate(); } catch { /* already gone */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, why: 'timeout' }), 15000);
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => finish({ ok: false, why: `HTTP ${res.statusCode} ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)}` }));
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg = null;
      try { msg = JSON.parse(data.toString()); } catch { return finish({ ok: false, why: `non-JSON ${data.toString().slice(0, 80)}` }); }
      finish(msg.code === 0 ? { ok: true, why: 'accepted' } : { ok: false, why: `code ${msg.code}: ${msg.message}` });
    });
    ws.on('error', (err) => finish({ ok: false, why: err.message }));
    ws.on('close', (code) => finish({ ok: false, why: `closed ${code} before any frame` }));
  });
}

async function probeLive(creds, ip, pairs) {
  const rows = [];
  const sources = [];
  console.log('\n▶ 实时语音翻译 (WebSocket) — which source languages the account may open');
  for (const s of LIVE_LANGS) {
    const r = await tryPair(creds, s, s === 'zh' ? 'en' : 'zh', ip);
    console.log(`  ${r.ok ? '✔' : '✖'} ${s.padEnd(6)} ${r.ok ? '' : r.why}`);
    rows.push({ kind: 'live-source', source: s, ...r });
    if (r.ok) sources.push(s);
    await sleep(200);
  }
  if (!pairs) return { rows, sources };
  console.log('\n▶ 实时语音翻译 — every target for each source that opened');
  for (const s of sources) {
    const ok = [];
    for (const t of LIVE_LANGS) {
      const r = await tryPair(creds, s, t, ip);
      rows.push({ kind: 'live-pair', source: s, target: t, ...r });
      if (r.ok) ok.push(t);
      await sleep(200);
    }
    console.log(`  ${s.padEnd(6)} → ${ok.join(' ') || '(none)'}`);
  }
  return { rows, sources };
}

async function probeTranslate(key, source = 'yue') {
  const rows = [];
  const ok = [];
  console.log(`\n▶ TokenHub 混元翻译 (${tokenhub.DEFAULT_MODEL}) — targets reachable from ${source}`);
  for (const t of TRANSLATE_TARGETS) {
    try {
      const out = await tokenhub.translate(key, { text: '今日天氣好好，我哋去行山。', source, target: t });
      rows.push({ kind: 'translate', target: t, ok: true, sample: out });
      ok.push(t);
      console.log(`  ✔ ${t.padEnd(6)} ${out.slice(0, 40)}`);
    } catch (err) {
      rows.push({ kind: 'translate', target: t, ok: false, why: err.message });
      console.log(`  ✖ ${t.padEnd(6)} ${err.message.slice(0, 90)}`);
    }
    await sleep(150);
  }
  console.log(`  → ${ok.length} of ${TRANSLATE_TARGETS.length}: ${ok.join(' ')}`);
  return rows;
}

async function probeEngines(creds) {
  const rows = [];
  const ok = [];
  const Data = silentWav(1).toString('base64');
  console.log('\n▶ 录音文件识别 — which EngineModelType values the account may submit');
  for (const engine of ENGINES) {
    try {
      const r = await asr(creds, 'CreateRecTask', { EngineModelType: engine, ChannelNum: 1, ResTextFormat: 1, SourceType: 1, Data });
      rows.push({ kind: 'engine', engine, ok: true, taskId: r.Data && r.Data.TaskId });
      ok.push(engine);
      console.log(`  ✔ ${engine.padEnd(18)} task ${r.Data && r.Data.TaskId}`);
    } catch (err) {
      rows.push({ kind: 'engine', engine, ok: false, why: err.message });
      console.log(`  ✖ ${engine.padEnd(18)} ${err.message.slice(0, 100)}`);
    }
    await sleep(200);
  }
  console.log(`  → ${ok.length} of ${ENGINES.length}: ${ok.join(' ')}`);
  return rows;
}

async function main() {
  loadEnv(path.join(__dirname, '..', '.env'));
  const creds = getCredentials();
  const ip = args.includes('--cn') ? await resolveMainland({}) : null;
  if (ip) console.log(`# mainland edge ${ip}`);
  const out = [];
  if (want('live')) out.push(...(await probeLive(creds, ip, args.includes('--pairs'))).rows);
  if (want('translate')) {
    const key = (process.env.TOKENHUB_API_KEY || '').trim();
    if (!key) console.log('\n▶ TokenHub: TOKENHUB_API_KEY is not set — skipped');
    else out.push(...(await probeTranslate(key, flag('source', 'yue'))));
  }
  if (want('engines')) out.push(...(await probeEngines(creds)));
  const jsonPath = flag('json');
  if (jsonPath) { fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2)); console.log(`\nwrote ${jsonPath}`); }
}

main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
