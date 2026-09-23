'use strict';
// "Add file…": send a video or audio file to the hosted server as a subtitling job — the whole file, or for a video
// only its sound (the subtitles are the same; the picture matters only to an MP4 made over it on the web). The
// outputs live on the server until the finished job is imported (import-job.js); this queue is the sending.
//
// A file that loses its connection is carried on from what the server has, not begun again: every attempt asks the
// job how much arrived (`received`) and sends the rest, for as long as the app is open. The uploads under way are
// written down (getPending / setPending), so one the app was closed in the middle of carries on when it next opens.
//
// A connection that dies seldom says so. Wi‑Fi off for ten seconds (the more so under a VPN) raises no error: the
// socket goes quiet and TCP tries again when its backed-off timer says, which was a frozen row for a minute
// (2026-09-21). So silence is watched: after QUIET_MS of nothing going out the row says it is waiting for the
// connection, and after STALL_MS the connection is dropped and a new one carries on.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const RETRY_MS = [2000, 3000, 5000, 10_000, 15_000]; // between attempts that got nowhere; one that got further starts over at the first. An attempt costs one small request, so the last wait is short: it is how long a network that is back goes unnoticed
const QUIET_MS = 6000;   // nothing taken by the connection for this long: say so
const STALL_MS = 20_000; // and for this long: it is dead, or as good as — a new one carries on from what arrived
const TAIL_MS = 150_000; // once the whole file has been handed over, what is left is in buffers and the server's answer: that wait is the server's to end (its own limit is 120 s)

/** Errors no second attempt will cure: the job is gone, the account is, the file is not what was being sent. */
const hopeless = (err) => !!err.hopeless || [400, 401, 403, 404, 413].includes(err.status) || /not logged in|URL is not set/.test(err.message);
/** Of those, the ones that leave the upload worth keeping for the next time the app opens logged in. */
const loggedOut = (err) => err.status === 401 || /not logged in|URL is not set/.test(err.message);

