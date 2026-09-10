'use strict';
// Sentence-level translation for upload jobs (Tencent 混元翻译 on TokenHub, or the legacy Hunyuan API) and
// the split of each sentence's translation back over the subtitle cues that were cut from it.
//
// The recognizer returns whole sentences; cues are ≤ 22-character strips of them. Translating the strips
// one by one loses the rest of the sentence, so the sentence is translated whole and the result is shared
// over its cues in proportion to their length, cutting at punctuation (or spaces for Latin text).

const PUNCT = new Set([...'，。！？；：、,.!?;:'
  + '\u060C\u061B\u061F\u06D4' // Arabic / Persian / Urdu: ، ؛ ؟ ۔
  + '\u0964\u0965'               // Devanagari and Bengali: । ॥
  + '\u05C3']);                   // Hebrew sof pasuq: ׃
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Translate sentences, several per request (newline-joined) to stay well inside the 5-concurrent /
 * 20 QPS defaults, falling back to one request per sentence whenever the model returns a different
 * number of lines so that cue alignment is never guessed.
 * @param {string[]} texts
 * @param {{call:(req:{text:string, source:string, target:string})=>Promise<string>, source:string, target:string,
 *          batchSize?:number, maxChars?:number, concurrency?:number, onProgress?:(done:number,total:number)=>void, sleep?:Function}} o
 * @returns {Promise<string[]>} translations aligned with texts
 */
async function translateSentences(texts, o) {
  const { call, source, target, batchSize = 8, maxChars = 600, concurrency = 4, onProgress, sleep = defaultSleep } = o;
  const out = new Array(texts.length).fill('');
  const batches = [];
  let cur = [];
  let chars = 0;
  texts.forEach((t, i) => {
    if (cur.length && (cur.length >= batchSize || chars + t.length > maxChars)) { batches.push(cur); cur = []; chars = 0; }
    cur.push(i);
    chars += t.length;
  });
  if (cur.length) batches.push(cur);

  async function one(text) {
    if (!String(text).trim()) return '';
    for (let attempt = 0; ; attempt++) {
      try {
        return String((await call({ text, source, target })) || '').trim();
      } catch (err) {
        const msg = err.message || String(err);
        if (attempt >= 4 || /AuthFailure|ServiceNotActivated|InvalidParameter|Arrears|Overdue|HTTP 40[13]/.test(msg)) throw new Error(`translation: ${msg}`);
        await sleep(Math.min(8000, 500 * 2 ** attempt)); // rate limit or a transient error
      }
    }
  }
  async function batch(items) {
    if (items.length === 1) return [await one(items[0])];
    const lines = (await one(items.join('\n'))).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === items.length) return lines;
    const single = [];
    for (const t of items) single.push(await one(t)); // the model merged or split lines: do them one by one
    return single;
  }

  let done = 0;
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const b = batches[next++];
      const lines = await batch(b.map((i) => texts[i]));
      b.forEach((i, k) => { out[i] = lines[k] || ''; });
      done += b.length;
      if (onProgress) onProgress(done, texts.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return out;
}

/**
 * Split one translated sentence into weights.length pieces whose lengths follow the weights (the
 * original cues' lengths), cutting after punctuation near each boundary, else at a space for Latin
 * text, else at the boundary itself. Every piece is non-empty when the text is long enough.
 */
function distribute(translation, weights, cjk = CJK.test(String(translation))) {
  const k = weights.length;
  const chars = [...String(translation || '').trim()];
  if (k <= 1) return [chars.join('')];
  if (!chars.length) return new Array(k).fill('');
  const n = chars.length;
  const total = weights.reduce((a, b) => a + Math.max(0, Number(b) || 0), 0) || k;
  const pieces = [];
  let pos = 0;
  let acc = 0;
  for (let i = 0; i < k - 1; i++) {
    acc += Math.max(0, Number(weights[i]) || 0) || total / k;
    const lo = pos + 1;
    const hi = n - (k - 1 - i); // leave at least one character per remaining piece
    if (lo > hi) { pieces.push(''); continue; }
    const target = Math.min(hi, Math.max(lo, Math.round((acc / total) * n)));
    const window = Math.max(2, Math.floor((target - pos) * 0.45));
    let cut = -1;
    let best = Infinity;
    for (let j = Math.max(lo, target - window); j <= Math.min(hi, target + window); j++) {
      const isPunct = PUNCT.has(chars[j - 1]) && !(chars[j] && PUNCT.has(chars[j]));
      const isSpace = !cjk && (chars[j] === ' ' || chars[j - 1] === ' ');
      const cost = Math.abs(j - target) + (isPunct ? 0 : isSpace ? window : Infinity);
      if (cost < best) { best = cost; cut = j; }
    }
    if (cut < 0) cut = target;
    pieces.push(chars.slice(pos, cut).join('').trim());
    pos = cut;
  }
  pieces.push(chars.slice(pos).join('').trim());
  return pieces;
}

module.exports = { translateSentences, distribute };
