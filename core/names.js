'use strict';
// Recording file naming. New style: 9月5号14点33分录音.mp3 and siblings; legacy style
// 2026-09-05_14-33-05.mp3 is still recognised so old folders keep working.
const fs = require('node:fs');
const path = require('node:path');

const SUFFIX = {
  mp3: ['录音.mp3', '.mp3'],
  zh: ['中文字幕.zh.srt', '.zh.srt'],
  yue: ['粤语字幕.yue.srt', '.yue.srt'],
  mp4: ['录音＋字幕.mp4', '.mp4'],
  summary: ['AI总结.md', '.summary.md'],
  pdf: ['AI总结.pdf', '.summary.pdf'],
};
const KINDS = Object.keys(SUFFIX);

function baseFromDate(d = new Date()) {
  return `${d.getMonth() + 1}月${d.getDate()}号${d.getHours()}点${String(d.getMinutes()).padStart(2, '0')}分`;
}

/** Legacy base "2026-09-05_14-33-05" → "9月5号14点33分" (null if not legacy). */
function legacyToCn(base) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(base);
  if (!m) return null;
  return `${Number(m[2])}月${Number(m[3])}号${Number(m[4])}点${m[5]}分`;
}

/** Parse a file name → { base, kind, style } or null. Chinese suffixes are tested first (they are longer). */
function parse(name) {
  if (name.startsWith('.') || name.endsWith('.part')) return null;
  for (const style of [0, 1]) {
    for (const kind of KINDS) {
      const suf = SUFFIX[kind][style];
      if (name.length > suf.length && name.endsWith(suf)) {
        // legacy ".mp4"/".mp3" must not swallow the Chinese forms (already excluded by order) or summary files
        if (style === 1 && kind === 'mp3' && name.endsWith('录音.mp3')) continue;
        return { base: name.slice(0, -suf.length), kind, style: style === 0 ? 'cn' : 'legacy' };
      }
    }
  }
  return null;
}

function fileName(base, kind, style = 'cn') {
  return base + SUFFIX[kind][style === 'legacy' ? 1 : 0];
}

/** Which naming style an existing recording uses (by its mp3, then any sibling). */
function styleOf(dir, base) {
  if (fs.existsSync(path.join(dir, fileName(base, 'mp3', 'cn')))) return 'cn';
  if (fs.existsSync(path.join(dir, fileName(base, 'mp3', 'legacy')))) return 'legacy';
  for (const kind of KINDS) {
    if (fs.existsSync(path.join(dir, fileName(base, kind, 'cn')))) return 'cn';
    if (fs.existsSync(path.join(dir, fileName(base, kind, 'legacy')))) return 'legacy';
  }
  return 'cn';
}

/** Path of a recording's file of the given kind, following the recording's own naming style. */
function filePath(dir, base, kind) {
  return path.join(dir, fileName(base, kind, styleOf(dir, base)));
}

/** A base for a new recording that does not collide with existing files. */
function uniqueBase(dir, base) {
  let candidate = base;
  for (let i = 2; i < 100; i++) {
    const taken = KINDS.some((k) => fs.existsSync(path.join(dir, fileName(candidate, k, 'cn'))) || fs.existsSync(path.join(dir, fileName(candidate, k, 'legacy'))));
    if (!taken) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

module.exports = { SUFFIX, KINDS, baseFromDate, legacyToCn, parse, fileName, styleOf, filePath, uniqueBase };
