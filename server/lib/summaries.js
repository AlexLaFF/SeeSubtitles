'use strict';
// AI learning summaries made here, for a client that sends a recording's cues and gets Markdown back: the iOS app
// and, since 0.8.4, the Mac (desktop/lib/summary.js) — neither holds a key, and neither carries a copy of the
// prompt, which is core/summary.js. This file is the conversation with the model: one streamed request to
// TokenHub's Anthropic-compatible endpoint, a second cheap one when the answer is over its length cap, and the
// clean-up. No SDK: the stream is server-sent events, read here line by line. A client may name one of the
// models core/summary.js lists and an effort; anything else gets the server's defaults.
const { transcriptFromCues, lengthBudget, countChars, systemPrompt, userPrompt, condensePrompts, thinkingFor, sanitizeTimestamps, LANG_NAMES, SUMMARY_MODELS, DEFAULT_SUMMARY_MODEL, SUMMARY_EFFORTS } = require('@subs/core/summary');

const DEFAULT_BASE = 'https://tokenhub.tencentmaas.com';
const DEFAULT_MODEL = DEFAULT_SUMMARY_MODEL;
const MAX_CUES = 20_000; // ten hours of talk at a sentence every two seconds
const MAX_TEXT = 2_000; // characters in one cue; a sentence is cut at 6 s, so this is only a guard

class SummaryError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

