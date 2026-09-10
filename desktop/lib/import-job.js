'use strict';
// Files added with "+ Add file…" are subtitled in the cloud, so their audio and subtitles live on the server
// and the app had nothing local to Open, Download or act on. This brings a finished job down into the
// recordings folder under the ordinary naming, after which it is an ordinary recording like any other.
const fs = require('node:fs');
const path = require('node:path');
const names = require('@subs/core/names');

/** "測試 講座錄音.mp3" → "測試 講座" — the mp3 suffix is added back by names.fileName. */
function baseFromFilename(filename, createdAt) {
  const stem = String(filename || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[/\\:]+/g, ' ').trim();
  // a stem already ending in 录音 would otherwise become "…录音录音.mp3"
  const clean = stem.replace(/录音$/, '').trim().slice(0, 80);
  return clean || names.baseFromDate(new Date(createdAt || Date.now()));
}

class JobImporter {
  /**
   * @param {object} o.cloud     CloudLink: downloadJobFile, status()
   * @param {function} o.dir     () => the recordings directory (read each time; the user can move it)
   * @param {function} o.getMap  () => { [jobId]: base } already imported
   * @param {function} o.setMap  (map) => persist it
   */
  constructor({ cloud, dir, getMap, setMap, log = () => {} }) {
    Object.assign(this, { cloud, dir, getMap, setMap, log });
    this.busy = new Set();
  }

  /**
   * Tag each job with the recording it became, and start importing any that finished and have not been
   * brought down yet. Never throws and never blocks the caller: the next poll picks up the result.
   */
  annotate(jobs) {
    const map = this.getMap() || {};
    const list = Array.isArray(jobs) ? jobs : [];
    for (const j of list) {
      if (map[j.id]) { j.importedBase = map[j.id]; continue; }
      if (j.status === 'done' && !this.busy.has(j.id)) {
        this.busy.add(j.id);
        this._import(j).catch((err) => this.log('error', `import ${j.id}: ${err.message}`)).finally(() => this.busy.delete(j.id));
      }
    }
    return list;
  }

  async _import(job) {
    const dir = this.dir();
    fs.mkdirSync(dir, { recursive: true });
    const base = names.uniqueBase(dir, baseFromFilename(job.filename, job.created_at));
    const files = job.files || [];
    const pick = (suffix) => files.find((f) => f.endsWith(suffix));

    // the mp3 anchors the recording — the Files list only shows a set that has one
    const mp3 = names.fileName(base, 'mp3', 'cn');
    await this.cloud.downloadJobFile(job.id, 'audio.mp3', path.join(dir, mp3));
    const written = [mp3];

    // same mapping the cloud re-subtitle uses: the spoken language is "yue", the translation is "zh"
    const wanted = [['yue', pick(`.${job.source_lang}.srt`)]];
    if (job.target_lang && job.target_lang !== 'none') wanted.push(['zh', pick(`.${job.target_lang}.srt`)]);
    const mp4 = files.find((f) => f.endsWith('.mp4'));
    if (mp4) wanted.push(['mp4', mp4]);

    for (const [kind, remote] of wanted) {
      if (!remote) continue; // a job without a translation, or with no render, is still worth importing
      const dest = path.join(dir, names.fileName(base, kind, 'cn'));
      try {
        await this.cloud.downloadJobFile(job.id, remote, dest);
        written.push(path.basename(dest));
      } catch (err) {
        this.log('warn', `import ${job.id}: ${remote} — ${err.message}`);
      }
    }

    const map = this.getMap() || {};
    map[job.id] = base;
    this.setMap(map);
    this.log('info', `added file "${job.filename}" is now the recording ${base} (${written.length} files)`);
    return { base, written };
  }
}

module.exports = { JobImporter, baseFromFilename };
