'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Recorder, srtTime } = require('../recorder');

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sine(rate, ms, freq = 440) {
  const n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / rate)), i * 2);
  return b;
}

test('srtTime formats hours/minutes/seconds/millis', () => {
  assert.equal(srtTime(0), '00:00:00,000');
  assert.equal(srtTime(1234), '00:00:01,234');
  assert.equal(srtTime(3600000 + 61000 + 5), '01:01:01,005');
  assert.equal(srtTime(-5), '00:00:00,000');
});

test('records a playable MP3 and appends SRT cues', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const r = new Recorder({ dir });
  const base = r.start({ rate: 16000, name: 'unit' });
  assert.equal(base, 'unit');
  assert.ok(r.recording);
  const t0 = r.rec.startedAt;
  for (let i = 0; i < 10; i++) { r.writeAudio(sine(16000, 100)); await sleep(100); }
  r.addSentence({ id: 'a', ended: true, wallStart: t0 + 100, wallEnd: t0 + 900, targetText: '你好', sourceText: '你好呀' });
  r.addSentence({ id: 'a', ended: true, wallStart: t0 + 100, wallEnd: t0 + 900, targetText: 'dup', sourceText: 'dup' }); // ignored
  r.addSentence({ id: 'b', ended: false, wallStart: t0 + 100, targetText: 'partial' }); // ignored
  const info = await r.stop();
  assert.ok(!r.recording);
  assert.equal(info.durationMs, 1000);
  assert.deepEqual(info.cues, { zh: 1, yue: 1 });
  const mp3 = fs.statSync(path.join(dir, 'unit.mp3'));
  assert.ok(mp3.size > 2000, `mp3 size ${mp3.size}`);
  const probed = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(dir, 'unit.mp3')]).toString().trim();
  assert.ok(Math.abs(Number(probed) - 1) < 0.25, `duration ${probed}`);
  assert.equal(fs.readFileSync(path.join(dir, 'unit.zh.srt'), 'utf8'), '1\n00:00:00,100 --> 00:00:00,900\n你好\n\n');
  assert.equal(fs.readFileSync(path.join(dir, 'unit.yue.srt'), 'utf8'), '1\n00:00:00,100 --> 00:00:00,900\n你好呀\n\n');
  assert.equal(r.list()[0].base, 'unit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pads silence when captured audio falls behind the wall clock', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const r = new Recorder({ dir });
  r.start({ rate: 16000, name: 'gap' });
  r.rec.baseLag = 0; // pretend the lag has already been measured
  r.rec.startedAt -= 4000; // simulate 4 s during which no audio arrived
  r.writeAudio(sine(16000, 100));
  assert.ok(r.rec.paddedMs >= 3800 && r.rec.paddedMs <= 4300, `padded ${r.rec.paddedMs}`);
  const info = await r.stop();
  assert.ok(info.durationMs >= 3900, `duration ${info.durationMs}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
