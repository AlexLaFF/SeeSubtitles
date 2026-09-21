'use strict';
// "Re-subtitle this recording": send a recording's MP3 to the hosted server as an upload job (whole-file
// recognition + 混元翻译), then replace the live SRTs with the complete set. Fills the holes a connection
// drop leaves in the live subtitles and generally reads better. The live files are kept as
// <base>中文字幕.zh.live.srt / <base>粤语字幕.yue.live.srt (never overwritten once they exist) and a stale
// MP4 is kept as <base>录音＋字幕.live.mp4 so "Make MP4" can render a fresh one.
//
// A recording can be re-subtitled more than once, and in other languages than the first time (a file is in its own
// languages, not in whatever Live was set to). Nothing made before is overwritten: what is not the talk's own — and
// so has no `.live.` name to go to — moves into <base>旧版本/<n> <spoken>→<subtitles>/ with the MP4 made from it and
// a copy of the summary. When the file is on the server already (it was added from there, or re-subtitled before:
// the manifest's `job`), the server makes the subtitles again from its copy and nothing is uploaded.
//
// The server does the work whether or not the app is watching, so the app is as patient as the work is long: a status
// check or a download that fails (a VPN that blinks, 2026-09-21) is tried again rather than ending the whole thing —
// it used to, leaving the server with new subtitles the Mac never fetched. And when that has happened, asking again
// fetches them instead of making a third set.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const names = require('@subs/core/names');

/** The `.live.` backup beside a recording file: the subtitles the talk itself produced. */
const liveName = (file) => String(file).replace(/\.(srt|mp4)$/, '.live.$1');

/** Where a recording's earlier subtitles are kept. It starts with the recording's name, so renaming and deleting the recording take it along. */
const versionsDir = (dir, base) => path.join(dir, `${base}旧版本`);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
/** The earlier versions of a recording's subtitles, oldest first: [{n, folder, source, target, keptAt, files}]. */
function listVersions(dir, base) {
  const d = versionsDir(dir, base);
  let folders;
  try { folders = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+/.test(e.name)); } catch { return []; }
  return folders.map((e) => {
    const meta = readJson(path.join(d, e.name, 'version.json'));
    const files = fs.readdirSync(path.join(d, e.name)).filter((f) => f !== 'version.json' && !f.startsWith('.')).sort();
    return { n: Number(/^\d+/.exec(e.name)[0]), folder: e.name, source: meta.source || null, target: meta.target || null, keptAt: meta.keptAt || null, files };
  }).sort((a, b) => a.n - b.n);
}
/** Move `files` (and copy `copies`) into the recording's next version folder, named for the languages they are in. */
function keepVersion(dir, base, { files, copies = [], source, target }) {
  const n = (listVersions(dir, base).at(-1) || { n: 0 }).n + 1;
  const label = (l) => names.LANG_LABEL[l] || l;
  const to = path.join(versionsDir(dir, base), `${n} ${label(source)}→${label(target)}`);
  fs.mkdirSync(to, { recursive: true });
  for (const f of files) fs.renameSync(f, path.join(to, path.basename(f)));
  for (const f of copies) fs.copyFileSync(f, path.join(to, path.basename(f)));
  fs.writeFileSync(path.join(to, 'version.json'), JSON.stringify({ source, target, keptAt: Date.now() }));
  return to;
}

class ResubtitleQueue extends EventEmitter {
  /**
   * @param {object} o
   * @param {object} o.cloud   CloudLink: createJob, uploadJob, regenerateJob, getJob, downloadJobFile, status()
   * @param {number} [o.pollMs]
   */
  constructor({ cloud, log, pollMs = 2000, patienceMs = 5 * 60_000 } = {}) {
    super();
    this.cloud = cloud;
    this.log = log || (() => {});
    this.pollMs = pollMs;
    this.patienceMs = patienceMs; // how long the server may go unreachable before the app stops waiting for it
    this.queue = [];
    this.current = null;
    this.last = null;
  }

  status() {
    return {
      current: this.current ? { base: this.current.base, stage: this.current.stage, percent: Math.round(this.current.percent || 0), jobId: this.current.jobId || null, startedAt: this.current.startedAt } : null,
      queue: this.queue.map((q) => q.base),
      last: this.last,
    };
  }

  /** A request to the server, tried again while the server cannot be reached; what it refuses (4xx) is an answer, not an outage. */
  async _patiently(ask) {
    const since = Date.now();
    for (;;) {
      try { return await ask(); } catch (err) {
        if ((err.status >= 400 && err.status < 500) || /not logged in|URL is not set/.test(err.message) || Date.now() - since > this.patienceMs) throw err;
        this.log('warn', `re-subtitle: ${err.message} — the server goes on with it; asking again`);
        await new Promise((r) => setTimeout(r, Math.max(this.pollMs, 1)));
      }
    }
  }

  /** Queue a recording. jobId: the job that holds this recording's file on the server already, if one does. Returns false if it is already queued or running. */
  add({ base, dir, sourceLang, targetLang, jobId = null }) {
    if ((this.current && this.current.base === base) || this.queue.some((q) => q.base === base)) return false;
    this.queue.push({ base, dir, sourceLang, targetLang, jobId });
    this._next();
    return true;
  }

  _set(stage, percent) {
    if (!this.current) return;
    this.current.stage = stage;
    if (percent != null) this.current.percent = percent;
    this.emit('status', this.status());
  }

