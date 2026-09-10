'use strict';
// Local MP3 recording of the microphone plus SRT subtitles from the live transcript.
//
// Reliability model:
//  - Node owns the output file (append mode). ffmpeg only encodes pipe → pipe, so if the encoder dies
//    it is restarted and the same file continues.
//  - The MP3 is written without a Xing header or ID3 tag, so a file cut short by a crash or power
//    loss is still playable up to the last written frame.
//  - Gaps in captured audio (device restart, USB hiccup) are padded with silence, keeping the audio
//    aligned with wall-clock time and therefore with the subtitle timestamps.
//  - Nothing here touches the network; recording continues when the connection to Tencent is lost.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const names = require('./names');
const { fromTexts } = require('./plain-text');

const GAP_PAD_MS = 1500; // pad silence when the audio falls this far behind the wall clock
const LAG_SETTLE_MS = 2000; // measure the pipeline's normal lag after this long

const pad = (n, w) => String(n).padStart(w, '0');

function srtTime(ms) {
  ms = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}_${pad(d.getHours(), 2)}-${pad(d.getMinutes(), 2)}-${pad(d.getSeconds(), 2)}`;
}

class Recorder extends EventEmitter {
  constructor({ dir, ffmpeg = 'ffmpeg', bitrate = '128k' } = {}) {
    super();
    this.dir = dir;
    this.ffmpeg = ffmpeg;
    this.bitrate = bitrate;
    this.rec = null;
    this.last = null; // info about the most recently finished recording
  }

  get recording() { return !!this.rec; }

  /** Begin a new recording. `rate`/`channels` describe the PCM fed to writeAudio(). */
  start({ rate = 48000, channels = 1, name, source = 'yue', target = 'zh' } = {}) {
    if (this.rec) return this.rec.base;
    fs.mkdirSync(this.dir, { recursive: true });
    const base = name || names.uniqueBase(this.dir, names.baseFromDate());
    const rec = {
      base, rate, channels,
      startedAt: Date.now(),
      mp3: path.join(this.dir, names.fileName(base, 'mp3')),
      // `zh` and `yue` are the two slots a recording has — the translation and the original — not a claim
      // about the languages in them. What was actually spoken and subtitled is in the manifest.
      source, target,
      srt: { target: path.join(this.dir, names.srtName(base, target)), source: path.join(this.dir, names.srtName(base, source)) },
      cues: { target: 0, source: 0 },
      seen: new Set(),
      writtenSamples: 0,
      paddedMs: 0,
      bytes: 0,
      encoderRestarts: 0,
      baseLag: null,
      error: null,
      enc: null,
      stopping: null,
      out: null,
    };
    try {
      fs.writeFileSync(path.join(this.dir, names.fileName(base, 'manifest')),
        JSON.stringify({ base, source, target, startedAt: rec.startedAt, rate, channels }, null, 2));
    } catch (err) {
      this.emit('log', `manifest: ${err.message}`); // the recording matters more than knowing its languages
    }
    rec.out = fs.createWriteStream(rec.mp3, { flags: 'a' });
    rec.out.on('error', (err) => { rec.error = err.message; this.emit('log', `file: ${err.message}`); });
    this.rec = rec;
    this._spawnEncoder();
    this.emit('start', this.status());
    return base;
  }

  _spawnEncoder() {
    const rec = this.rec;
    if (!rec) return;
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 's16le', '-ar', String(rec.rate), '-ac', String(rec.channels), '-i', 'pipe:0',
      '-codec:a', 'libmp3lame', '-b:a', this.bitrate, '-write_xing', '0', '-id3v2_version', '0',
      '-f', 'mp3', 'pipe:1',
    ];
    const enc = spawn(this.ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    rec.enc = enc;
    enc.stdout.on('data', (d) => { rec.bytes += d.length; rec.out.write(d); });
    enc.stderr.on('data', (d) => {
      rec.error = d.toString().trim().split('\n').pop().slice(0, 200);
      this.emit('log', `encoder: ${rec.error}`);
    });
    enc.stdin.on('error', () => { /* EPIPE while the encoder is dying; the close handler restarts it */ });
    enc.on('error', (err) => {
      rec.error = err.code === 'ENOENT' ? 'ffmpeg not found' : err.message;
      this.emit('log', `encoder: ${rec.error}`);
    });
    enc.on('close', (code, signal) => {
      if (rec.enc !== enc) return;
      rec.enc = null;
      if (rec.stopping) return rec.stopping();
      rec.encoderRestarts++;
      this.emit('log', `encoder exited (${signal || `code ${code}`}); restarting`);
      setTimeout(() => { if (this.rec === rec && !rec.enc && !rec.stopping) this._spawnEncoder(); }, 500);
    });
  }

  /** Feed PCM (s16le, recorder rate/channels). Pads silence if the audio falls behind the clock. */
  writeAudio(pcm) {
    const rec = this.rec;
    if (!rec || !rec.enc || !pcm.length) return;
    const n = pcm.length / 2 / rec.channels;
    const elapsedSamples = ((Date.now() - rec.startedAt) / 1000) * rec.rate;
    const lag = elapsedSamples - (rec.writtenSamples + n); // > 0 when audio is behind the wall clock
    if (rec.baseLag === null) {
      if (Date.now() - rec.startedAt > LAG_SETTLE_MS) rec.baseLag = Math.max(0, lag);
    } else if (lag < rec.baseLag) {
      rec.baseLag = Math.max(0, lag); // the pipeline is faster than first measured
    } else if (lag - rec.baseLag > (GAP_PAD_MS / 1000) * rec.rate) {
      const padSamples = Math.round(lag - rec.baseLag);
      rec.enc.stdin.write(Buffer.alloc(padSamples * 2 * rec.channels));
      rec.writtenSamples += padSamples;
      rec.paddedMs += (padSamples / rec.rate) * 1000;
      this.emit('log', `padded ${(padSamples / rec.rate).toFixed(1)} s of silence to cover an audio gap`);
    }
    rec.enc.stdin.write(pcm);
    rec.writtenSamples += n;
  }

  /** Append a finished transcript line (needs absolute wallStart/wallEnd in ms) to the SRT files. */
  addSentence(line) {
    const rec = this.rec;
    if (!rec || !line || !line.ended || line.wallStart == null || rec.seen.has(line.id)) return;
    const start = line.wallStart - rec.startedAt;
    const end = (line.wallEnd != null ? line.wallEnd : line.wallStart + 2000) - rec.startedAt;
    if (end <= 0) return;
    rec.seen.add(line.id);
    const cue = (n, text) => `${n}\n${srtTime(Math.max(0, start))} --> ${srtTime(Math.max(end, start + 300))}\n${text}\n\n`;
    // Transcribing rather than translating (source === target) puts both slots in one file; writing it twice
    // would double every cue.
    const oneFile = rec.srt.source === rec.srt.target;
    if (line.targetText) fs.appendFile(rec.srt.target, cue(++rec.cues.target, line.targetText), (err) => { if (err) this.emit('log', `srt: ${err.message}`); });
    if (line.sourceText && !oneFile) fs.appendFile(rec.srt.source, cue(++rec.cues.source, line.sourceText), (err) => { if (err) this.emit('log', `srt: ${err.message}`); });
    for (const [slot, text] of (oneFile ? [['target', line.targetText]] : [['target', line.targetText], ['source', line.sourceText]])) {
      if (text) fs.appendFile(rec.srt[slot].replace(/\.srt$/i, '.plain.txt'), fromTexts([text]), (err) => { if (err) this.emit('log', `plain transcript: ${err.message}`); });
    }
  }

  /** Finish: flush the encoder, close the file. Resolves with info about the recording. */
  stop() {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    this.rec = null;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        rec.out.end(() => {
          const info = this._info(rec);
          this.last = info;
          this.emit('stop', info);
          resolve(info);
        });
      };
      if (!rec.enc) return finish();
      const enc = rec.enc;
      rec.stopping = finish;
      try { enc.stdin.end(); } catch { finish(); }
      setTimeout(() => { if (!done) { rec.enc = null; try { enc.kill('SIGKILL'); } catch { /* gone */ } finish(); } }, 3000).unref();
    });
  }

  _info(rec) {
    return {
      base: rec.base,
      file: path.basename(rec.mp3),
      startedAt: rec.startedAt,
      durationMs: Math.round((rec.writtenSamples / rec.rate) * 1000),
      bytes: rec.bytes,
      paddedMs: Math.round(rec.paddedMs),
      encoderRestarts: rec.encoderRestarts,
      cues: { ...rec.cues },
      error: rec.error,
    };
  }

  status() {
    const rec = this.rec;
    return {
      recording: !!rec,
      dir: this.dir,
      current: rec ? { ...this._info(rec), elapsedMs: Date.now() - rec.startedAt, encoderAlive: !!rec.enc } : null,
      last: this.last,
    };
  }

  /** Recent recordings on disk, newest first (both naming styles). */
  list(limit = 20) {
    let files;
    try { files = fs.readdirSync(this.dir); } catch { return []; }
    const byBase = new Map();
    for (const name of files) {
      const p = names.parse(name);
      if (!p) continue;
      // yue → zh is the default because it is what every recording made before the manifest existed is.
      const entry = byBase.get(p.base) || { base: p.base, style: p.style, mp3: null, mp4: null, mp4Bytes: 0, summary: null, summaryPdf: null, srt: {}, srtTarget: null, srtSource: null, source: 'yue', target: 'zh', mtime: 0, bytes: 0 };
      const st = fs.statSync(path.join(this.dir, name));
      if (p.kind === 'mp3') { entry.mp3 = name; entry.bytes = st.size; entry.mtime = Math.max(entry.mtime, st.mtimeMs); }
      else if (p.kind === 'mp4') { entry.mp4 = name; entry.mp4Bytes = st.size; }
      else if (p.kind === 'summary') entry.summary = name;
      else if (p.kind === 'pdf') entry.summaryPdf = name;
      else if (p.kind === 'srt') (entry.srt || (entry.srt = {}))[p.lang] = name;
      else if (p.kind === 'manifest') {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
          if (m && typeof m.source === 'string') entry.source = m.source;
          if (m && typeof m.target === 'string') entry.target = m.target;
        } catch { /* unreadable: the default is what the app used to do anyway */ }
      }
      byBase.set(p.base, entry);
    }
    // Subtitle files are found by the language in their name; which slot each fills is the manifest's answer.
    for (const e of byBase.values()) {
      const by = e.srt || (e.srt = {});
      e.srtTarget = by[e.target] || null;
      e.srtSource = by[e.source] || null;
    }
    return [...byBase.values()].filter((e) => e.mp3).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  }
}

module.exports = { Recorder, srtTime, stamp };
