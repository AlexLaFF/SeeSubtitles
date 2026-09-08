'use strict';
// "Re-subtitle this recording": send a recording's MP3 to the hosted server as an upload job (whole-file
// recognition + 混元翻译), then replace the live SRTs with the complete set. Fills the holes a connection
// drop leaves in the live subtitles and generally reads better. The live files are kept as
// <base>中文字幕.zh.live.srt / <base>粤语字幕.yue.live.srt (never overwritten once they exist) and a stale
// MP4 is kept as <base>录音＋字幕.live.mp4 so "Make MP4" can render a fresh one.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const names = require('@subs/core/names');

const liveName = (dir, base, kind) => names.filePath(dir, base, kind).replace(/\.(srt|mp4)$/, '.live.$1');

class ResubtitleQueue extends EventEmitter {
  /**
   * @param {object} o
   * @param {object} o.cloud   CloudLink: createJob, uploadJob, getJob, downloadJobFile, status()
   * @param {number} [o.pollMs]
   */
  constructor({ cloud, log, pollMs = 2000 } = {}) {
    super();
    this.cloud = cloud;
    this.log = log || (() => {});
    this.pollMs = pollMs;
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

  /** Queue a recording. Returns false if it is already queued or running. */
  add({ base, dir, sourceLang, targetLang }) {
    if ((this.current && this.current.base === base) || this.queue.some((q) => q.base === base)) return false;
    this.queue.push({ base, dir, sourceLang, targetLang });
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

  async _run({ base, dir, sourceLang, targetLang }) {
    const mp3 = names.filePath(dir, base, 'mp3');
    if (!fs.existsSync(mp3)) throw new Error('recording file not found');
    const size = fs.statSync(mp3).size;
    const job = await this.cloud.createJob({ filename: path.basename(mp3), size, sourceLang, targetLang });
    this.current.jobId = job.id;
    this._set('uploading', 0);
    await this.cloud.uploadJob(job.id, mp3, (sent) => this._set('uploading', (sent / size) * 100));
    let j = job;
    for (;;) {
      await new Promise((r) => setTimeout(r, this.pollMs));
      j = await this.cloud.getJob(job.id);
      if (j.status === 'done') break;
      if (j.status === 'failed') throw new Error(j.error || 'the cloud job failed');
      this._set(j.status, Number(j.progress) || 0);
    }
    this._set('downloading', 100);
    const files = j.files || [];
    const wanted = [['yue', files.find((f) => f.endsWith(`.${sourceLang}.srt`))]];
    if (targetLang && targetLang !== 'none') wanted.push(['zh', files.find((f) => f.endsWith(`.${targetLang}.srt`))]);
    const written = [];
    for (const [kind, remote] of wanted) {
      if (!remote) throw new Error(`the cloud job produced no .${kind === 'yue' ? sourceLang : targetLang}.srt`);
      const dest = names.filePath(dir, base, kind);
      const backup = liveName(dir, base, kind);
      if (fs.existsSync(dest) && !fs.existsSync(backup)) fs.renameSync(dest, backup);
      await this.cloud.downloadJobFile(job.id, remote, dest);
      written.push(path.basename(dest));
    }
    const mp4 = names.filePath(dir, base, 'mp4');
    if (fs.existsSync(mp4)) {
      const backup = liveName(dir, base, 'mp4');
      if (fs.existsSync(backup)) fs.rmSync(backup);
      fs.renameSync(mp4, backup);
    }
    return written;
  }
}

module.exports = { ResubtitleQueue, liveName };
