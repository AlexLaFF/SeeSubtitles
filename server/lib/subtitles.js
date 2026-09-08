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
  (sentences || []).forEach((s, sentence) => {
    const words = alignWords(s);
    const cjk = isCjkText(words.map((w) => w.text).join(''));
    const max = cjk ? MAX_CJK : MAX_LATIN;
    const join = (arr) => (cjk ? arr.map((w) => w.text).join('') : arr.map((w) => w.text).join(' ')).replace(/\s+([,.!?;:，。！？；：])/g, '$1').trim();
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      // `sentence` = index of the recognised sentence this cue was cut from (used to translate whole sentences)
      cues.push({ text: join(cur), start: cur[0].start, end: Math.max(cur[cur.length - 1].end, cur[0].start + MIN_MS), speaker: s.SpeakerId ?? null, sentence });
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
  });
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

/**
 * Stacked layout for audio-only renders: the frame fills with sentences like the live display —
 * newest bright at the bottom, earlier ones dimmed, dissolving at the top edge. One Dialogue per
 * (time segment, visible cue) with explicit positions; line counts are estimated from glyph widths
 * (CJK = 1 em, Latin ≈ 0.55 em) so the stack stays consistent across the whole render.
 */
function toStackedAss(cues, { which = 'trans', width = 1080, height = 1920, fontSize = 0, font = 'Noto Sans CJK SC', maxStack = 60 } = {}) {
  const fs = fontSize || Math.round(height / 30);
  const sub = Math.round(fs * 0.55);
  const padX = Math.round(width * 0.05);
  const padBottom = Math.round(height * 0.08);
  const padTop = Math.round(height * 0.03);
  const textW = width - 2 * padX;
  const lineH = (size) => Math.round(size * 1.25);
  const gap = Math.round(fs * 0.5);
  const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
  const charW = (ch, size) => (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch) ? size : size * 0.55);
  const linesFor = (text, size) => {
    let lines = 1;
    let w = 0;
    for (const ch of String(text)) {
      if (ch === '\n') { lines++; w = 0; continue; }
      const cw = charW(ch, size);
      if (w + cw > textW) { lines++; w = cw; } else w += cw;
    }
    return lines;
  };
  const mainOf = (c) => (which === 'text' ? c.text : (c.trans || c.text));
  const bilingual = (c) => which === 'both' && c.trans && c.text;
  const blockH = (c) => linesFor(mainOf(c), fs) * lineH(fs) + (bilingual(c) ? linesFor(c.text, sub) * lineH(sub) : 0);
  const hex = (a) => a.toString(16).toUpperCase().padStart(2, '0');
  const textOf = (c, alpha) => {
    const main = `{\\alpha&H${hex(alpha)}&}${esc(mainOf(c))}`;
    return bilingual(c) ? `${main}\\N{\\fs${sub}\\alpha&H${hex(Math.min(255, alpha + 0x30))}&}${esc(c.text)}` : main;
  };

  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Stack,${font},${fs},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(fs / 16))},0,2,${padX},${padX},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const sorted = [...cues].filter((c) => mainOf(c)).sort((a, b) => a.start - b.start);
  const heights = sorted.map(blockH);
  const times = new Set([0]);
  for (const c of sorted) { times.add(c.start); times.add(c.end); }
  const ts = [...times].sort((a, b) => a - b);
  const events = [];
  let firstVisible = 0;
  for (let k = 0; k + 1 < ts.length; k++) {
    const t = ts[k];
    const next = ts[k + 1];
    if (next - t < 0.001) continue;
    let last = firstVisible;
    while (last < sorted.length && sorted[last].start <= t + 1e-6) last++;
    const from = Math.max(0, last - maxStack);
    let y = height - padBottom; // bottom edge of the newest block
    for (let i = last - 1; i >= from; i--) {
      const top = y - heights[i];
      if (y <= padTop) { firstVisible = Math.max(firstVisible, i + 1); break; }
      let alpha = sorted[i].end <= t + 1e-6 ? 0x73 : 0x00; // earlier sentences at ~55 %
      if (top < padTop + lineH(fs)) alpha = Math.max(alpha, 0xB0); // dissolving at the top edge
      events.push(`Dialogue: 0,${assTime(t)},${assTime(next)},Stack,,0,0,0,,{\\an2\\pos(${Math.round(width / 2)},${Math.round(y)})}${textOf(sorted[i], alpha)}`);
      y = top - gap;
    }
  }
  return head + events.join('\n') + '\n';
}

module.exports = { buildCues, alignWords, toSrt, toVtt, toTxt, toAss, toStackedAss, isCjkText };
