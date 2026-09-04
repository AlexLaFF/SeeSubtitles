'use strict';
// Microphone capture (native AVAudioEngine helper, ffmpeg fallback) → 48 kHz mono s16le → FIR decimate
// to 16 kHz → exact 200 ms chunks (6400 bytes). Restarts the capture process if it dies or stalls.
const { spawn, execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { Decimator } = require('@subs/core/decimator');

const IN_RATE = 48000;
const OUT_RATE = 16000;
const CHUNK_MS = 200;
const CHUNK_SAMPLES = (OUT_RATE * CHUNK_MS) / 1000; // 3200
const CHUNK_BYTES = CHUNK_SAMPLES * 2; // 6400
const STALL_MS = 5000;
const RESTART_BACKOFF_MS = [1000, 2000, 4000, 8000, 10000];

// Native helper (helpers/capture-helper.swift → bin/capture-helper). ffmpeg's AVFoundation input drops
// ~10% of audio frames in audio-only capture, so the AVAudioEngine helper is the default backend;
// ffmpeg (wall-clock locked) is the fallback when the helper cannot be built.
const { buildHelper } = require('./helpers');
const ensureHelper = (log) => buildHelper('capture-helper', log);

/** List input devices. Native backend: names (stable); ffmpeg backend: AVFoundation indices. */
async function listDevices(ffmpeg = 'ffmpeg', backend = process.env.AUDIO_BACKEND || 'auto') {
  const helper = backend === 'ffmpeg' ? null : await ensureHelper();
  if (helper) {
    return new Promise((resolve) => {
      execFile(helper, ['--list'], { timeout: 15000 }, (err, stdout) => {
        if (err) return resolve({ error: `native helper: ${err.message}`, devices: [], backend: 'native' });
        try {
          const list = JSON.parse(stdout);
          resolve({ backend: 'native', devices: list.map((d) => ({ id: d.name, name: d.name, inputs: d.inputs, default: !!d.default })) });
        } catch (e) {
          resolve({ error: `native helper: ${e.message}`, devices: [], backend: 'native' });
        }
      });
    });
  }
  return listDevicesFfmpeg(ffmpeg);
}

function listDevicesFfmpeg(ffmpeg = 'ffmpeg') {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ error: 'ffmpeg not found (brew install ffmpeg)', devices: [] });
      const devices = [];
      let inAudio = false;
      for (const line of `${stderr}\n${stdout}`.split('\n')) {
        if (/AVFoundation audio devices/i.test(line)) { inAudio = true; continue; }
        if (/AVFoundation video devices/i.test(line)) { inAudio = false; continue; }
        const m = inAudio && line.match(/\[(\d+)\]\s+(.+?)\s*$/);
        if (m) devices.push({ id: String(m[1]), index: Number(m[1]), name: m[2] });
      }
      resolve({ devices, backend: 'ffmpeg' });
    });
  });
}

class AudioCapture extends EventEmitter {
  constructor({ device = 'default', ffmpeg = 'ffmpeg', backend = process.env.AUDIO_BACKEND || 'auto' } = {}) {
    super();
    this.device = device || 'default';
    this.ffmpeg = ffmpeg;
    this.requestedBackend = backend; // auto | native | ffmpeg
    this.backend = null; // resolved in start()
    this.helper = null;
    this.rate = IN_RATE; // sample rate of the 'raw' event
    this.proc = null;
    this.running = false;
    this.restarts = 0;
    this.failures = 0;
    this.bytes = 0;
    this.lastData = 0;
    this.lastError = null;
    this.restartTimer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastData = Date.now();
    this._prepare().then(() => {
      if (!this.running || this.proc) return;
      this._spawn();
      this.watchdog = setInterval(() => this._check(), 1000);
    });
  }

  async _prepare() {
    if (this.backend) return;
    if (this.requestedBackend !== 'ffmpeg') this.helper = await ensureHelper((t) => this.emit('log', t));
    if (this.requestedBackend === 'native' && !this.helper) this.emit('error', new Error('native audio helper unavailable (needs Xcode / swiftc)'));
    this.backend = this.helper ? 'native' : 'ffmpeg';
  }

  stop() {
    this.running = false;
    clearInterval(this.watchdog);
    clearTimeout(this.restartTimer);
    this._kill();
  }