class UploadQueue extends EventEmitter {
  /**
   * @param {object} o.cloud         CloudLink: createJob, getJob, uploadJob
   * @param {string} [o.ffmpeg]      takes the sound out of a video sent as audio only
   * @param {string} [o.tmpDir]      where that sound is kept until it has arrived
   * @param {function} [o.getPending] () => { [jobId]: {file, source, name, size, mtimeMs, temp} } — uploads under way
   * @param {function} [o.setPending] (map) => persist it
   * @param {number[]} [o.retryMs]   waits between attempts (tests)
   * @param {number} [o.quietMs]     silence before the row says it is waiting; [o.stallMs] before a new connection carries on (tests)
   */
  constructor({ cloud, log, ffmpeg = 'ffmpeg', tmpDir = path.join(os.tmpdir(), 'see-subtitles-uploads'), getPending = null, setPending = null, retryMs = RETRY_MS, quietMs = QUIET_MS, stallMs = STALL_MS } = {}) {
    super();
    this.cloud = cloud;
    this.log = log || (() => {});
    this.ffmpeg = ffmpeg;
    this.tmpDir = tmpDir;
    let memory = {};
    this.getPending = getPending || (() => memory);
    this.setPending = setPending || ((map) => { memory = map; });
    this.retryMs = retryMs;
    this.quietMs = quietMs;
    this.stallMs = stallMs;
    this.queue = [];
    this.current = null;
    this.last = null;
    this.failed = null; // the item behind `last`, when it failed before it had a job: what "Try again" adds again
  }
  status() {
    const c = this.current;
    return {
      // stage: extracting (the sound, from a video sent as audio only) → uploading; retrying: between two attempts
      current: c ? { name: c.name, percent: Math.round(c.percent || 0), jobId: c.jobId || null, startedAt: c.startedAt, stage: c.stage, retrying: !!c.retrying } : null,
      // waiting their turn: by name those with no job yet, by job those being carried on (the server lists them already)
      queue: this.queue.filter((q) => !q.jobId).map((q) => q.name),
      queuedJobs: this.queue.map((q) => q.jobId).filter(Boolean),
      last: this.last,
    };
  }
  add({ file, sourceLang, targetLang, audioOnly = false }) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('file not found');
    if ((this.current && this.current.source === file) || this.queue.some((q) => q.source === file)) return false;
    // the sound of talk.mp4 is talk.m4a, and the job is named for what it holds
    const name = audioOnly ? `${path.basename(file, path.extname(file))}.m4a` : path.basename(file);
    this.queue.push({ source: file, file: audioOnly ? null : file, name, sourceLang, targetLang, audioOnly });
    this._next();
    return true;
  }
  /** Carry on the uploads the app was closed (or logged out) in the middle of. Safe to call again. */
  resumePending() {
    let n = 0;
    for (const [jobId, p] of Object.entries(this.getPending() || {})) {
      if ((this.current && this.current.jobId === jobId) || this.queue.some((q) => q.jobId === jobId)) continue;
      if (!p || !p.file || !fs.existsSync(p.file)) { this._forget(jobId); continue; }
      this.queue.push({ ...p, jobId });
      n++;
    }
    if (n) { this.log('info', `carrying on ${n} upload(s) from last time`); this._next(); }
    return n;
  }
  /** "Try again" on an upload that failed before it had a job (the sound could not be taken out, the server was not there). */
  retryLast() {
    const item = this.failed;
    if (!item || !this.last || this.last.ok) return false;
    this.failed = null; this.last = null;
    return this.add({ file: item.source, sourceLang: item.sourceLang, targetLang: item.targetLang, audioOnly: item.audioOnly });
  }
  /**
   * "Try again" on an upload the server has part of. One this app has written down carries on as it would when the
   * app next opened. One it has not (it was begun by an older build, or let go) carries on too, given the file —
   * which has to be the one that was being sent: the server said how big that was.
   */
  async resume(jobId, file = null) {
    if ((this.current && this.current.jobId === jobId) || this.queue.some((q) => q.jobId === jobId)) return true;
    const known = (this.getPending() || {})[jobId];
    if (known && fs.existsSync(known.file)) { this.resumePending(); return true; }
    if (!file) throw Object.assign(new Error('this app no longer knows where that file is'), { code: 'need_file' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('file not found');
    const job = await this.cloud.getJob(jobId);
    if (job.status !== 'uploading') throw new Error(job.status === 'failed' ? (job.error || 'the upload failed on the server') : 'the file has arrived already');
    const st = fs.statSync(file);
    if (job.size && st.size !== job.size) throw Object.assign(new Error(`that is not the file that was being sent: it is ${st.size} bytes, not ${job.size}`), { code: 'not_the_file' });
    this._remember(jobId, { file, source: file, name: job.filename, size: st.size, mtimeMs: st.mtimeMs, temp: false, audioOnly: false });
    if (this.last && this.last.jobId === jobId) this.last = null;
    this.resumePending();
    return true;
  }
  /** Give up the upload of this job — being sent or waiting its turn — because its row was deleted. */
  cancel(jobId) {
    if (!jobId) return false;
    if (this.current && this.current.jobId === jobId) { this.current.abort.abort(); return true; }
    const i = this.queue.findIndex((q) => q.jobId === jobId);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    this._forget(jobId);
    this.emit('status', this.status());
    return true;
  }
  _remember(jobId, entry) { this.setPending({ ...(this.getPending() || {}), [jobId]: entry }); }
  _forget(jobId) {
    const map = { ...(this.getPending() || {}) };
    const p = map[jobId];
    if (!p) return;
    if (p.temp) fs.rmSync(p.file, { force: true });
    delete map[jobId];
    this.setPending(map);
  }
  _next() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    const cur = { ...item, percent: 0, startedAt: Date.now(), stage: item.audioOnly && !item.jobId ? 'extracting' : 'uploading', abort: new AbortController() };
    this.current = cur;
    this.emit('status', this.status());
    const after = () => { this.current = null; this.emit('status', this.status()); this._next(); };
    this._run(cur).then(
      (job) => { this._forget(job.id); this.last = { name: item.name, ok: true, jobId: job.id, at: Date.now() }; this.log('info', `uploaded ${item.name} as cloud job ${job.id}`); after(); this.emit('done', job); },
      (err) => {
        const cancelled = cur.abort.signal.aborted;
        // logged out, the file waits for the next login; anything else hopeless, and a deleted row, let it go
        if (cur.jobId && !(loggedOut(err) && !cancelled)) this._forget(cur.jobId);
        else if (!cur.jobId && cur.temp) fs.rmSync(cur.temp, { force: true });
        if (!cancelled) { this.last = { name: item.name, ok: false, error: err.message, jobId: cur.jobId || null, at: Date.now() }; this.failed = cur.jobId ? null : item; this.log('error', `upload ${item.name}: ${err.message}`); }
        after();
      },
    );
  }
  async _run(cur) {
    const { signal } = cur.abort;
    if (cur.audioOnly && !cur.jobId) {
      cur.file = cur.temp = await this._extractAudio(cur.source, signal);
      cur.stage = 'uploading';
      this.emit('status', this.status());
    }
    const file = cur.file;
    const made = fs.statSync(file);
    const size = cur.size || made.size;
    const mtimeMs = cur.mtimeMs || made.mtimeMs;
    if (!cur.jobId) {
      const job = await this.cloud.createJob({ filename: cur.name, size, sourceLang: cur.sourceLang, targetLang: cur.targetLang });
      cur.jobId = job.id;
      this._remember(job.id, { file, source: cur.source, name: cur.name, size, mtimeMs, temp: !!cur.temp, audioOnly: !!cur.audioOnly });
    }
    const id = cur.jobId;
    let failures = 0;
    let reached = -1;
    for (;;) {
      try {
        const now = fs.statSync(file); // throws when the file has gone: nothing to carry on with
        if (now.size !== size || now.mtimeMs !== mtimeMs) throw Object.assign(new Error('the file changed while it was being sent'), { hopeless: true });
        const job = await this.cloud.getJob(id);
        if (job.status === 'failed') throw Object.assign(new Error(job.error || 'the upload failed on the server'), { hopeless: true });
        if (job.status !== 'uploading') return job; // it is all there: only the answer to the last piece was lost
        const offset = job.received || 0;
        if (offset > reached) { if (reached >= 0) failures = 0; reached = offset; }
        if (offset) this.log('info', `upload ${cur.name}: carrying on from ${(offset / 1e6).toFixed(1)} of ${(size / 1e6).toFixed(1)} MB`);
        cur.retrying = false;
        cur.percent = (offset / size) * 100;
        this.emit('status', this.status());
        return await this._send(cur, id, file, size, offset);
      } catch (err) {
        if (signal.aborted) throw new Error('upload cancelled');
        if (err.code === 'ENOENT') throw Object.assign(new Error('the file is no longer where it was'), { hopeless: true });
        if (hopeless(err)) throw err;
        // the server had more than it said a moment ago (the old connection was still draining): ask again at once
        const wait = err.code === 'upload_offset' ? 0 : this.retryMs[Math.min(failures++, this.retryMs.length - 1)];
        this.log('warn', `upload ${cur.name}: ${err.message} — trying again${wait ? ` in ${Math.round(wait / 1000)} s` : ''}`);
        cur.retrying = true;
        this.emit('status', this.status());
        await new Promise((resolve) => { const t = setTimeout(done, wait); function done() { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); } signal.addEventListener('abort', done); });
      }
    }
  }
  /** One connection's worth of the file, from `offset`. Watched for silence: a connection that takes nothing is said to be waiting, then dropped. */
  async _send(cur, id, file, size, offset) {
    const { signal } = cur.abort;
    const attempt = new AbortController();
    const cancelled = () => attempt.abort();
    signal.addEventListener('abort', cancelled);
    let quiet; let stall; let stalled = false; let active = true; let shown = Math.round(cur.percent);
    const tell = () => { if (this.current === cur) this.emit('status', this.status()); };
    const watch = (limit) => {
      clearTimeout(quiet); clearTimeout(stall);
      quiet = setTimeout(() => { cur.retrying = true; tell(); }, this.quietMs);
      stall = setTimeout(() => { stalled = true; attempt.abort(); }, limit);
    };
    watch(this.stallMs);
    try {
      return await this.cloud.uploadJob(id, file, (sent) => {
        if (!active) return; // buffered progress from a settled attempt must not restart its watchdogs
        watch(offset + sent >= size ? TAIL_MS : this.stallMs);
        cur.percent = ((offset + sent) / size) * 100;
        const pct = Math.round(cur.percent);
        if (pct !== shown || cur.retrying) { shown = pct; cur.retrying = false; tell(); } // the file is read in small pieces: the windows hear of a new percent, not of every piece
      }, attempt.signal, offset);
    } catch (err) {
      if (stalled && !signal.aborted) throw new Error(`the connection took nothing for ${Math.round(this.stallMs / 1000)} s`);
      throw err;
    } finally {
      active = false;
      clearTimeout(quiet); clearTimeout(stall);
      signal.removeEventListener('abort', cancelled);
    }
  }
  /** The sound of a video as an .m4a in tmpDir: as it is in the file where m4a can hold it, so the subtitles are those the whole video would get. */
  async _extractAudio(source, signal) {
    fs.mkdirSync(this.tmpDir, { recursive: true });
    const out = path.join(this.tmpDir, `${crypto.randomBytes(6).toString('hex')}.m4a`);
    const from = ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source, '-map', '0:a:0', '-vn', '-sn', '-dn'];
    try {
      try { await this._ffmpeg([...from, '-c:a', 'copy', out], signal); } catch (err) {
        if (signal.aborted) throw err;
        await this._ffmpeg([...from, '-c:a', 'aac', '-b:a', '160k', out], signal); // a codec m4a cannot hold is encoded once, generously
      }
    } catch (err) {
      fs.rmSync(out, { force: true });
      throw new Error(signal.aborted ? 'upload cancelled' : `could not take the sound out of ${path.basename(source)}: ${err.message}`);
    }
    return out;
  }
  _ffmpeg(args, signal) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err = (err + d).slice(-400); });
      const kill = () => p.kill('SIGKILL');
      signal.addEventListener('abort', kill);
      p.on('error', (e) => { signal.removeEventListener('abort', kill); reject(e); });
      p.on('close', (code) => { signal.removeEventListener('abort', kill); if (code === 0) resolve(); else reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited with ${code}`)); });
    });
  }
}

module.exports = { UploadQueue };
