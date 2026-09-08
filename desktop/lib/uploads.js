'use strict';
// "Add file…": send any video/audio file to the hosted server as a subtitling job. The outputs live there
// (the Files view opens the job on the web); this queue only tracks the upload.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class UploadQueue extends EventEmitter {
  constructor({ cloud, log } = {}) {
    super();
    this.cloud = cloud;
    this.log = log || (() => {});
    this.queue = [];
    this.current = null;
    this.last = null;
  }
  status() {
    return {
      current: this.current ? { name: this.current.name, percent: Math.round(this.current.percent || 0), jobId: this.current.jobId || null, startedAt: this.current.startedAt } : null,
      queue: this.queue.map((q) => q.name),
      last: this.last,
    };
  }
  add({ file, sourceLang, targetLang }) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('file not found');
    const name = path.basename(file);
    if ((this.current && this.current.file === file) || this.queue.some((q) => q.file === file)) return false;
    this.queue.push({ file, name, sourceLang, targetLang });
    this._next();
    return true;
  }
  _next() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    this.current = { ...item, percent: 0, startedAt: Date.now() };
    this.emit('status', this.status());
    this._run(item).then(
      (job) => { this.last = { name: item.name, ok: true, jobId: job.id, at: Date.now() }; this.log('info', `uploaded ${item.name} as cloud job ${job.id}`); this.current = null; this.emit('status', this.status()); this.emit('done', job); this._next(); },
      (err) => { this.last = { name: item.name, ok: false, error: err.message, at: Date.now() }; this.log('error', `upload ${item.name}: ${err.message}`); this.current = null; this.emit('status', this.status()); this._next(); },
    );
  }
  async _run({ file, name, sourceLang, targetLang }) {
    const size = fs.statSync(file).size;
    const job = await this.cloud.createJob({ filename: name, size, sourceLang, targetLang });
    this.current.jobId = job.id;
    await this.cloud.uploadJob(job.id, file, (sent) => { this.current.percent = (sent / size) * 100; this.emit('status', this.status()); });
    return job;
  }
}

module.exports = { UploadQueue };
