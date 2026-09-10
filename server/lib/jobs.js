'use strict';
// Upload → transcript → subtitles pipeline. One job at a time, resumable by status after a restart.
//   uploading → queued → extracting → recognizing → segmenting → translating → rendering → done | failed
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const { fromTexts } = require('@subs/core/plain-text');
const { asr, hunyuan } = require('./tc3');
const tokenhub = require('./tokenhub');
const { buildCues, toSrt, toVtt, toTxt, toAss, toStackedAss, isCjkText } = require('./subtitles');
const { translateSentences, distribute } = require('./translate');

const MAX_DURATION_S = 5 * 3600;
const INLINE_LIMIT = 4.5 * 1024 * 1024; // CreateRecTask base64 payload cap is 5 MB
const POLL_MS = 5000;

// Spoken language → Tencent batch engine, and the 混元翻译 (Hunyuan) source code. Hunyuan knows Cantonese
// (yue) as its own language, so Cantonese transcripts are no longer translated "as Mandarin".
// Every engine below was submitted to 录音文件识别 on the live account and came back `success`
// (server/probe-languages.js --engines, last run 2026-09-10) — the list is what the account can really run,
// not what the documentation advertises. `hunyuan: ''` means "let the translator detect the language".
const ENGINES = {
  yue: { engine: '16k_yue', hunyuan: 'yue', label: '粤语 Cantonese' },
  zh: { engine: '16k_zh', hunyuan: 'zh', label: '普通话 Mandarin' },
  mixed: { engine: '16k_zh-PY', hunyuan: 'zh', label: '中英粤混合 Mandarin + English + Cantonese' },
  zh_large: { engine: '16k_zh_en_2.0', hunyuan: 'zh', label: '中文大模型 Chinese large model (Mandarin, Cantonese, English, dialects)' },
  'zh-TW': { engine: '16k_zh-TW', hunyuan: 'zh', label: '繁體中文 Chinese (Traditional)' },
  en: { engine: '16k_en', hunyuan: 'en', label: 'English' },
  en_large: { engine: '16k_en_large', hunyuan: 'en', label: 'English large model' },
  ja: { engine: '16k_ja', hunyuan: 'ja', label: '日本語 Japanese' },
  ko: { engine: '16k_ko', hunyuan: 'ko', label: '한국어 Korean' },
  vi: { engine: '16k_vi', hunyuan: 'vi', label: 'Tiếng Việt Vietnamese' },
  th: { engine: '16k_th', hunyuan: 'th', label: 'ไทย Thai' },
  id: { engine: '16k_id', hunyuan: 'id', label: 'Bahasa Indonesia' },
  ms: { engine: '16k_ms', hunyuan: 'ms', label: 'Bahasa Melayu Malay' },
  fil: { engine: '16k_fil', hunyuan: 'fil', label: 'Filipino' },
  es: { engine: '16k_es', hunyuan: 'es', label: 'Español Spanish' },
  pt: { engine: '16k_pt', hunyuan: 'pt', label: 'Português Portuguese' },
  fr: { engine: '16k_fr', hunyuan: 'fr', label: 'Français French' },
  de: { engine: '16k_de', hunyuan: 'de', label: 'Deutsch German' },
  tr: { engine: '16k_tr', hunyuan: 'tr', label: 'Türkçe Turkish' },
  ar: { engine: '16k_ar', hunyuan: 'ar', label: 'العربية Arabic' },
  hi: { engine: '16k_hi', hunyuan: 'hi', label: 'हिन्दी Hindi' },
  multi: { engine: '16k_multi_lang', hunyuan: '', label: '多语种自动识别 Multi-language (auto)' },
};
// Subtitle languages: the 31 targets 混元翻译 accepted from the live TokenHub key (same probe, --translate).
// The legacy standalone Hunyuan API covers fewer of these; it stops on 2026-09-30 and TokenHub is the path.
const TARGETS = {
  none: 'no translation',
  zh: '简体中文', 'zh-TW': '繁體中文', yue: '粤语 Cantonese',
  en: 'English', ja: '日本語', ko: '한국어',
  vi: 'Tiếng Việt', th: 'ไทย', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu', fil: 'Filipino',
  es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano', nl: 'Nederlands',
  pl: 'Polski', cs: 'Čeština', ru: 'Русский', uk: 'Українська', tr: 'Türkçe',
  ar: 'العربية', he: 'עברית', fa: 'فارسی', ur: 'اردو', hi: 'हिन्दी', bn: 'বাংলা',
  bo: 'བོད་སྐད་ Tibetan', ug: 'ئۇيغۇرچە Uyghur', mn: 'ᠮᠣᠩᠭᠣᠯ Mongolian',
};
// job target code → Hunyuan / TokenHub target code (identical apart from Traditional Chinese, spelled zh-TR)
const HUNYUAN_TARGET = Object.fromEntries(Object.keys(TARGETS).filter((k) => k !== 'none').map((k) => [k, k === 'zh-TW' ? 'zh-TR' : k]));
const LEGACY_MODEL = 'hunyuan-translation'; // standalone Hunyuan API, stops on 2026-09-30