  setDevice(device) {
    this.device = device || 'default';
    if (!this.running) return;
    this.failures = 0;
    clearTimeout(this.restartTimer);
    this._kill();
    this._spawn();
  }

  status() {
    return {
      running: this.running,
      alive: !!this.proc,
      device: this.device,
      backend: this.backend,
      restarts: this.restarts,
      bytes: this.bytes,
      lastDataAgoMs: this.lastData ? Date.now() - this.lastData : null,
      lastError: this.lastError,
    };
  }

  _command() {
    if (this.helper) return [this.helper, ['--device', this.device, '--rate', String(IN_RATE)]];
    // ffmpeg fallback: wall-clock timestamps + async resampling keep the stream real-time even though
    // the AVFoundation input drops frames (gaps become short silences instead of a slow stream)
    return [this.ffmpeg, [
      '-hide_banner', '-loglevel', 'warning', '-nostdin', '-use_wallclock_as_timestamps', '1',
      '-f', 'avfoundation', '-i', `:${this.device}`,
      '-af', 'aresample=async=1000:min_hard_comp=0.1:first_pts=0',
      '-ac', '1', '-ar', String(IN_RATE), '-f', 's16le', '-',
    ]];
  }

  _spawn() {
    this.decimator = new Decimator({ factor: IN_RATE / OUT_RATE });
    this.pending = new Int16Array(CHUNK_SAMPLES);
    this.pendingLen = 0;
    this.carry = null;
    this.lastData = Date.now();
    const [cmd, args] = this._command();
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    this.emit('start', { device: this.device, backend: this.backend });
    proc.stdout.on('data', (buf) => this._onData(buf));
    proc.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (!text) return;
      if (!/^capturing /.test(text)) this.lastError = text.split('\n').pop().slice(0, 200);
      this.emit('log', text);
    });
    proc.on('error', (err) => {
      this.lastError = err.code === 'ENOENT' ? `${path.basename(cmd)} not found${cmd === this.ffmpeg ? ' (brew install ffmpeg)' : ''}` : err.message;
      this.emit('error', new Error(this.lastError));
    });
    proc.on('exit', (code, signal) => {
      if (proc !== this.proc) return;
      this.proc = null;
      this.emit('exit', { code, signal });
      if (code === 3) this.failures = 0; // helper exits 3 on a device/config change: restart right away
      if (this.running) this._scheduleRestart();
    });
  }

  _kill() {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    try { proc.kill('SIGTERM'); } catch { /* already gone */ }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* fine */ } }, 1500).unref();
  }

  _scheduleRestart() {
    const delay = RESTART_BACKOFF_MS[Math.min(this.failures, RESTART_BACKOFF_MS.length - 1)];
    this.failures++;
    this.restarts++;
    this.restartTimer = setTimeout(() => { if (this.running && !this.proc) this._spawn(); }, delay);
  }

  _check() {
    if (!this.running || !this.proc) return;
    const quiet = Date.now() - this.lastData;
    if (quiet > STALL_MS) {
      this.emit('stall', quiet);
      this._kill(); // exit handler restarts it
      this._scheduleRestart();
    } else if (quiet < 1000 && this.failures && Date.now() - this.lastData < 1000 && this.bytes > IN_RATE * 2 * 10) {
      this.failures = 0; // stable for a while → reset backoff
    }
  }

  _onData(buf) {
    this.lastData = Date.now();
    this.bytes += buf.length;
    if (this.carry) { buf = Buffer.concat([this.carry, buf]); this.carry = null; }
    const n = buf.length >> 1;
    if (buf.length & 1) this.carry = Buffer.from(buf.subarray(buf.length - 1));
    const samples = new Int16Array(n);
    for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(i * 2);
    this.emit('raw', buf.subarray(0, n * 2)); // 48 kHz mono s16le, before decimation (for recording)
    const out = this.decimator.process(samples);
    let pos = 0;
    while (pos < out.length) {
      const take = Math.min(CHUNK_SAMPLES - this.pendingLen, out.length - pos);
      this.pending.set(out.subarray(pos, pos + take), this.pendingLen);
      this.pendingLen += take;
      pos += take;
      if (this.pendingLen === CHUNK_SAMPLES) this._emitChunk();
    }
  }

  _emitChunk() {
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < CHUNK_SAMPLES; i++) {
      const s = this.pending[i];
      chunk.writeInt16LE(s, i * 2);
      sum += s * s;
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
    }
    this.pendingLen = 0;
    const rms = Math.sqrt(sum / CHUNK_SAMPLES);
    const t1 = Date.now();
    this.emit('chunk', chunk, { rms, peak, dbfs: 20 * Math.log10(Math.max(rms, 1) / 32768), t0: t1 - CHUNK_MS, t1 });
  }
}

