'use strict';
// Uploaded files are translated whole: the model reads the transcript in windows of many sentences, each window
// with the previous one (already translated) in view, so a name, a term or a form of address worked out at minute
// three is the same at minute fifty, and a line that only makes sense given the reply is translated with the reply
// in sight. Nobody is waiting for a file, so this is the slow, careful way — the live pipeline stays line by line.
//
// Chosen on 2026-09-22 (server/probe-translate.js, a Japanese transcript through four translators): deepseek-v4-flash
// read naturally and used the context — it wrote "Red" where the recogniser had misheard ベッド, and "I will do my
// utmost" where it had heard 魅力 for 微力 — while hy-mt2-pro, eight sentences a request with no context, left
// 「トドメ」 untranslated and wrote "I'll do my best to be charming". Alibaba's Qwen models translated as well but
// their content filter refused explicit lines outright, which would leave holes in a subtitle track.
//
// Alignment is never guessed: sentences go in numbered and must come back with the same numbers. A window that
// comes back short, or is refused, is asked again once and then translated sentence by sentence the old way
// (`fallback`), and so is any single sentence the model left empty.

const WINDOW = 120; // sentences a request
const CARRY = 30; // earlier sentences shown, with their translations, as context

// Languages the model writes well; a pair outside these stays with hy-mt2, which knows the smaller ones better.
// Keys are the codes jobs.js hands the translator (Hunyuan's; zh-TR is Traditional Chinese).
const NAMES = {
  zh: 'Simplified Chinese', 'zh-TR': 'Traditional Chinese', yue: 'written Cantonese', en: 'English', ja: 'Japanese',
  ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', ru: 'Russian',
  pl: 'Polish', cs: 'Czech', uk: 'Ukrainian', tr: 'Turkish', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
  ms: 'Malay', fil: 'Filipino', ar: 'Arabic', he: 'Hebrew', fa: 'Persian', hi: 'Hindi',
};

/** Whether a file in `source` translated into `target` goes to the whole-file model. '' is "detect the language". */
const handles = (source, target) => Boolean(NAMES[target]) && (source === '' || Boolean(NAMES[source]));

function systemPrompt(source, target) {
  const from = NAMES[source] ? `${NAMES[source]} ` : '';
  return `You translate the subtitles of a ${from}video into natural, fluent ${NAMES[target] || target}.
You receive numbered subtitle lines in order. Reply with exactly the same numbers, one translated line each, in the form "N. text", and nothing else.
Never merge, split, skip or reorder lines. Keep names, terms and forms of address consistent throughout; keep each speaker's tone and register; translate interjections and fragments the way a native subtitler would, not literally.
The lines were recognised from speech by a machine and may contain misheard words: where the context makes the intended word clear, translate what was meant.
Lines under "Earlier lines" are context already translated: do not translate them again.`;
}

const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim();

/** "N. text" lines → the texts for numbers from..from+count-1, or null unless every number is there. */
function parseNumbered(text, from, count) {
  const out = new Array(count).fill(null);
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s*[.)、:：]\s?(.*)$/.exec(line);
    if (!m) continue;
    const i = Number(m[1]) - from;
    if (i >= 0 && i < count && out[i] === null) out[i] = m[2].trim();
  }
  return out.every((x) => x !== null) ? out : null;
}

/**
 * Translate sentences through a chat model, a window at a time.
 * @param {string[]} texts
 * @param {{ask:(body:object)=>Promise<{text:string, stopReason:string|null}>, model:string, source:string, target:string,
 *          fallback:(texts:string[])=>Promise<string[]>, onProgress?:(done:number,total:number)=>void,
 *          log?:(msg:string)=>void, window?:number, carry?:number}} o
 * @returns {Promise<{translations:string[], windows:number, fellBack:number, filled:number}>}
 */
async function translateWhole(texts, o) {
  const { ask, model, source, target, fallback, onProgress, log = () => {}, window = WINDOW, carry = CARRY } = o;
  const lines = texts.map(oneLine);
  const out = new Array(lines.length).fill('');
  const system = systemPrompt(source, target);
  let windows = 0; let fellBack = 0; let filled = 0;
  for (let at = 0; at < lines.length; at += window) {
    windows++;
    const chunk = lines.slice(at, at + window);
    const from = Math.max(0, at - carry);
    const earlier = at > from
      ? `Earlier lines (context, already translated):\n${lines.slice(from, at).map((t, i) => `${from + i + 1}. ${t} → ${out[from + i]}`).join('\n')}\n\n`
      : '';
    const user = `${earlier}Translate these lines:\n${chunk.map((t, i) => `${at + i + 1}. ${t}`).join('\n')}`;
    let got = null;
    for (let attempt = 1; attempt <= 2 && !got; attempt++) {
      try {
        const r = await ask({ model, max_tokens: 32000, system, messages: [{ role: 'user', content: user }] });
        if (r.stopReason === 'max_tokens' || r.stopReason === 'refusal') { log(`lines ${at + 1}–${at + chunk.length}: the model stopped (${r.stopReason})`); continue; }
        got = parseNumbered(r.text, at + 1, chunk.length);
        if (!got) log(`lines ${at + 1}–${at + chunk.length}: the answer did not have one line per number`);
      } catch (err) {
        log(`lines ${at + 1}–${at + chunk.length}: ${err.message}`);
      }
    }
    if (!got) {
      fellBack++;
      got = await fallback(chunk);
    } else {
      // a sentence the model left empty (a refusal of that one line, usually) is translated on its own
      const missing = got.map((t, i) => (!t && chunk[i] ? i : -1)).filter((i) => i >= 0);
      if (missing.length) {
        filled += missing.length;
        const fill = await fallback(missing.map((i) => chunk[i]));
        missing.forEach((i, k) => { got[i] = fill[k] || ''; });
      }
    }
    got.forEach((t, i) => { out[at + i] = t; });
    if (onProgress) onProgress(Math.min(at + window, lines.length), lines.length);
  }
  return { translations: out, windows, fellBack, filled };
}

module.exports = { translateWhole, handles, parseNumbered, systemPrompt, NAMES, WINDOW, CARRY };
