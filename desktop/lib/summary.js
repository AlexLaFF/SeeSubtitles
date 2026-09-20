'use strict';
// AI learning summaries of recordings (manual trigger). Builds a timestamped transcript from the
// recording's SRT files, asks a model for a complete, first-principles-ordered summary, and writes
// <base>.summary.md next to the recording.
// The model runs on Tencent TokenHub (DeepSeek / Kimi / MiniMax) through its Anthropic-compatible endpoint, with
// the key the server hands to logged-in desktops — reachable from mainland China without a VPN.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Anthropic } = require('@anthropic-ai/sdk');
const { renderPdf } = require('./pdf');
const names = require('@subs/core/names');
// The prompt, the length budget and the clean-up are shared with the server, which summarises for the iOS app.
const { clock, transcriptFromCues, lengthBudget, countChars, systemPrompt, userPrompt, condensePrompts, thinkingFor, sanitizeTimestamps } = require('@subs/core/summary');

function parseSrt(text) {
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) continue;
    const ti = /-->/.test(lines[1]) ? 1 : 0;
    const m = /(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/.exec(lines[ti]);
    if (!m) continue;
    const t = (h, mi, s, ms) => ((+h * 60 + +mi) * 60 + +s) * 1000 + +ms;
    out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: lines.slice(ti + 1).join(' ') });
  }
  return out;
}

/** Timestamped transcript text from a recording's two SRT sidecars, whatever languages they hold. */
function buildTranscript(dir, base) {
  const read = (f) => (fs.existsSync(f) ? parseSrt(fs.readFileSync(f, 'utf8')) : []);
  const { source, target } = names.languagesOf(dir, base);
  const zh = read(names.srtPath(dir, base, target));
  const yue = source === target ? [] : read(names.srtPath(dir, base, source));
  return transcriptFromCues(zh, yue);
}

class SummaryQueue extends EventEmitter {
  constructor({ dir, apiKey, baseURL = 'https://tokenhub.tencentmaas.com', headers = null, model = 'deepseek-v4-flash', language = 'zh', effort = 'high', pdfUrlFor = null, pdfRenderer = renderPdf } = {}) {
    super();
    this.dir = dir;
    this.pdfRenderer = pdfRenderer;
    this.pdfUrlFor = pdfUrlFor; // (base) => URL of the printable summary page; enables PDF output
    this.apiKey = apiKey;
    this.headers = headers; // e.g. the account's bearer token when the server proxies the key
    this.baseURL = baseURL;
    this.model = model;
    this.language = language;
    this.effort = effort;
    this.queue = [];
    this.current = null;
    this.done = [];
  }

  get configured() { return !!this.apiKey; }

  /** These models think before answering; the effort setting sets the thinking budget. */
  requestParams() { return { thinking: thinkingFor(this.effort) }; }

  add(base) {
    if (!base || this.queue.includes(base) || (this.current && this.current.base === base)) return false;
    this.queue.push(base);
    this.emit('status');
    this._next();
    return true;
  }

  status() {
    return { configured: this.configured, model: this.model, language: this.language, current: this.current, queue: [...this.queue], done: this.done.slice(-5) };
  }

  async _next() {
    if (this.current || !this.queue.length) return;
    const base = this.queue.shift();
    this.current = { base, stage: 'preparing', chars: 0, startedAt: Date.now() };
    this.emit('status');
    try {
      const r = await this._run(base);
      this.done.push({ base, ok: true, ...r, at: Date.now() });
      this.emit('done', r);
    } catch (err) {
      this.done.push({ base, ok: false, error: err.message, at: Date.now() });
      this.emit('error', { base, error: err.message });
    }
    this.current = null;
    this.emit('status');
    this._next();
  }

  _set(stage, chars) {
    if (!this.current) return;
    this.current.stage = stage;
    if (chars != null) this.current.chars = chars;
    this.emit('status');
  }

