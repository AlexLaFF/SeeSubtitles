#!/usr/bin/env node
'use strict';
// Give one recording to several file recognisers — the batch kind the app uses for uploads, not the live kind —
// and write down what each of them heard, side by side with what the app made of the same file. Accuracy is the
// only question here: nobody is waiting, so every service gets the whole stretch at once and as long as it needs.
//
//   node server/probe-file.js talk.mp3 --lang ja --out run1
//   node server/probe-file.js talk.mp3 --lang ja --start 600 --seconds 900 --baseline talk.ja.srt --out run1
//
// Arms (--arms, comma-separated; default: every one whose key is in .env):
//   tencent     16k_zh_large (大模型1.0, ¥2.40/h)  Tencent, TENCENT_* keys — server only
//   tencent-yue 16k_yue (标准版, ¥1.75/h)           what a Cantonese file used until 2026-09-23
//   tencent-2.0 16k_multi_lang (大模型2.0, ¥0.80/h)  the cheapest tier, and a large model
//   qwen        qwen3-asr-flash-filetrans       百炼, DASHSCOPE_API_KEY      up to 12 h a file, sentence times
//   fun         fun-asr                         百炼, DASHSCOPE_API_KEY      the same API, hotwords
//   qwen-audio  qwen-audio-3.1-asr-flash-filetrans  百炼, DASHSCOPE_API_KEY
//   scribe      scribe_v2                       ElevenLabs, ELEVENLABS_API_KEY   word times, grouped into lines here
//   openai      gpt-transcribe                  OpenAI, OPENAI_API_KEY      text only, 25 MB a request: sent as
//                                                                          ten-minute pieces, timed to the piece
//
// --baseline is the SRT the app already made of the recording (its Tencent 录音文件识别 pass), merged into the
// side-by-side as the first column. --start/--seconds (both seconds) pick a stretch, so a passage with soft
// speech can be tried on its own. Keys go in the repository-root .env (git-ignored); none is used anywhere else.
// Billing is per second of audio, every arm separately: 百炼 has 36,000 s free per model for 90 days on a new
// account, ElevenLabs $0.22/h, OpenAI $0.27/h.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadEnv, getCredentials } = require('@subs/core');
const { asr } = require('./lib/tc3');
const PlainText = require('../core/plain-text');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------- audio

function ffmpeg(a) {
  const r = spawn(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let err = '';
    r.stderr.on('data', (c) => { err += c; });
    r.on('error', reject);
    r.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(0, 200)}`))));
  });
}
const cut = (start, seconds) => [...(start ? ['-ss', String(start)] : []), ...(seconds ? ['-t', String(seconds)] : [])];

/** The stretch as 16 kHz mono MP3 — what the server itself uploads for a job, and small enough to survive a bad link. */
async function audioOf(file, start, seconds, out) {
  const dst = path.join(out, 'stretch.mp3');
  await ffmpeg([...cut(start, seconds), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', dst]);
  return dst;
}
async function durationOf(wav) {
  return new Promise((resolve, reject) => {
    const r = spawn(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]);
    let s = ''; r.stdout.on('data', (c) => { s += c; }); r.on('error', reject);
    r.on('close', () => resolve(Math.round(parseFloat(s) * 1000) || 0));
  });
}

// --------------------------------------------------------------------------- services

const dashHost = () => {
  const ws = (process.env.DASHSCOPE_WORKSPACE_ID || '').trim();
  const region = (process.env.DASHSCOPE_REGION || 'cn-beijing').trim();
  return ws ? `https://${ws}.${region}.maas.aliyuncs.com` : 'https://dashscope.aliyuncs.com';
};

/** fetch, with the body read, that says what went wrong underneath and tries again — the link from the Mac drops
 * connections mid-upload and mid-reply ("terminated"). Returns {status, ok, text}. */
async function call(url, init, what, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, init);
      return { status: res.status, ok: res.ok, text: await res.text() };
    } catch (err) {
      const why = err.cause ? `${err.cause.code || ''} ${err.cause.message || ''}`.trim() : err.message;
      if (i >= tries) throw new Error(`${what}: ${why}`);
      await sleep(3000 * i);
    }
  }
}

function jsonOf(res, what) {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  try { return JSON.parse(res.text); } catch { throw new Error(`${what}: not JSON: ${res.text.slice(0, 120)}`); }
}

