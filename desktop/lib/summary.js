'use strict';
// AI learning summaries of recordings (manual trigger). Reads a recording's SRT sidecars into cues, asks the hosted
// server for the summary (POST /api/summaries, through CloudLink.summarise — the route the iPhone uses, so no model
// key and no prompt live on this Mac), writes <base>.summary.md next to the recording and renders the PDF.
// The prompt, the length budget and the clean-up are core/summary.js on the server; what this Mac chooses is the
// model and the effort (Settings › AI summaries) and the language the summary is written in.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { renderPdf } = require('./pdf');
const { parseSrt } = require('./cues');
const names = require('@subs/core/names');
const { clock, transcriptFromCues, lengthBudget, countChars, systemPrompt, sanitizeTimestamps, DEFAULT_SUMMARY_MODEL } = require('@subs/core/summary');

/** A recording's two SRT sidecars as cues, whatever languages they hold: { target, source } (source empty when the same). */
function readCues(dir, base) {
  const read = (f) => (fs.existsSync(f) ? parseSrt(fs.readFileSync(f, 'utf8')) : []);
  const { source, target } = names.languagesOf(dir, base);
  return { target: read(names.srtPath(dir, base, target)), source: source === target ? [] : read(names.srtPath(dir, base, source)) };
}

/** Timestamped transcript text from a recording's two SRT sidecars — what the server builds for the model. */
function buildTranscript(dir, base) {
  const { target, source } = readCues(dir, base);
  return transcriptFromCues(target, source);
}

class SummaryQueue extends EventEmitter {
  /**
   * @param {object} o
   *   summarise  (req, { onStage, onDelta }) => Promise<{ markdown, meta }>  — CloudLink.summarise
   *   loggedIn   () => boolean — summaries need the account; there is no key on this Mac to use without it
   *   model, effort, language — what Settings chose; the server takes the model and effort when it lists them
   */
  constructor({ dir, summarise = null, loggedIn = () => false, model = DEFAULT_SUMMARY_MODEL, language = 'zh', effort = 'high', pdfUrlFor = null, pdfRenderer = renderPdf } = {}) {
    super();
    this.dir = dir;
    this.summarise = summarise;
    this.loggedIn = loggedIn;
    this.pdfRenderer = pdfRenderer;
    this.pdfUrlFor = pdfUrlFor; // (base) => URL of the printable summary page; enables PDF output
    this.model = model;
    this.language = language;
    this.effort = effort;
    this.queue = [];
    this.current = null;
    this.done = [];
  }

  get configured() { return !!(this.summarise && this.loggedIn()); }

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
    if (!this.configured) { const e = new Error('Log in under Settings: summaries are written by the server for the account'); e.code = 'summary_login'; throw e; }
    const t0 = Date.now();
    const cues = readCues(this.dir, base);
    const transcript = transcriptFromCues(cues.target, cues.source); // throws when there are no cues, before anything is sent
    const budget = lengthBudget(transcript.spokenChars);
    this.emit('log', `${base}: transcript ${transcript.cues} cues, ${transcript.spokenChars} spoken chars, ${clock(transcript.durationMs)} long → summary target ${budget.target} chars, cap ${budget.cap}`);
    this._set('asking', 0);
    let chars = 0;
    // stages as the server names them (asking, thinking, writing, condensing — status.* in web/locales.js); the text
    // streams in so the Files page can show it growing, and the finished Markdown replaces it at the end
    const out = await this.summarise(
      { name: base, language: this.language, model: this.model, effort: this.effort, target: cues.target, source: cues.source },
      { onStage: (stage) => this._set(stage), onDelta: (text) => { chars += text.length; this._set(this.current && this.current.stage, chars); } },
    );
    const file = names.filePath(this.dir, base, 'summary');
    fs.writeFileSync(file, out.markdown);
    let pdf = null;
    try {
      pdf = await this.makePdf(base);
    } catch (err) {
      this.emit('log', `${base}: PDF failed (${err.message}); the Markdown summary is still available`);
    }
    const meta = out.meta || {};
    this.emit('log', `${base}: summary ${meta.chars || countChars(out.markdown)} chars = ${meta.ratio || 0}% of the spoken text`);
    return { base, file: path.basename(file), pdf, bytes: Buffer.byteLength(out.markdown), chars: meta.chars || countChars(out.markdown), ratio: meta.ratio || 0,
      seconds: Math.round((Date.now() - t0) / 1000), truncated: !!meta.truncated, usage: meta.usage || {}, model: meta.model || this.model };
  }

  /** Render <base>.summary.pdf from the printable summary page. */
  async makePdf(base) {
    if (!this.pdfUrlFor) throw new Error('PDF rendering not configured');
    if (!fs.existsSync(names.filePath(this.dir, base, 'summary'))) throw new Error('no summary to render');
    this._set('renderingPdf');
    const out = names.filePath(this.dir, base, 'pdf');
    const r = await this.pdfRenderer({ url: this.pdfUrlFor(base), out });
    this.emit('log', `${base}: PDF ready (${(r.bytes / 1e3).toFixed(0)} KB)`);
    return path.basename(out);
  }
}

module.exports = { SummaryQueue, readCues, buildTranscript, parseSrt, systemPrompt, sanitizeTimestamps };
