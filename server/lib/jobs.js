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
const dashscope = require('./dashscope');
const { buildCues, toSrt, toVtt, toTxt, toAss, toStackedAss, isCjkText } = require('./subtitles');
const { translateSentences, distribute } = require('./translate');
const { translateWhole, handles: wholeHandles } = require('./whole-translate');
const summaries = require('./summaries');

const MAX_DURATION_S = 5 * 3600;
const INLINE_LIMIT = 4.5 * 1024 * 1024; // CreateRecTask base64 payload cap is 5 MB
const POLL_MS = 5000;
const WHOLE_TIMEOUT_MS = 10 * 60_000; // one window of a file's translation; a window is minutes, not seconds

// Spoken language → Tencent batch engine, and the 混元翻译 (Hunyuan) source code. Hunyuan knows Cantonese
// (yue) as its own language, so Cantonese transcripts are no longer translated "as Mandarin".
// Every engine below was submitted to 录音文件识别 on the live account and came back `success`
// (server/probe-languages.js --engines, last run 2026-09-23: all 26 engines, 16k_zh_large among them) — the list
// is what the account can really run, not what the documentation advertises. `hunyuan: ''` means "let the
// translator detect the language".
// A language in dashscope.MODELS is recognised at 百炼 instead when the server has that key (engineFor).
//
// Cantonese files stay on `16k_yue`, though live talks use `16k_zh_large`: the two services are not the same
// engine behind the same name. Live, `16k_yue` ignores `hotword_list` and heard 17 of a talk's 43 terms against
// 42; in 录音文件识别, measured on seven minutes of a lecture (2026-09-23, `npm run probe:file --arms
// tencent,tencent-yue,tencent-2.0`), the two return the same Cantonese — 131 Cantonese-only characters against
// 128, 75 lines each — and `16k_yue` keeps clauses `16k_zh_large` drops, at ¥1.75 an hour against ¥2.40. The
// glossary is the thing that would change this: CreateRecTask takes a HotwordId and no job sends one yet.
// `16k_multi_lang` (大模型2.0, ¥0.80/h, the cheapest tier) detects the language itself and returned Korean and
// Vietnamese nonsense for Cantonese — it is for files whose language is unknown, not for a cheaper Cantonese.
// `16k_zh_en_2.0` (the 中文大模型 option) rewrites Cantonese into Mandarin while recognising, so the 粤语字幕
// export from it is not Cantonese; it stays for anyone who wants that, and for mixed Chinese and English.
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
/** The engine a kept transcript was heard by, or null when it does not say (or there is none). */
function heardByOf(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).Engine || null; } catch { return null; }
}

