'use strict';
// Recording file naming. New style: 9月5号14点33分录音.mp3 and siblings; legacy style
// 2026-09-05_14-33-05.mp3 is still recognised so old folders keep working.
const fs = require('node:fs');
const path = require('node:path');

const SUFFIX = {
  mp3: ['录音.mp3', '.mp3'],
  mp4: ['录音＋字幕.mp4', '.mp4'],
  summary: ['AI总结.md', '.summary.md'],
  pdf: ['AI总结.pdf', '.summary.pdf'],
  // What the recording is: which language was spoken and which was subtitled, written when it starts.
  // Recordings made before this existed have none, and for those the answer is always Cantonese → Mandarin,
  // because that is the only thing the app could do.
  manifest: ['录音.json', '.recording.json'],
};
const KINDS = Object.keys(SUFFIX);

// Subtitle sidecars are named for the language inside them: 9月5号14点33分日文字幕.ja.srt. Two shapes exist
// and both must keep parsing forever — every recording made before this carries the fixed 中文字幕.zh.srt and
// 粤语字幕.yue.srt whatever was spoken, because `zh` and `yue` were slot names pretending to be languages.
// A filename says which language a file holds; only the manifest says which slot that language fills.
const LANG_LABEL = {
  zh: '中文', yue: '粤语', zh_en: '中英', 'zh-TW': '繁中', en: '英文', ja: '日文', ko: '韩文',
  id: '印尼文', th: '泰文', ru: '俄文', vi: '越南文', ms: '马来文', fil: '菲律宾文', es: '西班牙文',
  pt: '葡萄牙文', fr: '法文', de: '德文', tr: '土耳其文', ar: '阿拉伯文', hi: '印地文',
};
// Loose enough for a language we have not met and for the upload pipeline's engine keys (mixed, zh_large),
// with the handful of words this codebase also puts in that position named outright.
const NOT_A_LANGUAGE = /^(live|plain|part|summary)$/;
const LANG_TOKEN = /^[a-z]{2,8}(?:[_-][A-Za-z]{2,6})?$/;
const isLang = (t) => LANG_TOKEN.test(t) && !NOT_A_LANGUAGE.test(t);
const SRT_CN = /^(.*)字幕\.([A-Za-z][A-Za-z_-]{0,14})\.srt$/;
const SRT_LEGACY = /^(.+?)\.([A-Za-z][A-Za-z_-]{0,14})\.srt$/;

/** Name of the subtitle sidecar holding `lang`. */
function srtName(base, lang, style = 'cn') {
  return style === 'legacy' ? `${base}.${lang}.srt` : `${base}${LANG_LABEL[lang] || lang}字幕.${lang}.srt`;
}

/**
 * Parse a subtitle sidecar → { base, kind: 'srt', lang, style }, or null.
 * The label before 字幕 is stripped by knowing what it should be for that language rather than by guessing
 * where it starts — a base may itself contain 字幕, and a lazy pattern gets that wrong.
 */
function parseSrt(name) {
  let m = SRT_CN.exec(name);
  if (m && isLang(m[2])) {
    const label = LANG_LABEL[m[2]] || m[2];
    const base = m[1].endsWith(label) ? m[1].slice(0, -label.length) : m[1];
    if (base) return { base, kind: 'srt', lang: m[2], style: 'cn' };
  }
  m = SRT_LEGACY.exec(name);
  if (m && isLang(m[2])) return { base: m[1], kind: 'srt', lang: m[2], style: 'legacy' };
  return null;
}

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
  if (name.endsWith('.srt')) return parseSrt(name);
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

/** Path of the subtitle sidecar holding `lang`, in whichever naming style this recording uses. */
function srtPath(dir, base, lang) {
  for (const style of ['cn', 'legacy']) {
    const p = path.join(dir, srtName(base, lang, style));
    if (fs.existsSync(p)) return p;
  }
  return path.join(dir, srtName(base, lang, styleOf(dir, base)));
}

/**
 * Which languages a recording holds, from its manifest. Recordings made before manifests existed have none,
 * and for those the answer is always Cantonese → Mandarin: it is the only thing that build could produce.
 */
function languagesOf(dir, base) {
  try {
    const m = JSON.parse(fs.readFileSync(filePath(dir, base, 'manifest'), 'utf8'));
    if (m && typeof m.source === 'string' && typeof m.target === 'string') return { source: m.source, target: m.target };
  } catch { /* absent or unreadable */ }
  return { source: 'yue', target: 'zh' };
}

/** A base for a new recording that does not collide with existing files. */
function uniqueBase(dir, base) {
  let candidate = base;
  for (let i = 2; i < 100; i++) {
    const taken = KINDS.some((k) => fs.existsSync(path.join(dir, fileName(candidate, k, 'cn'))) || fs.existsSync(path.join(dir, fileName(candidate, k, 'legacy'))))
      || (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => { const p = parseSrt(f); return p && p.base === candidate; }));
    if (!taken) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

module.exports = { SUFFIX, KINDS, LANG_LABEL, baseFromDate, legacyToCn, parse, parseSrt, srtName, srtPath, languagesOf, fileName, styleOf, filePath, uniqueBase };