const safeName = (s) => String(s || 'video').replace(/\.[^.]+$/, '').replace(/[^\w一-鿿぀-ヿ가-힯 .-]+/g, '_').slice(0, 80) || 'video';

function run(cmd, args, { cwd, onStdout, timeoutMs = 6 * 3600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', (d) => onStdout && onStdout(d.toString()));
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`)); });
  });
}
function probe(ffprobe, file) {
  return new Promise((resolve, reject) => {
    execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { timeout: 60_000 }, (err, out) => {
      if (err) return reject(new Error(`ffprobe: ${err.message.split('\n')[0]}`));
      try {
        const j = JSON.parse(out);
        const v = (j.streams || []).find((s) => s.codec_type === 'video');
        const a = (j.streams || []).find((s) => s.codec_type === 'audio');
        resolve({ duration: Number(j.format && j.format.duration) || 0, hasVideo: !!v, hasAudio: !!a, width: v && v.width, height: v && v.height });
      } catch (e) { reject(new Error(`ffprobe: ${e.message}`)); }
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class JobRunner extends EventEmitter {
  /**
   * Translation backend, in order of preference:
   *   1. TokenHub (o.tokenhubKey set): hy-mt2-pro by default — the durable path.
   *   2. Legacy standalone Hunyuan API with the TC3 creds (hunyuan-translation) — works until 2026-09-30.
   * @param {object} o
   * @param {string} [o.tokenhubKey]  TokenHub API key (Bearer)
   * @param {string} [o.model]        translation model for the chosen backend
   * @param {Function} [o.translate]  override (tests): ({text, source, target}) → Promise<string>
   */
  constructor({ db, dir, creds, baseUrl, log, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', tokenhubKey = '', model = '', translate = null, onDuration = null }) {
    super();
    this.db = db;
    this.onDuration = onDuration; // (job, seconds) → may throw to refuse the file (plan quota); called once the duration is known
    this.dir = dir;
    this.creds = creds;
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.log = log || (() => {});
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
    if (translate) {
      this.backend = 'custom';
      this.model = model || 'custom';
      this.translate = translate;
    } else if (tokenhubKey) {
      this.backend = 'tokenhub';
      this.model = model || tokenhub.DEFAULT_MODEL;
      this.translate = ({ text, source, target }) => tokenhub.translate(tokenhubKey, { model: this.model, text, source, target });
    } else {
      this.backend = 'hunyuan-legacy';
      this.model = model || LEGACY_MODEL;
      this.translate = async ({ text, source, target }) => {
        const r = await hunyuan(this.creds, 'ChatTranslations', { Model: this.model, Text: text, Source: source, Target: target, Stream: false });
        const c = r.Choices && r.Choices[0];
        return (c && c.Message && c.Message.Content) || '';
      };
    }
    this.current = null;
    this.renders = new Map(); // id -> {percent}
    fs.mkdirSync(dir, { recursive: true });
  }

  jobDir(id) { return path.join(this.dir, id); }
  get(id) { return this.db.get('SELECT * FROM jobs WHERE id = ?', id); }
  list(userId) { return this.db.all('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', userId).map((j) => this.view(j)); }
  view(j) {
    if (!j) return null;
    const d = this.jobDir(j.id);
    const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.(srt|vtt|txt|mp4)$/.test(f) && !f.startsWith('.') && f !== 'audio.mp3').sort() : [];
    return { ...j, files, render: this.renders.get(j.id) || null, engineLabel: (ENGINES[j.source_lang] || {}).label, targetLabel: TARGETS[j.target_lang] };
  }

  create(userId, { filename, size, sourceLang, targetLang }) {
    if (!ENGINES[sourceLang]) throw new Error(`unknown source language "${sourceLang}"`);
    if (!(targetLang in TARGETS)) throw new Error(`unknown target language "${targetLang}"`);
    const id = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    this.db.run('INSERT INTO jobs(id, user_id, filename, size, source_lang, target_lang, engine, status, media_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, userId, String(filename || 'video').slice(0, 200), Number(size) || null, sourceLang, targetLang, ENGINES[sourceLang].engine, 'uploading', crypto.randomBytes(16).toString('hex'), now, now);
    fs.mkdirSync(this.jobDir(id), { recursive: true });
    return this.get(id);
  }

  /** Stream the request body to <job>/source.<ext>; then queue the job. */
  uploadStream(job, req) {
    const ext = (path.extname(job.filename) || '.bin').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8) || '.bin';
    const file = path.join(this.jobDir(job.id), `source${ext}`);
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(`${file}.part`);
      let bytes = 0;
      req.on('data', (d) => { bytes += d.length; });
      req.on('aborted', () => { out.destroy(); reject(new Error('upload aborted')); });
      req.pipe(out);
      out.on('error', reject);
      out.on('finish', () => {
        fs.renameSync(`${file}.part`, file);
        this._update(job.id, { status: 'queued', size: bytes, progress: 0, error: null });
        resolve(bytes);
        this.kick();
      });
    });
  }

  remove(id) {
    if (this.current && this.current.id === id) throw new Error('job is running; wait for it to finish');
    this.db.run('DELETE FROM jobs WHERE id = ?', id);
    fs.rmSync(this.jobDir(id), { recursive: true, force: true });
  }

  sourceFile(id) {
    const d = this.jobDir(id);
    return fs.existsSync(d) ? fs.readdirSync(d).map((f) => path.join(d, f)).find((f) => /\/source\.[a-z0-9]+$/.test(f) && !f.endsWith('.part')) : null;
  }
  cues(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.jobDir(id), 'cues.json'), 'utf8')); } catch { return null; }
  }
  saveCues(id, cues) {
    const clean = (Array.isArray(cues) ? cues : []).map((c, i) => ({ id: i + 1, start: Math.max(0, Math.round(Number(c.start) || 0)), end: Math.max(0, Math.round(Number(c.end) || 0)), text: String(c.text || '').trim(), trans: String(c.trans || '').trim(), speaker: c.speaker ?? null }))
      .filter((c) => c.text || c.trans).sort((a, b) => a.start - b.start);
    for (const c of clean) if (c.end <= c.start) c.end = c.start + 500;
    const job = this.get(id);
    const data = { cues: clean, sourceLang: job.source_lang, targetLang: job.target_lang, updatedAt: Date.now() };
    fs.writeFileSync(path.join(this.jobDir(id), 'cues.json'), JSON.stringify(data));
    this._update(id, { cues: clean.length });
    this.writeTextExports(id, clean);
    return data;
  }

  _update(id, patch) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.db.run(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => patch[k]), Date.now(), id);
    this.emit('update', this.view(this.get(id)));
  }
  _progress(id, status, progress) { this._update(id, { status, progress: Math.max(0, Math.min(100, Math.round(progress))) }); }

  /** Resume interrupted jobs after a restart, then start the next queued one. */
  resume() {
    for (const j of this.db.all("SELECT id, status FROM jobs WHERE status IN ('extracting','segmenting','translating','rendering')")) this._update(j.id, { status: 'queued', progress: 0 });
    for (const j of this.db.all("SELECT id FROM jobs WHERE status = 'uploading' AND updated_at < ?", Date.now() - 6 * 3600_000)) this._update(j.id, { status: 'failed', error: 'upload never completed' });
    this.kick();
  }
  kick() {
    if (this.current) return;
    const next = this.db.get("SELECT * FROM jobs WHERE status IN ('queued','recognizing') ORDER BY created_at LIMIT 1");
    if (!next) return;
    this.current = next;
    this._run(next).catch((err) => {
      this.log('error', `job ${next.id} failed: ${err.message}`);
      this._update(next.id, { status: 'failed', error: err.message.slice(0, 500) });
    }).finally(() => { this.current = null; setImmediate(() => this.kick()); });
  }

  async _run(job) {
    const id = job.id;
    const dir = this.jobDir(id);
    const audio = path.join(dir, 'audio.mp3');
    const src = this.sourceFile(id);
    if (!src) throw new Error('source file is missing');
    const meta = await probe(this.ffprobe, src);
    if (!meta.hasAudio) throw new Error('the file has no audio track');
    if (meta.duration > MAX_DURATION_S) throw new Error(`audio is ${(meta.duration / 3600).toFixed(1)} h; the limit is 5 h`);
    if (this.onDuration && !job.task_id) await this.onDuration(job, meta.duration); // a resumed recognition was already counted
    this._update(id, { duration: meta.duration });

    // 1. extract 16 kHz mono audio (skip if resuming a recognition)
    let taskId = job.task_id;
    if (!taskId || !fs.existsSync(audio)) {
      this._progress(id, 'extracting', 0);
      await run(this.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-f', 'mp3', `${audio}.part`], {
        onStdout: (t) => { const m = /out_time_us=(\d+)/g; let last = null; let r; while ((r = m.exec(t))) last = Number(r[1]); if (last != null && meta.duration) this._progress(id, 'extracting', (last / 1e6 / meta.duration) * 100); },
      });
      fs.renameSync(`${audio}.part`, audio);
      taskId = null;
    }

    // 2. batch recognition
    if (!taskId) {
      this._progress(id, 'recognizing', 0);
      const size = fs.statSync(audio).size;
      const payload = { EngineModelType: job.engine, ChannelNum: 1, ResTextFormat: 1, SourceType: 0 };
      if (size <= INLINE_LIMIT) {
        payload.SourceType = 1;
        payload.Data = fs.readFileSync(audio).toString('base64');
        payload.DataLen = size;
      } else {
        if (!/^https?:\/\//.test(this.baseUrl)) throw new Error('BASE_URL must be a public URL so Tencent can fetch audio longer than a few minutes');
        payload.Url = `${this.baseUrl}/media/${job.media_token}.mp3`;
      }
      const created = await asr(this.creds, 'CreateRecTask', payload);
      taskId = created.Data.TaskId;
      this._update(id, { task_id: taskId });
      this.log('info', `job ${id}: CreateRecTask ${taskId} (${job.engine}, ${(size / 1e6).toFixed(1)} MB ${payload.Url ? 'by URL' : 'inline'})`);
    }
    const t0 = Date.now();
    const expectedMs = Math.max(15_000, (meta.duration / 25) * 1000);
    let result;
    for (;;) {
      await sleep(POLL_MS);
      const r = await asr(this.creds, 'DescribeTaskStatus', { TaskId: taskId });
      const st = r.Data || {};
      if (st.Status === 2) { result = st; break; }
      if (st.Status === 3) throw new Error(`recognition failed: ${st.ErrorMsg || 'unknown error'}`);
      this._progress(id, 'recognizing', Math.min(95, ((Date.now() - t0) / expectedMs) * 100));
    }
    fs.writeFileSync(path.join(dir, 'asr.json'), JSON.stringify(result));

    // 3. cues
    this._progress(id, 'segmenting', 100);
    const cues = buildCues(result.ResultDetail || []);
    if (!cues.length) throw new Error('no speech was recognised in this file');

    // 4. translation
    if (job.target_lang !== 'none') {
      await this._translate(id, cues, ENGINES[job.source_lang].hunyuan, HUNYUAN_TARGET[job.target_lang]);
    }
    for (const c of cues) delete c.sentence;

    // 5. exports
    this._progress(id, 'rendering', 100);
    fs.writeFileSync(path.join(dir, 'cues.json'), JSON.stringify({ cues, sourceLang: job.source_lang, targetLang: job.target_lang, updatedAt: Date.now() }));
    this.writeTextExports(id, cues);
    this._update(id, { status: 'done', progress: 100, cues: cues.length, task_id: null, error: null });
    this.log('info', `job ${id}: done, ${cues.length} cues for ${(meta.duration / 60).toFixed(1)} min`);
  }

  /**
   * Translate whole recognised sentences (not the ≤ 22-character cues), then share each translation
   * over the sentence's cues in proportion to their length. Cues carry `sentence` from buildCues; a cue
   * without one (edited or legacy) is translated on its own.
   */
  async _translate(id, cues, source, target) {
    const groups = new Map();
    for (const c of cues) {
      const key = c.sentence ?? `cue-${c.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const list = [...groups.values()];
    const texts = list.map((g) => (isCjkText(g.map((c) => c.text).join('')) ? g.map((c) => c.text).join('') : g.map((c) => c.text).join(' ')));
    const translations = await translateSentences(texts, {
      call: this.translate,
      source,
      target,
      onProgress: (done, total) => this._progress(id, 'translating', (done / total) * 100),
    });
    list.forEach((g, i) => {
      const parts = distribute(translations[i], g.map((c) => [...c.text].length));
      g.forEach((c, k) => { c.trans = parts[k] || ''; });
    });
  }

  writePlainExports(id, cues) {
    const job = this.get(id);
    const base = safeName(job.filename);
    const dir = this.jobDir(id);
    fs.writeFileSync(path.join(dir, `${base}.original.${job.source_lang}.plain.txt`), fromTexts(cues.map(c => c.text)));
    if (job.target_lang !== 'none' && cues.some(c => c.trans)) {
      fs.writeFileSync(path.join(dir, `${base}.translated.${job.target_lang}.plain.txt`), fromTexts(cues.map(c => c.trans)));
    }
  }

  backfillPlainExports() {
    let count = 0;
    for (const job of this.db.all('SELECT id FROM jobs')) {
      const data = this.cues(job.id);
      if (data && data.cues && data.cues.length) { this.writePlainExports(job.id, data.cues); count++; }
    }
    return count;
  }

  writeTextExports(id, cues) {
    const job = this.get(id);
    const dir = this.jobDir(id);
    const base = safeName(job.filename);
    for (const f of fs.readdirSync(dir)) if (/\.(srt|vtt|txt)$/.test(f)) fs.rmSync(path.join(dir, f));
    this.writePlainExports(id, cues);
    fs.writeFileSync(path.join(dir, `${base}.${job.source_lang}.srt`), toSrt(cues, 'text'));
    fs.writeFileSync(path.join(dir, `${base}.${job.source_lang}.vtt`), toVtt(cues, 'text'));
    fs.writeFileSync(path.join(dir, `${base}.${job.source_lang}.txt`), toTxt(cues, 'text'));
    if (job.target_lang !== 'none' && cues.some((c) => c.trans)) {
      fs.writeFileSync(path.join(dir, `${base}.${job.target_lang}.srt`), toSrt(cues, 'trans'));
      fs.writeFileSync(path.join(dir, `${base}.${job.target_lang}.vtt`), toVtt(cues, 'trans'));
      fs.writeFileSync(path.join(dir, `${base}.${job.target_lang}.txt`), toTxt(cues, 'trans'));
      fs.writeFileSync(path.join(dir, `${base}.bilingual.srt`), toSrt(cues, 'both'));
      fs.writeFileSync(path.join(dir, `${base}.bilingual.vtt`), toVtt(cues, 'both'));
    }
  }

  /** Burn subtitles into a copy of the source video (which: 'text' | 'trans' | 'both'). */
  async renderMp4(id, { which = 'trans', fontSize } = {}) {
    const job = this.get(id);
    if (!job || job.status !== 'done') throw new Error('job is not finished');
    if (this.renders.has(id)) throw new Error('an MP4 render is already running for this job');
    const src = this.sourceFile(id);
    const data = this.cues(id);
    if (!src || !data) throw new Error('missing source or cues');
    const dir = this.jobDir(id);
    const meta = await probe(this.ffprobe, src);
    // Video uploads keep classic bottom subtitles over the picture. Audio-only uploads get a portrait
    // black canvas with the sentences stacked up the frame, like the live display (no embedded
    // subtitle tracks, so players never draw a second copy).
    const stacked = !meta.hasVideo;
    const width = stacked ? 1080 : (meta.width || 1920);
    const height = stacked ? 1920 : (meta.height || 1080);
    const ass = path.join(dir, 'subs.ass');
    fs.writeFileSync(ass, stacked ? toStackedAss(data.cues, { which, width, height, fontSize }) : toAss(data.cues, { which, width, height, fontSize }));
    const base = safeName(job.filename);
    const out = path.join(dir, `${base}.${which === 'text' ? job.source_lang : which === 'both' ? 'bilingual' : job.target_lang}.mp4`);
    const state = { percent: 0, which, startedAt: Date.now() };
    this.renders.set(id, state);
    this.emit('update', this.view(job));
    try {
      const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-i', src];
      if (meta.hasVideo) args.push('-vf', 'ass=subs.ass', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
      else args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=15:d=${Math.ceil(meta.duration)}`, '-map', '1:v', '-map', '0:a', '-sn', '-vf', 'ass=subs.ass', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-tune', 'stillimage', '-shortest');
      args.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', `${out}.part`);
      await run(this.ffmpeg, args, {
        cwd: dir,
        onStdout: (t) => { const m = /out_time_us=(\d+)/g; let last = null; let r; while ((r = m.exec(t))) last = Number(r[1]); if (last != null && meta.duration) { state.percent = Math.min(99, Math.round((last / 1e6 / meta.duration) * 100)); this.emit('update', this.view(this.get(id))); } },
      });
      fs.renameSync(`${out}.part`, out);
      this.log('info', `job ${id}: MP4 rendered ${path.basename(out)} in ${Math.round((Date.now() - state.startedAt) / 1000)} s`);
      return path.basename(out);
    } finally {
      fs.rmSync(`${out}.part`, { force: true });
      this.renders.delete(id);
      this.emit('update', this.view(this.get(id)));
    }
  }
}

module.exports = { JobRunner, ENGINES, TARGETS, safeName };