class JobRunner extends EventEmitter {
  /**
   * Translation backend, in order of preference:
   *   1. TokenHub (o.tokenhubKey set): hy-mt2-pro by default — the durable path.
   *   2. Legacy standalone Hunyuan API with the TC3 creds (hunyuan-translation) — works until 2026-09-30.
   * @param {object} o
   * @param {string} [o.tokenhubKey]  TokenHub API key (Bearer)
   * @param {string} [o.model]        translation model for the chosen backend
   * @param {Function} [o.translate]  override (tests): ({text, source, target}) → Promise<string>
   * @param {string} [o.dashscopeKey] 百炼 API key: the languages in dashscope.MODELS are recognised there instead of
   *                                  at Tencent (Japanese, since 2026-09-22); without it every language stays with Tencent
   * @param {string} [o.dashscopeBaseUrl] a stand-in for 百炼 (tests)
   * @param {string} [o.fileModel]    the chat model that translates a file whole (whole-translate.js), on TokenHub with
   *                                  the same key; default deepseek-v4-flash, 'off' for sentence by sentence only
   * @param {Function} [o.wholeAsk]   override (tests): (body) → Promise<{text, stopReason}>, one request to that model
   * @param {string} [o.tokenhubBaseUrl] a stand-in for TokenHub's chat endpoint (tests)
   */
  constructor({ db, dir, creds, baseUrl, log, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', tokenhubKey = '', model = '', translate = null, onDuration = null, uploadIdleMs = 120_000, uploadStaleMs = 24 * 3600_000, dashscopeKey = '', dashscopeBaseUrl = '', fileModel = '', wholeAsk = null, tokenhubBaseUrl = '' }) {
    super();
    this.db = db;
    this.dashscopeKey = String(dashscopeKey || '').trim();
    this.dashscopeBaseUrl = dashscopeBaseUrl || dashscope.BASE;
    this.uploadIdleMs = uploadIdleMs; // a connection that says nothing for this long has lost its sender
    this.uploadStaleMs = uploadStaleMs; // and a file nobody has sent a byte of for this long is not coming
    this.uploads = new Map(); // id -> {stop(why), closed}, for each upload arriving now
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
      // A model the account may not use is refused on every call; step down once and stay there, so a
      // file still comes back translated (server/lib/tokenhub.js, NEXT_MODEL). A model at its per-minute limit
      // hands its calls to the next one for a while instead, and leaves the limit to a live talk (RATE_FALLBACK).
      this.rateLimitedUntil = 0;
      this.translate = async ({ text, source, target }) => {
        let limited = false; // this call met the limit itself
        for (;;) {
          const base = this.model; // cues can be translated side by side; another may step down first
          const model = ((limited || Date.now() < this.rateLimitedUntil) && tokenhub.rateFallback(base)) || base;
          try {
            return await tokenhub.translate(tokenhubKey, { model, text, source, target });
          } catch (err) {
            const fromHub = err instanceof tokenhub.TokenHubError;
            if (fromHub && model === base && tokenhub.rateFallback(base) && tokenhub.isRateLimited(err.status, err.body, err.message)) {
              if (Date.now() >= this.rateLimitedUntil) this.log('info', `translation: ${base} is at its rate limit — ${tokenhub.rateFallback(base)} for the next ${tokenhub.RATE_COOLDOWN_MS / 1000} s`);
              this.rateLimitedUntil = Date.now() + tokenhub.RATE_COOLDOWN_MS;
              limited = true;
              continue;
            }
            const isRefusal = fromHub && tokenhub.isRefused(err.status, err.body, err.message);
            if (!isRefusal || model !== base) throw err; // the stand-in failing is an ordinary failure
            if (this.model === base) {
              const next = tokenhub.nextModel(model);
              if (!next) throw err;
              this.log('warn', `translation: TokenHub refused ${model} (${String(err.message).slice(0, 120)}) — using ${next} from now on`);
              this.model = next;
            }
          }
        }
      };
    } else {
      this.backend = 'hunyuan-legacy';
      this.model = model || LEGACY_MODEL;
      this.translate = async ({ text, source, target }) => {
        const r = await hunyuan(this.creds, 'ChatTranslations', { Model: this.model, Text: text, Source: source, Target: target, Stream: false });
        const c = r.Choices && r.Choices[0];
        return (c && c.Message && c.Message.Content) || '';
      };
    }
    // Files are translated whole by a chat model where it writes the pair well (whole-translate.js); the sentence-by-
    // sentence translator above stays for the other pairs, and for any window the model gets wrong.
    const wholeModel = String(fileModel || 'deepseek-v4-flash').trim();
    if (wholeModel !== 'off' && (wholeAsk || (tokenhubKey && !translate))) {
      // a window that never answers would hold the one job slot for ever: give up on it and let the window be
      // asked again, then translated sentence by sentence
      this.whole = { model: wholeModel, ask: wholeAsk || ((body) => summaries.ask({ key: tokenhubKey, baseUrl: tokenhubBaseUrl || undefined, body, signal: AbortSignal.timeout(WHOLE_TIMEOUT_MS) })) };
    } else this.whole = null;
    this.current = null;
    this.renders = new Map(); // id -> {percent}
    fs.mkdirSync(dir, { recursive: true });
  }

