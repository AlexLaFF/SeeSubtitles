'use strict';
// The ffmpeg the app ships is our own build with only the app's components (scripts/build-ffmpeg.sh). A component
// left out would show up as a failed recording or export on someone's Mac, so when the binary is here it is put
// through the app's own pipelines: the recorder's MP3 encode, the MP4 export's PNG-frames + MP3 → H.264/AAC mux,
// the duration probe, and the audio extraction an upload does. Skipped until `npm run build:helpers` has run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { probeDuration } = require('../lib/mp4');

const FFMPEG = path.join(__dirname, '..', 'resources', 'bin', 'ffmpeg');
const here = fs.existsSync(FFMPEG);
const run = (args, input) => spawnSync(FFMPEG, args, { input, maxBuffer: 1e8 });
const text = (args) => String(run(['-hide_banner', ...args]).stdout);

// a 2×2 RGBA PNG made here (white with one red pixel), so the export needs no Swift renderer
const PNG = (() => {
  const zlib = require('node:zlib');
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = Buffer.from([0, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 255, 255, 255, 255, 255, 255, 255]); // filter byte + 2 px, twice
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
})();

test('the bundled ffmpeg is the app\'s own arm64 LGPL build with every component the app calls for', { skip: !here && 'resources/bin/ffmpeg not built' }, () => {
  const version = text(['-version']);
  assert.match(version, /seesubtitles/, 'built by scripts/build-ffmpeg.sh');
  assert.doesNotMatch(version, /--enable-(gpl|nonfree)/);
  assert.match(String(spawnSync('file', ['-b', FFMPEG]).stdout), /arm64/);
  const encoders = text(['-encoders']);
  for (const e of ['libmp3lame', 'aac', 'h264_videotoolbox', 'pcm_s16le']) assert.match(encoders, new RegExp(` ${e} `), `encoder ${e}`);
  const demuxers = text(['-demuxers']);
  for (const d of ['concat', 'image2', 'png_pipe', 'mov,mp4', 'matroska,webm', 'mp3', 'wav', 'avi', 'mpegts', 'flac', 'ogg']) assert.ok(demuxers.includes(d), `demuxer ${d}`);
  assert.match(text(['-devices']), /avfoundation/);
  const filters = text(['-filters']);
  for (const f of ['aresample', 'fps', 'format', 'scale']) assert.match(filters, new RegExp(` ${f} +`), `filter ${f}`);
  assert.ok(fs.statSync(FFMPEG).size < 12e6, `${(fs.statSync(FFMPEG).size / 1e6).toFixed(1)} MB: the point of the build is its size`);
});

test('the recorder\'s MP3 encode, the export\'s mux, the duration probe and an upload\'s audio extraction all work with it', { skip: !here && 'resources/bin/ffmpeg not built' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-bundle-'));
  try {
    // core/recorder.js: one second of 48 kHz mono s16le on stdin → MP3 on stdout
    const pcm = Buffer.alloc(48000 * 2);
    for (let i = 0; i < 48000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 48000 * 440 * 2 * Math.PI) * 12000), i * 2);
    const enc = run(['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '0', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1'], pcm);
    assert.equal(enc.status, 0, String(enc.stderr));
    const mp3 = path.join(dir, 'a.mp3');
    fs.writeFileSync(mp3, enc.stdout);
    assert.ok(enc.stdout.length > 10_000, 'an MP3 came out');
    // lib/mp4.js: the duration read from the file
    const duration = await probeDuration(mp3, FFMPEG);
    assert.ok(duration > 0.9 && duration < 1.2, `duration ${duration}`);
    // lib/mp4.js: PNG frames listed for the concat demuxer + the MP3 → H.264 (VideoToolbox) + AAC in an MP4
    fs.writeFileSync(path.join(dir, 'f1.png'), PNG);
    fs.writeFileSync(path.join(dir, 'concat.txt'), `ffconcat version 1.0\nfile 'f1.png'\nduration 1.0\nfile 'f1.png'\n`);
    const mp4 = path.join(dir, 'a.mp4');
    const mux = run(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'concat.txt'), '-i', mp3,
      '-map', '0:v', '-map', '1:a', '-sn', '-t', '1.0', '-vf', 'fps=15,scale=64:64,format=yuv420p', '-c:v', 'h264_videotoolbox', '-q:v', '55', '-g', '150',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', mp4]);
    assert.equal(mux.status, 0, String(mux.stderr));
    const info = String(run(['-hide_banner', '-i', mp4]).stderr);
    assert.match(info, /Video: h264/);
    assert.match(info, /Audio: aac/);
    // lib/uploads.js: the sound taken out of a video, first copied as it is, then encoded when the container cannot hold it
    const m4a = path.join(dir, 'a.m4a');
    const copy = run(['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'copy', m4a]);
    assert.equal(copy.status, 0, String(copy.stderr));
    assert.match(String(run(['-hide_banner', '-i', m4a]).stderr), /Audio: aac/);
    const fromMp3 = run(['-y', '-hide_banner', '-loglevel', 'error', '-i', mp3, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '160k', path.join(dir, 'b.m4a')]);
    assert.equal(fromMp3.status, 0, String(fromMp3.stderr));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