/** Cues as a client sends them → cues the prompt can trust. Throws SummaryError('bad_cues'). */
function cleanCues(list, what) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new SummaryError('bad_cues', `${what} must be a list of cues`);
  if (list.length > MAX_CUES) throw new SummaryError('bad_cues', `${what} has more than ${MAX_CUES} cues`);
  const out = [];
  for (const c of list) {
    const start = Number(c && c.start);
    const end = Number(c && c.end);
    const text = String((c && c.text) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) throw new SummaryError('bad_cues', `${what} has a cue without usable times`);
    if (text) out.push({ start: Math.round(start), end: Math.round(end), text });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * One request to the model, streamed. Resolves with { text, model, stopReason, usage }.
 * @param {object} o  { key, baseUrl, body, onText, onThinking, signal, fetchImpl }
 */
async function ask({ key, baseUrl = DEFAULT_BASE, body, onText = () => {}, onThinking = () => {}, signal, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(new URL('/v1/messages', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (err) {
    throw new SummaryError('summary_unreachable', `the summary service could not be reached: ${err.message}`, 502);
  }
  if (!res.ok) {
    const raw = (await res.text().catch(() => '')).slice(0, 300);
    let message = raw;
    try { const j = JSON.parse(raw); message = (j.error && j.error.message) || j.message || raw; } catch { /* not JSON */ }
    throw new SummaryError('summary_refused', `the summary service answered ${res.status}: ${message}`, 502);
  }
  const out = { text: '', model: body.model, stopReason: null, usage: { input: 0, output: 0 } };
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (data) => {
    let ev = null;
    try { ev = JSON.parse(data); } catch { return; }
    if (ev.type === 'message_start' && ev.message) {
      if (ev.message.model) out.model = ev.message.model;
      if (ev.message.usage) out.usage.input = ev.message.usage.input_tokens || 0;
    } else if (ev.type === 'content_block_delta' && ev.delta) {
      if (ev.delta.type === 'text_delta' && ev.delta.text) { out.text += ev.delta.text; onText(ev.delta.text); }
      else if (ev.delta.type === 'thinking_delta') onThinking();
    } else if (ev.type === 'message_delta') {
      if (ev.delta && ev.delta.stop_reason) out.stopReason = ev.delta.stop_reason;
      if (ev.usage && ev.usage.output_tokens) out.usage.output = ev.usage.output_tokens;
    } else if (ev.type === 'error') {
      throw new SummaryError('summary_refused', `the summary service failed: ${(ev.error && ev.error.message) || 'error'}`, 502);
    }
  };
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('data:')) handle(line.slice(5).trim());
    }
  }
  return out;
}

/**
 * Summarise one recording.
 * @param {object} req   { name, language, target: cues, source?: cues, model?, effort? } — cues are { start, end, text }
 *                       in ms; `model` and `effort` count only when core/summary.js lists them
 * @param {object} o     { key, baseUrl?, model?, effort?, onStage?, onDelta?, signal?, fetchImpl? } — the server's defaults
 * @returns {Promise<{markdown:string, meta:object}>}
 */
async function summarise(req, { key, baseUrl, model: defaultModel = DEFAULT_MODEL, effort: defaultEffort = 'high', onStage = () => {}, onDelta = () => {}, signal, fetchImpl } = {}) {
  if (!key) throw new SummaryError('no_key', 'the server has no TokenHub key configured', 503);
  const model = SUMMARY_MODELS.includes(req && req.model) ? req.model : defaultModel;
  const effort = SUMMARY_EFFORTS.includes(req && req.effort) ? req.effort : defaultEffort;
  const language = LANG_NAMES[req && req.language] ? req.language : 'zh';
  const name = String((req && req.name) || 'recording').replace(/[\r\n<>]/g, ' ').slice(0, 120);
  const transcript = (() => {
    try { return transcriptFromCues(cleanCues(req && req.target, 'target'), cleanCues(req && req.source, 'source')); }
    catch (err) { throw err instanceof SummaryError ? err : new SummaryError('no_cues', err.message); }
  })();
  const budget = lengthBudget(transcript.spokenChars);
  const t0 = Date.now();
  const thinking = thinkingFor(effort);

  onStage('asking');
  let thought = false;
  let wrote = false;
  let message = await ask({
    key, baseUrl, signal, fetchImpl,
    body: { model, max_tokens: 64000, thinking, system: systemPrompt(language, budget), messages: [{ role: 'user', content: userPrompt(name, transcript, budget) }] },
    onThinking: () => { if (!thought) { thought = true; onStage('thinking'); } },
    onText: (delta) => { if (!wrote) { wrote = true; onStage('writing'); } onDelta(delta); },
  });
  if (message.stopReason === 'refusal') throw new SummaryError('summary_declined', 'the model declined to summarise this recording', 502);
  let body = message.text.trim();
  if (!body) throw new SummaryError('summary_empty', 'the model answered with nothing', 502);
  const usage = { ...message.usage };

  // over the cap: one condensing pass (cheap — the transcript is not resent). What streamed so far is a draft
  // the client replaces with the final text, so the deltas of this pass are not forwarded.
  let condensed = false;
  if (countChars(body) > budget.cap) {
    onStage('condensing');
    const c = condensePrompts(language, body, budget);
    const second = await ask({ key, baseUrl, signal, fetchImpl, body: { model, max_tokens: 16000, thinking, system: c.system, messages: [{ role: 'user', content: c.user }] } });
    const shorter = second.text.trim();
    if (shorter) { body = shorter; message = second; condensed = true; usage.input += second.usage.input; usage.output += second.usage.output; }
  }
  body = sanitizeTimestamps(body, transcript.durationMs);
  const chars = countChars(body);
  const ratio = transcript.spokenChars ? Number(((100 * chars) / transcript.spokenChars).toFixed(1)) : 0;
  const truncated = message.stopReason === 'max_tokens';
  const meta = { model: message.model || model, language, cues: transcript.cues, spokenChars: transcript.spokenChars, chars, ratio, cap: budget.cap, condensed, truncated, usage, seconds: Math.round((Date.now() - t0) / 1000), generatedAt: new Date().toISOString() };
  // the same header and footer the Mac writes, so a summary file reads the same whichever device made it
  const header = `<!-- recording: ${name} · model: ${meta.model} · generated: ${meta.generatedAt} · input ${usage.input || '?'} tokens · output ${usage.output || '?'} tokens · length ${chars} chars = ${ratio.toFixed(1)}% of the spoken text (cap ${budget.cap}) -->\n\n`;
  const footer = truncated ? '\n\n> ⚠️ 输出在长度上限处被截断，最后部分可能不完整。\n' : '';
  return { markdown: header + body + footer, meta };
}

module.exports = { summarise, cleanCues, ask, SummaryError, DEFAULT_MODEL };