/**
 * Same interface as AudioCapture but plays a 16 kHz mono 16-bit WAV/PCM file at real-time pace
 * (looping). For rehearsals and for testing the pipeline without a microphone: AUDIO_FILE=clip.wav
 */
class FileCapture extends EventEmitter {
  constructor({ file, loop = true } = {}) {
    super();
    this.file = file;
    this.loop = loop;
    this.rate = OUT_RATE; // file is already 16 kHz; 'raw' is emitted at this rate
    this.running = false;
    this.offset = 0;
    this.timer = null;
    this.pcm = FileCapture.load(file);
  }

  static load(file) {
    const fs = require('node:fs');
    let buf = fs.readFileSync(file);
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF') {
      let pos = 12;
      while (pos + 8 <= buf.length) {
        const id = buf.toString('ascii', pos, pos + 4);
        const size = buf.readUInt32LE(pos + 4);
        if (id === 'data') { buf = buf.subarray(pos + 8, pos + 8 + size); break; }
        pos += 8 + size + (size & 1);
      }
    }
    return buf;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.emit('start', { device: `file:${this.file}` });
    this.timer = setInterval(() => {
      if (this.offset + CHUNK_BYTES > this.pcm.length) {
        if (!this.loop) return this.stop();
        this.offset = 0;
      }
      const chunk = Buffer.from(this.pcm.subarray(this.offset, this.offset + CHUNK_BYTES));
      this.offset += CHUNK_BYTES;
      let sum = 0;
      for (let i = 0; i < CHUNK_BYTES; i += 2) { const v = chunk.readInt16LE(i); sum += v * v; }
      const rms = Math.sqrt(sum / (CHUNK_BYTES / 2));
      const t1 = Date.now();
      this.emit('raw', chunk);
      this.emit('chunk', chunk, { rms, peak: 0, dbfs: 20 * Math.log10(Math.max(rms, 1) / 32768), t0: t1 - CHUNK_MS, t1 });
    }, CHUNK_MS);
  }

  stop() { this.running = false; clearInterval(this.timer); this.timer = null; }
  setDevice() { /* not applicable */ }
  status() { return { running: this.running, alive: this.running, device: `file:${this.file}`, restarts: 0, bytes: this.offset, lastDataAgoMs: 0, lastError: null }; }
}

module.exports = { AudioCapture, FileCapture, listDevices, listDevicesFfmpeg, ensureHelper, CHUNK_BYTES, CHUNK_MS };

if (require.main === module) {
  if (process.argv.includes('--list')) {
    listDevices().then((r) => {
      if (r.error) { console.error(r.error); process.exit(1); }
      console.log(`Audio inputs via ${r.backend} backend (use the ${r.backend === 'native' ? 'name' : 'index'} as AUDIO_DEVICE):`);
      for (const d of r.devices) console.log(`  ${r.backend === 'native' ? d.name : `[${d.index}] ${d.name}`}${d.default ? '   (system default)' : ''}`);
    });
  } else {
    // quick level meter: node lib/capture.js [device]
    const cap = new AudioCapture({ device: process.argv[2] || 'default' });
    cap.on('start', (s) => console.log('capturing from', s.device, 'via', s.backend));
    cap.on('log', (t) => console.error('ffmpeg:', t));
    cap.on('chunk', (chunk, lvl) => {
      const bars = '█'.repeat(Math.max(0, Math.round((lvl.dbfs + 60) / 2)));
      process.stdout.write(`\r${lvl.dbfs.toFixed(1).padStart(6)} dBFS ${bars.padEnd(30)}`);
    });
    cap.start();
    process.on('SIGINT', () => { cap.stop(); console.log(); process.exit(0); });
  }
}