  async _run(base) {
    if (!this.configured) { const e = new Error('Log in under Settings so the app receives its summary key'); e.code = 'summary_login'; throw e; }
    const t0 = Date.now();
    const transcript = buildTranscript(this.dir, base);
    const budget = lengthBudget(transcript.spokenChars);
    this.emit('log', `${base}: transcript ${transcript.cues} cues, ${transcript.spokenChars} spoken chars, ${clock(transcript.durationMs)} long → summary target ${budget.target} chars, cap ${budget.cap}`);
    const client = new Anthropic({ apiKey: this.apiKey || undefined, baseURL: this.baseURL || undefined, ...(this.headers ? { defaultHeaders: this.headers } : {}), timeout: 30 * 60_000, maxRetries: 2 });
    this._set('asking the model', 0);
    let text = '';
    // Streaming keeps long outputs from hitting HTTP timeouts; server-side fallback re-runs on a
    // policy refusal so a talk is never left without a summary.
    const stream = client.messages.stream({
      model: this.model,
      max_tokens: 64000,
      ...this.requestParams(),
      system: systemPrompt(this.language, budget),
      messages: [{
        role: 'user',
        content: userPrompt(base, transcript, budget),
      }],
    });
    stream.on('text', (delta) => { text += delta; this._set('writing summary', text.length); });
    let message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error(`the model declined: ${(message.stop_details && message.stop_details.explanation) || 'refusal'}`);
    let body = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!body) throw new Error('empty response from the model');
    let usage = { ...(message.usage || {}) };
    // over the cap: one condensing pass (cheap — the transcript is not resent)
    if (countChars(body) > budget.cap) {
      this.emit('log', `${base}: summary is ${countChars(body)} chars, over the cap of ${budget.cap} — condensing`);
      this._set('condensing', body.length);
      const condense = condensePrompts(this.language, body, budget);
      const second = await client.messages.stream({
        model: this.model,
        max_tokens: 16000,
        ...this.requestParams(),
        system: condense.system,
        messages: [{ role: 'user', content: condense.user }],
      }).finalMessage();
      const shorter = second.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (shorter) { body = shorter; message = second; for (const k of ['input_tokens', 'output_tokens']) usage[k] = (usage[k] || 0) + ((second.usage || {})[k] || 0); }
    }
    body = sanitizeTimestamps(body, transcript.durationMs);
    const ratio = transcript.spokenChars ? (100 * countChars(body)) / transcript.spokenChars : 0;
    const truncated = message.stop_reason === 'max_tokens';
    const header = `<!-- recording: ${base} · model: ${message.model || this.model} · generated: ${new Date().toISOString()} · input ${usage.input_tokens || '?'} tokens · output ${usage.output_tokens || '?'} tokens · length ${countChars(body)} chars = ${ratio.toFixed(1)}% of the spoken text (cap ${budget.cap}) -->\n\n`;
    const footer = truncated ? '\n\n> ⚠️ 输出在长度上限处被截断，最后部分可能不完整。\n' : '';
    const file = names.filePath(this.dir, base, 'summary');
    fs.writeFileSync(file, header + body + footer);
    let pdf = null;
    try {
      pdf = await this.makePdf(base);
    } catch (err) {
      this.emit('log', `${base}: PDF failed (${err.message}); the Markdown summary is still available`);
    }
    this.emit('log', `${base}: summary ${countChars(body)} chars = ${ratio.toFixed(1)}% of the spoken text`);
    return { base, file: path.basename(file), pdf, bytes: Buffer.byteLength(body), chars: body.length, ratio: Number(ratio.toFixed(1)), seconds: Math.round((Date.now() - t0) / 1000), truncated, usage: { input: usage.input_tokens, output: usage.output_tokens }, model: message.model || this.model };
  }

  /** Render <base>.summary.pdf from the printable summary page. */
  async makePdf(base) {
    if (!this.pdfUrlFor) throw new Error('PDF rendering not configured');
    if (!fs.existsSync(names.filePath(this.dir, base, 'summary'))) throw new Error('no summary to render');
    this._set('rendering PDF');
    const out = names.filePath(this.dir, base, 'pdf');
    const r = await this.pdfRenderer({ url: this.pdfUrlFor(base), out });
    this.emit('log', `${base}: PDF ready (${(r.bytes / 1e3).toFixed(0)} KB)`);
    return path.basename(out);
  }
}

module.exports = { SummaryQueue, buildTranscript, parseSrt, systemPrompt, sanitizeTimestamps, lengthBudget, countChars };