  _next() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    this.current = { ...item, stage: 'starting', percent: 0, startedAt: Date.now() };
    this.emit('status', this.status());
    this._run(item).then(
      (files) => { this.last = { base: item.base, ok: true, files, at: Date.now() }; this.log('info', `re-subtitled ${item.base}: ${files.join(', ')}`); this.current = null; this.emit('status', this.status()); this.emit('done', { base: item.base, files }); this._next(); },
      (err) => { this.last = { base: item.base, ok: false, error: err.message, at: Date.now() }; this.log('error', `re-subtitle ${item.base}: ${err.message}`); this.current = null; this.emit('status', this.status()); this.emit('error', { base: item.base, error: err.message }); this._next(); },
    );
  }

  async _run({ base, dir, sourceLang, targetLang, jobId }) {
    const mp3 = names.filePath(dir, base, 'mp3');
    if (!fs.existsSync(mp3)) throw new Error('recording file not found');
    let job = null;
    if (jobId) {
      // the file is on the server already: it makes the subtitles again from its copy, keeping its own version of the old ones
      try {
        const there = await this._patiently(() => this.cloud.getJob(jobId));
        const asked = there.source_lang === sourceLang && there.target_lang === targetLang;
        const was = names.languagesOf(dir, base);
        const behind = was.source !== sourceLang || was.target !== (targetLang !== 'none' ? targetLang : sourceLang);
        if (asked && behind && there.status !== 'failed') {
          // made already (or being made) in these languages, and never fetched — the app stopped watching last time
          job = there;
          this.log('info', `re-subtitle ${base}: the server ${there.status === 'done' ? 'already has' : 'is already making'} these subtitles (job ${jobId}); fetching them`);
        } else {
          job = await this.cloud.regenerateJob(jobId, { sourceLang, targetLang });
          this.log('info', `re-subtitle ${base}: the server has the file already (job ${jobId}), nothing is uploaded`);
        }
      } catch (err) {
        if (err.status !== 404 && !/no longer on the server/.test(err.message)) throw err; // gone from there: send it again
      }
    }
    if (!job) {
      const size = fs.statSync(mp3).size;
      job = await this.cloud.createJob({ filename: path.basename(mp3), size, sourceLang, targetLang });
      this.current.jobId = job.id;
      this.emit('job', { jobId: job.id, base }); // this job is this recording: the importer must not bring it down as a new one
      this._set('uploading', 0);
      await this.cloud.uploadJob(job.id, mp3, (sent) => this._set('uploading', (sent / size) * 100));
    }
    this.current.jobId = job.id;
    let j = job;
    for (;;) {
      if (j.status === 'done') break;
      await new Promise((r) => setTimeout(r, this.pollMs));
      j = await this._patiently(() => this.cloud.getJob(job.id));
      if (j.status === 'done') break;
      if (j.status === 'failed') throw new Error(j.error || 'the cloud job failed');
      this._set(j.status, Number(j.progress) || 0);
    }
    this._set('downloading', 100);
    const files = j.files || [];
    const wanted = [['source', files.find((f) => f.endsWith(`.${sourceLang}.srt`))]];
    if (targetLang && targetLang !== 'none') wanted.push(['target', files.find((f) => f.endsWith(`.${targetLang}.srt`))]);
    // everything comes down first, beside where it will go: a download that fails leaves the recording as it was
    const arrived = [];
    try {
      for (const [slot, remote] of wanted) {
        const lang = slot === 'source' ? sourceLang : targetLang;
        if (!remote) throw new Error(`the cloud job produced no .${lang}.srt`);
        const dest = names.srtPath(dir, base, lang);
        await this._patiently(() => this.cloud.downloadJobFile(job.id, remote, `${dest}.new`));
        arrived.push(dest);
      }
    } catch (err) { for (const d of arrived) fs.rmSync(`${d}.new`, { force: true }); throw err; }

    // what is there now makes way, and none of it is lost: the talk's own subtitles get their `.live.` name (once,
    // for ever); anything made since — by an earlier re-subtitle, or by the server for an added file — is a version
    const manifestFile = names.filePath(dir, base, 'manifest');
    const manifest = readJson(manifestFile);
    const was = names.languagesOf(dir, base);
    const fromTheTalk = !manifest.importedFrom && !manifest.job;
    const version = [];
    for (const cur of [...new Set([names.srtPath(dir, base, was.target), names.srtPath(dir, base, was.source)])]) {
      if (!fs.existsSync(cur)) continue;
      if (fromTheTalk && !fs.existsSync(liveName(cur))) { fs.renameSync(cur, liveName(cur)); continue; }
      version.push(cur);
      const plain = cur.replace(/\.srt$/i, '.plain.txt');
      if (fs.existsSync(plain)) version.push(plain);
    }
    const mp4 = names.filePath(dir, base, 'mp4');
    if (fs.existsSync(mp4)) {
      if (fromTheTalk && !fs.existsSync(liveName(mp4))) fs.renameSync(mp4, liveName(mp4)); else version.push(mp4);
    }
    if (version.length) {
      const summaries = ['summary', 'pdf'].map((k) => names.filePath(dir, base, k)).filter((f) => fs.existsSync(f)); // written from those subtitles; a copy, because it is still the one the recording shows
      const to = keepVersion(dir, base, { files: version, copies: summaries, source: was.source, target: was.target });
      this.log('info', `re-subtitle ${base}: the ${was.source} → ${was.target} subtitles are kept in ${path.basename(path.dirname(to))}/${path.basename(to)}`);
    }
    for (const dest of arrived) fs.renameSync(`${dest}.new`, dest);
    // which languages the recording holds now, and which job has its file — so the next time nothing is uploaded
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, base, source: sourceLang, target: targetLang && targetLang !== 'none' ? targetLang : sourceLang, job: job.id }, null, 2));
    return arrived.map((d) => path.basename(d));
  }
}

module.exports = { ResubtitleQueue, liveName, versionsDir, listVersions };
