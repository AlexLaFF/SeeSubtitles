'use strict';
// Read and write a recording's subtitle cues: the two SRT sidecars (translation .zh.srt, original .yue.srt)
// paired by start time into [{start, end, zh, yue}] and written back from the same shape.
const fs = require('node:fs');
const names = require('@subs/core/names');
const { srtTime } = require('@subs/core/recorder');

function parseSrt(text) {
  const out = [];
  for (const block of String(text || '').replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) continue;
    const idx = /-->/.test(lines[1]) ? 1 : /-->/.test(lines[0]) ? 0 : -1;
    if (idx < 0) continue;
    const m = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/.exec(lines[idx]);
    if (!m) continue;
    const t = (h, mi, s, ms) => ((+h * 60 + +mi) * 60 + +s) * 1000 + +ms;
    out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: lines.slice(idx + 1).join('\n') });
  }
  return out;
}

/** Pair translation and original cues (written together, so starts match within 50 ms). */
function pair(zh, yue) {
  if (!zh.length) return yue.map((c) => ({ start: c.start, end: c.end, zh: '', yue: c.text }));
  const used = new Set();
  return zh.map((c) => {
    const j = yue.findIndex((y, k) => !used.has(k) && Math.abs(y.start - c.start) < 50);
    if (j >= 0) used.add(j);
    return { start: c.start, end: c.end, zh: c.text, yue: j >= 0 ? yue[j].text : '' };
  });
}

function readCues(dir, base) {
  const read = (kind) => { const f = names.filePath(dir, base, kind); return fs.existsSync(f) ? parseSrt(fs.readFileSync(f, 'utf8')) : []; };
  return pair(read('zh'), read('yue'));
}

const clean = (s) => String(s || '').replace(/\r/g, '').trim();
function toSrt(cues, key) {
  let n = 0;
  return cues.filter((c) => clean(c[key])).map((c) => `${++n}\n${srtTime(Math.max(0, Math.round(c.start)))} --> ${srtTime(Math.max(Math.round(c.start) + 100, Math.round(c.end)))}\n${clean(c[key])}\n`).join('\n') + (n ? '\n' : '');
}

/** Validate and write both SRT files (a file whose language has no text at all is removed). Returns the cleaned cues. */
function writeCues(dir, base, cues) {
  if (!Array.isArray(cues)) throw new Error('cues must be an array');
  const out = cues.map((c) => ({ start: Math.max(0, Number(c.start) || 0), end: Math.max(0, Number(c.end) || 0), zh: clean(c.zh), yue: clean(c.yue) }))
    .filter((c) => c.zh || c.yue).sort((a, b) => a.start - b.start);
  for (const c of out) if (c.end <= c.start) c.end = c.start + 500;
  for (const kind of ['zh', 'yue']) {
    const file = names.filePath(dir, base, kind);
    const srt = toSrt(out, kind);
    if (srt) { fs.writeFileSync(`${file}.part`, srt); fs.renameSync(`${file}.part`, file); }
    else if (fs.existsSync(file)) fs.rmSync(file);
  }
  return out;
}

module.exports = { parseSrt, pair, readCues, writeCues, toSrt };