  jobDir(id) { return path.join(this.dir, id); }
  /** Which recogniser listens to a language: 百炼 where it hears better and the key is here, else Tencent. */
  engineFor(sourceLang) { return (this.dashscopeKey && dashscope.MODELS[sourceLang]) || ENGINES[sourceLang].engine; }
  get(id) { return this.db.get('SELECT * FROM jobs WHERE id = ?', id); }
  list(userId) { return this.db.all('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', userId).map((j) => this.view(j)); }
  view(j) {
    if (!j) return null;
    const d = this.jobDir(j.id);
    const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.(srt|vtt|txt|mp4)$/.test(f) && !f.startsWith('.') && f !== 'audio.mp3').sort() : [];
    // an upload says how much of it is here (a sender that lost its connection carries on from there) and whether
    // anything is arriving now — "uploading" with nobody sending is a file waiting for its sender to come back
    const upload = j.status === 'uploading' ? { received: this._partSize(j), receiving: this.uploads.has(j.id) } : {};
    return { ...j, ...upload, files, versions: this.versions(j.id), render: this.renders.get(j.id) || null, engineLabel: (ENGINES[j.source_lang] || {}).label, targetLabel: TARGETS[j.target_lang] };
  }
  _sourcePath(job) {
    const ext = (path.extname(job.filename) || '.bin').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8) || '.bin';
    return path.join(this.jobDir(job.id), `source${ext}`);
  }
  _partSize(job) { try { return fs.statSync(`${this._sourcePath(job)}.part`).size; } catch { return 0; } }

  create(userId, { filename, size, sourceLang, targetLang }) {
    if (!ENGINES[sourceLang]) throw new Error(`unknown source language "${sourceLang}"`);
    if (!(targetLang in TARGETS)) throw new Error(`unknown target language "${targetLang}"`);
    const id = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    this.db.run('INSERT INTO jobs(id, user_id, filename, size, source_lang, target_lang, engine, status, media_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, userId, String(filename || 'video').slice(0, 200), Number(size) || null, sourceLang, targetLang, this.engineFor(sourceLang), 'uploading', crypto.randomBytes(16).toString('hex'), now, now);
    fs.mkdirSync(this.jobDir(id), { recursive: true });
    return this.get(id);
  }

  /**
   * Stream the request body onto <job>/source.<ext>.part; once the whole file is there, queue the job.
   * An upload that breaks off — the connection drops, or nothing arrives for uploadIdleMs — keeps what arrived:
   * the sender asks the job how much the server has (`received`) and sends the rest with ?offset=. Without an
   * offset the file starts again from nothing. sweepUploads drops a file nobody comes back to.
   */
  async uploadStream(job, req, offset = 0) {
    // the sender is back on a new connection before the old one was seen to die: the new one has the file now
    const before = this.uploads.get(job.id);
    if (before) { before.stop('upload taken over by a new connection'); await before.closed; }
    if (req.destroyed) throw new Error('upload interrupted');
    const file = this._sourcePath(job);
    const have = this._partSize(job);
    if (offset && offset !== have) throw Object.assign(new Error(`the server has ${have} bytes of this file, not ${offset}`), { code: 'upload_offset', received: have });
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(`${file}.part`, { flags: offset ? 'a' : 'w' });
      let bytes = 0;
      let over = false;
      const entry = { stop: null, closed: new Promise((r) => out.on('close', r)) };
      const idle = setTimeout(() => entry.stop(`upload stalled: nothing arrived for ${Math.round(this.uploadIdleMs / 1000)} s`), this.uploadIdleMs);
      entry.stop = (why) => {
        if (over) return;
        over = true;
        clearTimeout(idle);
        req.unpipe(out); out.end(); req.destroy();
        entry.closed.then(() => {
          if (this.uploads.get(job.id) === entry) this.uploads.delete(job.id);
          if (this.get(job.id)) this._update(job.id, { status: 'uploading' }); // updated_at: when the sender was last heard from
        });
        reject(new Error(why));
      };
      this.uploads.set(job.id, entry);
      req.on('data', (d) => { bytes += d.length; idle.refresh(); });
      req.on('aborted', () => entry.stop('upload interrupted'));
      req.on('error', () => entry.stop('upload interrupted'));
      req.pipe(out);
      out.on('error', (err) => entry.stop(err.message));
      out.on('finish', () => {
        if (over) return;
        over = true;
        clearTimeout(idle);
        this.uploads.delete(job.id);
        const total = offset + bytes;
        // pieces sent at different times are only the file if they add up to it
        if (offset && job.size && total !== job.size) {
          fs.rmSync(`${file}.part`, { force: true });
          const why = `upload does not match the file: ${total} bytes arrived, ${job.size} expected`;
          this._update(job.id, { status: 'failed', error: why });
          return reject(new Error(why));
        }
        fs.renameSync(`${file}.part`, file);
        this._update(job.id, { status: 'queued', size: total, progress: 0, error: null });
        resolve(total);
        this.kick();
      });
    });
  }
  /** Uploads nobody came back to: what arrived is dropped and the job says so. */
  sweepUploads() {
    for (const j of this.db.all("SELECT * FROM jobs WHERE status = 'uploading' AND updated_at < ?", Date.now() - this.uploadStaleMs)) {
      if (this.uploads.has(j.id)) continue;
      fs.rmSync(`${this._sourcePath(j)}.part`, { force: true });
      this._update(j.id, { status: 'failed', error: 'upload never completed' });
    }
  }

  /** What a run made: everything in the job's folder but the upload, the audio taken from it, the versions and working files. */
  _outputs(id) {
    const d = this.jobDir(id);
    return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => !/^source\./.test(f) && f !== 'audio.mp3' && f !== 'versions' && !f.endsWith('.part') && !f.startsWith('.')) : [];
  }
  /** The earlier sets of subtitles (and whatever was made from them) this job has had, oldest first: versions/<n>/ with a version.json. */
  versions(id) {
    const d = path.join(this.jobDir(id), 'versions');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b).map((n) => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(d, String(n), 'version.json'), 'utf8')); } catch { /* the files are still worth listing */ }
      const files = fs.readdirSync(path.join(d, String(n))).filter((f) => /\.(srt|vtt|txt|mp4)$/.test(f)).sort();
      return { n, ...meta, sourceLabel: (ENGINES[meta.sourceLang] || {}).label, targetLabel: TARGETS[meta.targetLang], files };
    });
  }
  versionFile(id, n, name) { return path.join(this.jobDir(id), 'versions', String(Number(n) || 0), path.basename(name)); }
  /**
   * Make the subtitles again, in other languages: a file is in its own languages, and the first guess can be wrong.
   * Nothing made so far is lost — the cues (with the edits made to them), every export and every MP4 move to
   * versions/<n>/ first. The upload stays, so nothing is sent again; and when only the subtitle language changes the
   * recognition is kept too (_run), so nothing is recognised, or counted against the plan, twice.
   */
  regenerate(id, { sourceLang, targetLang }) {
    const job = this.get(id);
    if (!job) throw new Error('no such job');
    if (!ENGINES[sourceLang]) throw new Error(`unknown source language "${sourceLang}"`);
    if (!(targetLang in TARGETS)) throw new Error(`unknown target language "${targetLang}"`);
    if (!['done', 'failed'].includes(job.status) || (this.current && this.current.id === id)) throw new Error('the job is still running; wait for it to finish');
    if (this.renders.has(id)) throw new Error('an MP4 is being made from these subtitles; wait for it to finish');
    if (!this.sourceFile(id)) throw new Error('the uploaded file is no longer on the server: add it again');
    const dir = this.jobDir(id);
    const made = this._outputs(id);
    if (made.includes('cues.json')) {
      const n = (this.versions(id).at(-1) || { n: 0 }).n + 1;
      const to = path.join(dir, 'versions', String(n));
      fs.mkdirSync(to, { recursive: true });
      for (const f of made) {
        if (f === 'asr.json') fs.copyFileSync(path.join(dir, f), path.join(to, f)); // what was heard is also what the next version starts from
        else fs.renameSync(path.join(dir, f), path.join(to, f));
      }
      fs.writeFileSync(path.join(to, 'version.json'), JSON.stringify({ sourceLang: job.source_lang, targetLang: job.target_lang, engine: job.engine, cues: job.cues, madeAt: job.updated_at, keptAt: Date.now() }));
      this.log('info', `job ${id}: ${job.source_lang} → ${job.target_lang} kept as version ${n} (${made.length} files)`);
    }
    // What was heard is kept only if the same recogniser would hear it again: heard as another language, or by an
    // engine this language no longer uses (Japanese moved from Tencent 16k_ja to 百炼 fun-asr on 2026-09-22, and a
    // re-subtitled Japanese file kept Tencent's half-deaf transcript), it has to be heard again.
    // The transcript says which engine made it; one from before that (every file until 2026-09-22) was Tencent's.
    const engine = this.engineFor(sourceLang);
    const heardBy = heardByOf(path.join(dir, 'asr.json'));
    const stale = heardBy ? heardBy !== engine : dashscope.isAlibaba(engine);
    if (sourceLang !== job.source_lang || stale) fs.rmSync(path.join(dir, 'asr.json'), { force: true });
    this._update(id, { source_lang: sourceLang, target_lang: targetLang, engine, status: 'queued', progress: 0, error: null, cues: 0, task_id: null });
    this.kick();
    return this.get(id);
  }

  remove(id) {
    if (this.current && this.current.id === id) throw new Error('job is running; wait for it to finish');
    const arriving = this.uploads.get(id);
    if (arriving) arriving.stop('upload cancelled');
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
    // an upload the last server was receiving is carried on by its sender (uploadStream); only the abandoned go
    this.sweepUploads();
    setInterval(() => this.sweepUploads(), 3600_000).unref();
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
    // What was heard in this file, in this language, is kept (regenerate drops it when the language changes): subtitles
    // made again in another language, and a failed translation tried again, recognise nothing twice.
    const asrFile = path.join(dir, 'asr.json');
    const heard = !job.task_id && fs.existsSync(asrFile);
    if (this.onDuration && !job.task_id && !heard) await this.onDuration(job, meta.duration); // a resumed recognition was already counted; one kept is not counted again
    this._update(id, { duration: meta.duration });

    // 1. extract 16 kHz mono audio (skip if resuming a recognition)
    let taskId = job.task_id;
    if (!heard && (!taskId || !fs.existsSync(audio))) {
      this._progress(id, 'extracting', 0);
      await run(this.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-f', 'mp3', `${audio}.part`], {
        onStdout: (t) => { const m = /out_time_us=(\d+)/g; let last = null; let r; while ((r = m.exec(t))) last = Number(r[1]); if (last != null && meta.duration) this._progress(id, 'extracting', (last / 1e6 / meta.duration) * 100); },
      });
      fs.renameSync(`${audio}.part`, audio);
      taskId = null;
    }

    // 2. batch recognition — at 百炼 for the languages it hears better (job.engine names the service), else Tencent
    const alibaba = dashscope.isAlibaba(job.engine);
    const ds = { baseUrl: this.dashscopeBaseUrl };
    if (!heard && !taskId && alibaba) {
      this._progress(id, 'recognizing', 0);
      if (!this.dashscopeKey) throw new Error(`recognition with ${job.engine} needs DASHSCOPE_API_KEY on the server`);
      const url = await dashscope.upload(this.dashscopeKey, job.engine, audio, ds);
      taskId = await dashscope.submit(this.dashscopeKey, { model: job.engine, url, lang: job.source_lang, ...ds });
      this._update(id, { task_id: taskId });
      this.log('info', `job ${id}: 百炼 ${job.engine} task ${taskId} (${(fs.statSync(audio).size / 1e6).toFixed(1)} MB)`);
    }
    if (!heard && !taskId) {
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
    let result = heard ? JSON.parse(fs.readFileSync(asrFile, 'utf8')) : null;
    let unreachable = 0; // polls in a row that could not reach 百炼 at all
    while (!result) {
      await sleep(POLL_MS);
      if (alibaba) {
        let st;
        try {
          st = await dashscope.status(this.dashscopeKey, taskId, ds);
          unreachable = 0;
        } catch (err) {
          // the task goes on at 百炼 whether or not we can see it: ride out a link that is down for a while
          // (each poll already tried four times), and give up only after about two minutes of nothing
          if (err.status !== 0 && !(err.status >= 500) || ++unreachable >= 12) throw err;
          this.log('warn', `job ${id}: 百炼 poll ${unreachable}: ${err.message}`);
          continue;
        }
        if (st.status === 'SUCCEEDED') { result = { ResultDetail: dashscope.toResultDetail(st.sentences), Engine: job.engine }; break; }
        if (st.status === 'FAILED' || st.status === 'CANCELED' || st.status === 'UNKNOWN') throw new Error(`recognition failed: ${st.message || st.status}`);
      } else {
        const r = await asr(this.creds, 'DescribeTaskStatus', { TaskId: taskId });
        const st = r.Data || {};
        if (st.Status === 2) { result = st; break; }
        if (st.Status === 3) throw new Error(`recognition failed: ${st.ErrorMsg || 'unknown error'}`);
      }
      this._progress(id, 'recognizing', Math.min(95, ((Date.now() - t0) / expectedMs) * 100));
    }
    if (!heard) fs.writeFileSync(asrFile, JSON.stringify({ ...result, Engine: result.Engine || job.engine })); // who heard it, for regenerate

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
    const onProgress = (done, total) => this._progress(id, 'translating', (done / total) * 100);
    const bySentence = (items) => translateSentences(items, { call: this.translate, source, target });
    let translations = null;
    if (this.whole && wholeHandles(source, target)) {
      const t0 = Date.now();
      try {
        const r = await translateWhole(texts, { ask: this.whole.ask, model: this.whole.model, source, target, fallback: bySentence, onProgress,
          log: (m) => this.log('warn', `job ${id}: ${this.whole.model}: ${m}`) });
        translations = r.translations;
        this.log('info', `job ${id}: translated whole with ${this.whole.model} — ${texts.length} sentences in ${r.windows} windows, ${Math.round((Date.now() - t0) / 1000)} s`
          + `${r.fellBack ? `, ${r.fellBack} window(s) sentence by sentence` : ''}${r.filled ? `, ${r.filled} sentence(s) filled in by ${this.model}` : ''}`);
      } catch (err) {
        this.log('warn', `job ${id}: whole-file translation with ${this.whole.model} failed (${err.message}) — sentence by sentence with ${this.model}`);
      }
    }
    if (!translations) translations = await translateSentences(texts, { call: this.translate, source, target, onProgress });
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

module.exports = { JobRunner, ENGINES, TARGETS };
