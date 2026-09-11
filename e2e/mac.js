#!/usr/bin/env node
'use strict';
// The part of the release test only a Mac can do. The app burns subtitles into its MP4 with a native macOS renderer
// (desktop/lib/mp4.js → helpers/render-subs.swift) that the Linux test image cannot run, so the server run hands back
// the recording it just made and this renders it exactly as the app does, then checks the video. No keys involved.
//
//   node e2e/mac.js <folder holding one recording>
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Mp4Queue } = require('../desktop/lib/mp4');
const names = require('@subs/core/names');

const NAME = "mp4: the app burns the subtitles into a video, with the Mac's own renderer";
const t0 = Date.now();
const took = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
const fail = (msg) => { console.log(`  ✖ ${NAME} (${took()}) — ${msg}`); process.exit(1); };
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]).toString());

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) fail('no recording came back from the server run');
const suffix = names.fileName('', 'manifest');
const manifest = fs.readdirSync(dir).find((f) => f.endsWith(suffix));
if (!manifest) fail('no recording came back from the server run');
const base = manifest.slice(0, -suffix.length);

const queue = new Mp4Queue({ dir, ffmpeg: require('ffmpeg-static') });
queue.on('log', () => {});
const timer = setTimeout(() => fail('timed out after 5 minutes'), 5 * 60_000);
new Promise((resolve, reject) => {
  queue.on('done', resolve);
  queue.on('error', (e) => reject(new Error(e.error)));
  queue.add(base);
}).then((r) => {
  clearTimeout(timer);
  const out = r && r.file && path.isAbsolute(r.file) ? r.file : path.join(dir, names.fileName(base, 'mp4'));
  if (!fs.existsSync(out)) fail(`no ${path.basename(out)}`);
  const p = probe(out);
  const kinds = p.streams.map((s) => s.codec_type);
  if (!kinds.includes('video') || !kinds.includes('audio')) fail(`the MP4 has ${kinds.join(' + ')}`);
  const audio = Number(probe(path.join(dir, names.fileName(base, 'mp3'))).format.duration);
  const video = Number(p.format.duration);
  if (Math.abs(video - audio) > 2) fail(`the MP4 is ${video.toFixed(1)} s for ${audio.toFixed(1)} s of audio`);
  console.log(`  ✔ ${NAME} (${took()}) — ${video.toFixed(0)} s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
  process.exit(0);
}, (err) => fail(err.message));
