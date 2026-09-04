'use strict';
// Cue building from Tencent 录音文件识别 sentence/word results, and SRT / VTT / ASS writers.
const { srtTime } = require('@subs/core');

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/g;
const END_PUNCT = /[。！？.!?；;]$/;
const SOFT_PUNCT = /[，,、：:]$/;
const MAX_CJK = 22;      // characters per cue for CJK text
const MAX_LATIN = 44;    // characters per cue for Latin text
const MAX_MS = 7000;     // cue duration cap
const MIN_MS = 700;      // cue duration floor
const GAP_MS = 60;       // keep cues from touching

const isCjkText = (s) => (String(s).match(CJK) || []).length > String(s).replace(/\s/g, '').length / 2;

/**
 * Attach the punctuation of FinalSentence to the word list (Tencent's Words carry no punctuation).
 * Returns [{text, start, end}] in absolute ms.
 */
function alignWords(sentence) {
  const text = String(sentence.FinalSentence || sentence.SliceSentence || '');
  const base = Number(sentence.StartMs) || 0;
  const words = (sentence.Words || []).map((w) => ({ text: String(w.Word || ''), start: base + (Number(w.OffsetStartMs) || 0), end: base + (Number(w.OffsetEndMs) || 0) })).filter((w) => w.text);
  if (!words.length) return [{ text, start: base, end: Number(sentence.EndMs) || base + 1000 }];
  const lower = text.toLowerCase();
  let cursor = 0;
  let misses = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const idx = lower.indexOf(w.text.toLowerCase(), cursor);
    if (idx < 0 || idx - cursor > 8) { misses++; continue; }
    const between = text.slice(cursor, idx).trim();
    if (between && i > 0) words[i - 1].text += between;
    w.text = text.slice(idx, idx + w.text.length);
    cursor = idx + w.text.length;
  }
  const tail = text.slice(cursor).trim();
  if (tail && misses < words.length / 2) words[words.length - 1].text += tail;
  return words;
}

/** Split recognised sentences into readable cues with word-accurate timing. */
function buildCues(sentences) {
  const cues = [];
  for (const s of sentences || []) {
    const words = alignWords(s);
    const cjk = isCjkText(words.map((w) => w.text).join(''));
    const max = cjk ? MAX_CJK : MAX_LATIN;
    const join = (arr) => (cjk ? arr.map((w) => w.text).join('') : arr.map((w) => w.text).join(' ')).replace(/\s+([,.!?;:，。！？；：])/g, '$1').trim();
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      cues.push({ text: join(cur), start: cur[0].start, end: Math.max(cur[cur.length - 1].end, cur[0].start + MIN_MS), speaker: s.SpeakerId ?? null });
      cur = [];
    };
    for (const w of words) {
      const len = join([...cur, w]).length;
      const dur = cur.length ? w.end - cur[0].start : 0;
      if (cur.length && (len > max || dur > MAX_MS)) flush();
      cur.push(w);
      const t = join(cur);
      if (END_PUNCT.test(t) && t.length >= (cjk ? 6 : 12)) flush();
      else if (SOFT_PUNCT.test(t) && t.length >= max * 0.7) flush();
    }
    flush();
  }
  // tidy: monotone, non-overlapping, ids
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (i > 0 && c.start < cues[i - 1].end + GAP_MS) c.start = cues[i - 1].end + GAP_MS;
    if (c.end < c.start + MIN_MS) c.end = c.start + MIN_MS;
    if (i + 1 < cues.length && c.end > cues[i + 1].start - GAP_MS) c.end = Math.max(c.start + 200, cues[i + 1].start - GAP_MS);
    c.id = i + 1;
  }
  return cues;
}

const vttTime = (ms) => srtTime(ms).replace(',', '.');

/** which: 'text' | 'trans' | 'both' (translation above the original) */
function cueLines(c, which) {
  if (which === 'trans') return [c.trans || c.text];
  if (which === 'both') return [c.trans || '', c.text].filter(Boolean);
  return [c.text];
}
function toSrt(cues, which = 'text') {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${cueLines(c, which).join('\n')}\n`).join('\n');
}
function toVtt(cues, which = 'text') {
  return `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${cueLines(c, which).join('\n')}\n`).join('\n')}`;
}
function toTxt(cues, which = 'text') {
  return cues.map((c) => cueLines(c, which).join(' / ')).join('\n');
}

const assTime = (ms) => {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
/** ASS for burned-in subtitles (ffmpeg's ass filter). Two styles: Main (translation) and Sub (original, smaller). */
function toAss(cues, { which = 'trans', width = 1920, height = 1080, fontSize = 0, font = 'Noto Sans CJK SC' } = {}) {
  const fs = fontSize || Math.round(height / 22);
  const sub = Math.round(fs * 0.7);
  const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${font},${fs},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(fs / 18))},0,2,40,40,${Math.round(height * 0.06)},1
Style: Sub,${font},${sub},&H00DDDDDD,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(sub / 18))},0,2,40,40,${Math.round(height * 0.06) + fs + 8},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  for (const c of cues) {
    const t = `${assTime(c.start)},${assTime(c.end)}`;
    if (which === 'both') {
      if (c.trans) lines.push(`Dialogue: 0,${t},Main,,0,0,0,,${esc(c.trans)}`);
      lines.push(`Dialogue: 0,${t},Sub,,0,0,0,,${esc(c.text)}`);
    } else {
      lines.push(`Dialogue: 0,${t},Main,,0,0,0,,${esc(which === 'trans' ? c.trans || c.text : c.text)}`);
    }
  }
  return head + lines.join('\n') + '\n';
}

module.exports = { buildCues, alignWords, toSrt, toVtt, toTxt, toAss, isCjkText };
