'use strict';
// MP4 export queue: audio + burned-in subtitle frames (rendered by helpers/render-subs.swift) plus
// No embedded subtitle tracks: players would switch them on and duplicate the burned-in text.
// One job at a time, runs in the background.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { buildHelper } = require('./helpers');
const names = require('@subs/core/names');

/**
 * A recording's length in seconds, read by ffmpeg — which prints the container's duration when it opens a file and
 * then stops, having been given nothing to write. The app used to ask ffprobe, but the only ffprobe npm offers for
 * macOS is an Intel build, even in its arm64 folder: on a Mac without Rosetta it cannot start at all (error -86).
 */
function probeDuration(file, ffmpeg = 'ffmpeg') {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-hide_banner', '-i', file], (err, _out, errOut) => {
      const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(errOut));
      const d = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
      if (!Number.isFinite(d) || d <= 0) return reject(new Error(`duration of ${path.basename(file)}: ${err && !m ? err.message.split('\n')[0] : 'not found'}`));
      resolve(d);
    });
  });
}

class Mp4Queue extends EventEmitter {
  /**
   * `quality` is h264_videotoolbox's constant-quality setting (1–100, higher is better and larger). The frames are
   * near-static subtitle cards, so constant quality keeps an hour small where a fixed bitrate would not; 55 was
   * picked by measuring e2e/mac.js's output on a real talk.
   */
  constructor({ dir, size = '1080x1920', fontSize = 64, show = 'target', fps = 15, quality = 55, lines = 60, ffmpeg = 'ffmpeg' } = {}) {
    super();
    this.dir = dir;
    const m = /^(\d+)x(\d+)$/.exec(size) || [null, 1080, 1920];
    this.width = Number(m[1]);
    this.height = Number(m[2]);
    this.fontSize = fontSize;
    this.show = show === 'both' ? 'both' : 'target';
    this.fps = fps;
    this.quality = Math.max(1, Math.min(100, Number(quality) || 55));
    this.lines = lines;
    this.ffmpeg = ffmpeg;
    this.queue = [];
    this.current = null;
    this.done = [];
  }

  add(base) {
    if (!base || this.queue.includes(base) || (this.current && this.current.base === base)) return false;
    this.queue.push(base);
    this.emit('status');
    this._next();
    return true;
  }

  status() {
    return { current: this.current, queue: [...this.queue], done: this.done.slice(-5) };
  }

  async _next() {
    if (this.current || !this.queue.length) return;
    const base = this.queue.shift();
    this.current = { base, stage: 'preparing', percent: 0, startedAt: Date.now() };
    this.emit('status');
    try {
      const r = await this._run(base);
      this.done.push({ base, ok: true, ...r, at: Date.now() });
      this.emit('done', r);
    } catch (err) {
      this.done.push({ base, ok: false, error: err.message, at: Date.now() });
      this.emit('error', { base, error: err.message });
    }
    this.current = null;
    this.emit('status');
    this._next();
  }

  _set(stage, percent) {
    if (!this.current) return;
    this.current.stage = stage;
    this.current.percent = Math.max(0, Math.min(100, Math.round(percent)));
    this.emit('status');
  }

  async _run(base) {
    const t0 = Date.now();
    const mp3 = names.filePath(this.dir, base, 'mp3');
    if (!fs.existsSync(mp3)) throw new Error(`${path.basename(mp3)} not found`);
    const { source, target } = names.languagesOf(this.dir, base);
    const targetSrt = names.srtPath(this.dir, base, target);
    const sourceSrt = source === target ? null : names.srtPath(this.dir, base, source);
    const hasTarget = fs.existsSync(targetSrt);
    const hasSource = !!sourceSrt && fs.existsSync(sourceSrt);
    if (!hasTarget && !hasSource) throw new Error(`${base} has no subtitle files`);
    const duration = await probeDuration(mp3, this.ffmpeg);
    const helper = await buildHelper('render-subs', (t) => this.emit('log', t));
    if (!helper) throw new Error('subtitle renderer unavailable (needs Xcode command line tools)');

    const tmp = path.join(this.dir, `.mp4-${base}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    try {
      this._set('rendering subtitle frames', 0);
      const args = ['--out', tmp, '--width', String(this.width), '--height', String(this.height), '--font-size', String(this.fontSize),
        '--duration', duration.toFixed(3), '--show', this.show, '--lines', String(this.lines)];
      if (hasTarget) args.push('--target', targetSrt);
      if (hasSource) args.push('--source', sourceSrt);
      const summary = await new Promise((resolve, reject) => {
        execFile(helper, args, { timeout: 30 * 60_000, maxBuffer: 1e7 }, (err, out, stderr) => {
          if (err) return reject(new Error(`render-subs: ${String(stderr || err.message).trim().slice(0, 200)}`));
          try { resolve(JSON.parse(out)); } catch { resolve({}); }
        });
      });
      this.emit('log', `${base}: ${summary.frames || '?'} subtitle frames for ${summary.cues || '?'} cues`);

      this._set('encoding video', 0);
      const out = names.filePath(this.dir, base, 'mp4');
      const part = `${out}.part`;
      const ff = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
        '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'concat.txt'), '-i', mp3];
      ff.push('-map', '0:v', '-map', '1:a', '-sn', '-t', duration.toFixed(3), '-vf', `fps=${this.fps},format=yuv420p`);
      // The Mac's own H.264 encoder: every Apple-silicon Mac has it, and it keeps the shipped ffmpeg free of x264
      // (GPL) — see scripts/build-ffmpeg.sh. A keyframe every ten seconds so seeking stays quick.
      ff.push('-c:v', 'h264_videotoolbox', '-q:v', String(this.quality), '-g', String(this.fps * 10));
      ff.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', part);
      await new Promise((resolve, reject) => {
        const p = spawn(this.ffmpeg, ff, { stdio: ['ignore', 'pipe', 'pipe'] });
        let errText = '';
        p.stdout.on('data', (d) => {
          const m = /out_time_us=(\d+)/g;
          let last = null;
          let r;
          while ((r = m.exec(d.toString()))) last = Number(r[1]);
          if (last != null) this._set('encoding video', (last / 1e6 / duration) * 100);
        });
        p.stderr.on('data', (d) => { errText += d; });
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${errText.trim().slice(-300)}`))));
      });
      fs.renameSync(part, out);
      return { base, file: path.basename(out), bytes: fs.statSync(out).size, seconds: Math.round((Date.now() - t0) / 1000) };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(`${names.filePath(this.dir, base, 'mp4')}.part`, { force: true });
    }
  }
}

module.exports = { Mp4Queue, probeDuration };