/** 百炼's temporary storage: a local file becomes an oss:// URL the model can read for 48 hours. Bound to one model. */
async function dashUpload(key, model, file) {
  const policy = await jsonOf(await call(`https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
    { headers: { Authorization: `Bearer ${key}` } }, `${model} upload policy`), `${model} upload policy`);
  const p = policy.data;
  const objectKey = `${p.upload_dir}/${path.basename(file)}`;
  const form = new FormData();
  form.append('OSSAccessKeyId', p.oss_access_key_id);
  form.append('Signature', p.signature);
  form.append('policy', p.policy);
  form.append('key', objectKey);
  form.append('x-oss-object-acl', p.x_oss_object_acl);
  form.append('x-oss-forbid-overwrite', p.x_oss_forbid_overwrite);
  form.append('success_action_status', '200');
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const res = await call(p.upload_host, { method: 'POST', body: form }, `${model} upload`);
  // 409 FileAlreadyExists: the first try landed and only its reply was lost, so the object is there
  if (!res.ok && !(res.status === 409 && /FileAlreadyExists/.test(res.text))) throw new Error(`${model} upload: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  return `oss://${objectKey}`;
}

/** 百炼 录音文件识别: submit, poll, fetch the transcript. Rows are {startMs, endMs, text}. */
async function dashTranscribe(key, model, file, lang, log) {
  const url = await dashUpload(key, model, file);
  log(`uploaded as ${url}`);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable' };
  const submitted = await jsonOf(await call(`${dashHost()}/api/v1/services/audio/asr/transcription`, {
    method: 'POST', headers, body: JSON.stringify({ model, input: { file_urls: [url] }, parameters: { language_hints: [lang] } }),
  }, `${model} submit`), `${model} submit`);
  const taskId = submitted.output && submitted.output.task_id;
  if (!taskId) throw new Error(`${model}: no task id in ${JSON.stringify(submitted).slice(0, 200)}`);
  for (let i = 0; i < 720; i++) {
    await sleep(5000);
    const st = await jsonOf(await call(`${dashHost()}/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } }, `${model} poll`), `${model} poll`);
    const status = st.output && st.output.task_status;
    if (status === 'SUCCEEDED') {
      const r = st.output.results && st.output.results[0];
      if (!r || !r.transcription_url) throw new Error(`${model}: ${JSON.stringify(st.output).slice(0, 300)}`);
      const t = await jsonOf(await call(r.transcription_url, {}, `${model} transcript`), `${model} transcript`);
      const sentences = (t.transcripts || []).flatMap((x) => x.sentences || []);
      return sentences.map((s) => ({ startMs: s.begin_time, endMs: s.end_time, text: PlainText.clean(s.text) })).filter((s) => s.text);
    }
    if (status === 'FAILED' || status === 'CANCELED') throw new Error(`${model}: ${status} ${JSON.stringify(st.output).slice(0, 300)}`);
    if (i % 6 === 5) log(`still ${status || 'pending'} after ${(i + 1) * 5} s`);
  }
  throw new Error(`${model}: gave up after an hour`);
}

/**
 * Tencent 录音文件识别, the way a job does it: the audio inline (the base64 cap is 5 MB, so ten minutes at 64 kb/s
 * fits), then poll. The engine is the point of the arm — the tiers are priced differently and hear differently.
 */
async function tencentFile(creds, engine, file, log) {
  const data = fs.readFileSync(file);
  if (data.length > 4.5 * 1024 * 1024) throw new Error(`${engine}: ${(data.length / 1e6).toFixed(1)} MB is past the inline cap — use a shorter stretch`);
  const created = await asr(creds, 'CreateRecTask', { EngineModelType: engine, ChannelNum: 1, ResTextFormat: 1, SourceType: 1, Data: data.toString('base64'), DataLen: data.length });
  const taskId = created.Data.TaskId;
  log(`task ${taskId}`);
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const r = await asr(creds, 'DescribeTaskStatus', { TaskId: taskId });
    const st = r.Data || {};
    if (st.Status === 2) {
      return (st.ResultDetail || []).map((x) => ({ startMs: Number(x.StartMs) || 0, endMs: Number(x.EndMs) || 0, text: PlainText.clean(x.FinalSentence || '') })).filter((x) => x.text);
    }
    if (st.Status === 3) throw new Error(`${engine}: ${st.ErrorMsg || 'recognition failed'}`);
    if (i % 6 === 5) log(`still ${st.StatusStr || 'waiting'} after ${(i + 1) * 5} s`);
  }
  throw new Error(`${engine}: gave up after half an hour`);
}

/** ElevenLabs Scribe: word times, gathered into lines at sentence punctuation or a pause of 700 ms, as the app cuts. */
async function scribe(key, file, lang) {
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  form.append('language_code', lang);
  form.append('timestamps_granularity', 'word');
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const r = await jsonOf(await call('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form }, 'scribe'), 'scribe');
  const rows = []; let cur = null;
  for (const w of r.words || []) {
    if (w.type === 'audio_event') continue;
    if (w.type === 'spacing') { if (cur) cur.text += w.text; continue; }
    if (cur && (w.start * 1000 - cur.endMs > 700 || /[。．！？!?]$/.test(cur.text.trim()))) { rows.push(cur); cur = null; }
    if (!cur) cur = { startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000), text: '' };
    cur.text += w.text; cur.endMs = Math.round(w.end * 1000);
  }
  if (cur) rows.push(cur);
  return rows.map((x) => ({ ...x, text: PlainText.clean(x.text) })).filter((x) => x.text);
}

/** OpenAI gpt-transcribe: text only and 25 MB a request, so the stretch goes as ten-minute pieces, each timed to its piece. */
async function openai(key, wav, lang, out, totalMs) {
  const PIECE = 600_000;
  const rows = [];
  for (let at = 0; at < totalMs; at += PIECE) {
    const piece = path.join(out, `piece-${Math.round(at / 1000)}.m4a`);
    await ffmpeg(['-ss', String(at / 1000), '-t', String(PIECE / 1000), '-i', wav, '-c:a', 'aac', '-b:a', '64k', piece]);
    const form = new FormData();
    form.append('model', 'gpt-transcribe');
    form.append('language', lang);
    form.append('file', new Blob([fs.readFileSync(piece)]), path.basename(piece));
    const r = await jsonOf(await call('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }, 'openai'), 'openai');
    const text = PlainText.clean(r.text || '');
    if (text) rows.push({ startMs: at, endMs: Math.min(at + PIECE, totalMs), text });
    fs.unlinkSync(piece);
  }
  return rows;
}

// --------------------------------------------------------------------------- SRT and the report

const stamp = (ms) => {
  const t = Math.max(0, Math.round(ms));
  return `${String(Math.floor(t / 3600000)).padStart(2, '0')}:${String(Math.floor(t / 60000) % 60).padStart(2, '0')}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')},${String(t % 1000).padStart(3, '0')}`;
};
const srt = (rows) => rows.map((r, i) => `${i + 1}\n${stamp(r.startMs)} --> ${stamp(r.endMs)}\n${r.text}\n`).join('\n');
const toMs = (s) => { const m = /(\d+):(\d{2}):(\d{2})[,.](\d{3})/.exec(s); return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] : 0; };

/** The app's SRT of the same recording, shifted to the stretch, as rows. */
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

/** One table, thirty seconds a row, every arm's lines in its column: read down for the wording, across for what was missed. */
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

const statsOf = (id, rows, totalMs, ms) => ({
  id, lines: rows.length, characters: rows.reduce((n, r) => n + r.text.length, 0),
  speechPct: Math.round((100 * rows.reduce((n, r) => n + Math.max(0, r.endMs - r.startMs), 0)) / totalMs), tookSeconds: ms == null ? null : Math.round(ms / 1000),
});

// --------------------------------------------------------------------------- the run

async function main() {
  loadEnv();
  const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!file) throw new Error('usage: probe-file.js talk.mp3 --lang ja --out dir [--start s] [--seconds s] [--arms tencent,tencent-yue,tencent-2.0,qwen,fun,qwen-audio,scribe,openai] [--baseline app.srt]');
  const keys = { dash: (process.env.DASHSCOPE_API_KEY || '').trim(), eleven: (process.env.ELEVENLABS_API_KEY || '').trim(), openai: (process.env.OPENAI_API_KEY || '').trim() };
  let creds = null;
  try { creds = getCredentials(); keys.tencent = '1'; } catch { keys.tencent = ''; }
  const opts = { lang: flag('lang', 'ja'), out: flag('out', 'probe-file-out'), start: Number(flag('start', 0)) || 0, seconds: Number(flag('seconds', 0)) || 0 };
  const ARMS = {
    tencent: { id: '16k_zh_large (大模型1.0)', key: 'tencent', run: (wav) => tencentFile(creds, '16k_zh_large', wav, log('tencent')) },
    'tencent-yue': { id: '16k_yue (标准版)', key: 'tencent', run: (wav) => tencentFile(creds, '16k_yue', wav, log('tencent-yue')) },
    'tencent-2.0': { id: '16k_multi_lang (大模型2.0)', key: 'tencent', run: (wav) => tencentFile(creds, '16k_multi_lang', wav, log('tencent-2.0')) },
    qwen: { id: 'qwen3-asr-flash-filetrans', key: 'dash', run: (wav) => dashTranscribe(keys.dash, 'qwen3-asr-flash-filetrans', wav, opts.lang, log('qwen')) },
    fun: { id: 'fun-asr', key: 'dash', run: (wav) => dashTranscribe(keys.dash, 'fun-asr', wav, opts.lang, log('fun')) },
    'qwen-audio': { id: 'qwen-audio-3.1-asr-flash-filetrans', key: 'dash', run: (wav) => dashTranscribe(keys.dash, 'qwen-audio-3.1-asr-flash-filetrans', wav, opts.lang, log('qwen-audio')) },
    scribe: { id: 'elevenlabs scribe_v2', key: 'eleven', run: (wav) => scribe(keys.eleven, wav, opts.lang) },
    openai: { id: 'openai gpt-transcribe', key: 'openai', run: (wav, totalMs) => openai(keys.openai, wav, opts.lang, opts.out, totalMs) },
  };
  const wanted = flag('arms', null) ? flag('arms').split(',').map((s) => s.trim()) : Object.keys(ARMS).filter((k) => keys[ARMS[k].key]);
  for (const w of wanted) { if (!ARMS[w]) throw new Error(`unknown arm ${w}`); if (!keys[ARMS[w].key]) throw new Error(`${w} needs ${{ dash: 'DASHSCOPE_API_KEY', eleven: 'ELEVENLABS_API_KEY', openai: 'OPENAI_API_KEY', tencent: 'the TENCENT_* keys (server only)' }[ARMS[w].key]} in .env`); }
  if (!wanted.length) throw new Error('no key in .env: TENCENT_*, DASHSCOPE_API_KEY, ELEVENLABS_API_KEY or OPENAI_API_KEY');
  function log(id) { return (m) => console.log(`  ${id.padEnd(12)} ${m}`); }

  fs.mkdirSync(opts.out, { recursive: true });
  const wav = await audioOf(file, opts.start, opts.seconds, opts.out);
  const totalMs = await durationOf(wav);
  console.log(`# ${path.basename(file)} — ${(totalMs / 60000).toFixed(1)} min from ${opts.start}s, ${opts.lang}, arms: ${wanted.join(', ')}`);

  // every service at once; each takes as long as it takes
  const results = await Promise.all(wanted.map(async (w) => {
    const t0 = Date.now();
    try { const rows = await ARMS[w].run(wav, totalMs); log(w)(`${rows.length} lines in ${Math.round((Date.now() - t0) / 1000)} s`); return { w, rows, ms: Date.now() - t0 }; }
    catch (err) { log(w)(`✖ ${err.message}`); return { w, rows: [], ms: null, error: err.message }; }
  }));

  const columns = [];
  const baseline = flag('baseline', null);
  if (baseline) columns.push({ id: 'app today (Tencent)', rows: readBaseline(baseline, opts.start * 1000, totalMs) });
  const slugOf = (w) => ARMS[w].id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  for (const r of results) {
    if (r.error) continue;
    fs.writeFileSync(path.join(opts.out, `${slugOf(r.w)}.srt`), srt(r.rows));
    fs.writeFileSync(path.join(opts.out, `${slugOf(r.w)}.jsonl`), r.rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
  }
  // every arm that has an answer in this folder, from this run or an earlier one of the same stretch
  for (const w of Object.keys(ARMS)) {
    const f = path.join(opts.out, `${slugOf(w)}.jsonl`);
    if (fs.existsSync(f)) columns.push({ id: ARMS[w].id, rows: fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) });
  }
  fs.writeFileSync(path.join(opts.out, 'side-by-side.md'), `# ${path.basename(file)} from ${opts.start}s, ${(totalMs / 60000).toFixed(1)} min\n\n${sideBySide(columns, totalMs)}`);
  const summary = { file: path.basename(file), start: opts.start, minutes: +(totalMs / 60000).toFixed(1), lang: opts.lang, at: new Date().toISOString(),
    arms: results.map((r) => ({ ...statsOf(ARMS[r.w].id, r.rows, totalMs, r.ms), error: r.error || null })) };
  if (baseline) summary.baseline = statsOf('app today (Tencent)', columns[0].rows, totalMs, null);
  fs.writeFileSync(path.join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.unlinkSync(wav);

  console.log('\n# summary');
  const row = (s) => console.log(`  ${s.id.padEnd(36)} ${String(s.lines).padStart(5)} lines ${String(s.characters).padStart(6)} chars  speech ${s.speechPct}%${s.tookSeconds != null ? `  took ${s.tookSeconds} s` : ''}${s.error ? `  ✖ ${s.error}` : ''}`);
  if (summary.baseline) row(summary.baseline);
  for (const c of columns.slice(baseline ? 1 : 0)) row(summary.arms.find((s) => s.id === c.id) || statsOf(`${c.id} (earlier run)`, c.rows, totalMs, null));
  console.log(`\n# written to ${opts.out}/ — read side-by-side.md`);
}

main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
