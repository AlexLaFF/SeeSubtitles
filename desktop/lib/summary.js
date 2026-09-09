'use strict';
// AI learning summaries of recordings (manual trigger). Builds a timestamped transcript from the
// recording's SRT files, asks a model for a complete, first-principles-ordered summary, and writes
// <base>.summary.md next to the recording.
// Providers: 'seesubtitles' = DeepSeek / Kimi / MiniMax through Tencent TokenHub's Anthropic-compatible
// endpoint (key handed out by the server, reachable without a VPN); 'anthropic' = Claude with the user's key.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Anthropic } = require('@anthropic-ai/sdk');
const { renderPdf } = require('./pdf');
const names = require('@subs/core/names');

const LANG_NAMES = { zh: '简体中文', 'zh-TW': '繁體中文', en: 'English', yue: '粤语书面语' };

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

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** Timestamped transcript text from the zh/yue SRT files of a recording. */
function buildTranscript(dir, base) {
  const read = (f) => (fs.existsSync(f) ? parseSrt(fs.readFileSync(f, 'utf8')) : []);
  const zh = read(names.filePath(dir, base, 'zh'));
  const yue = read(names.filePath(dir, base, 'yue'));
  const cues = zh.length ? zh : yue;
  if (!cues.length) throw new Error('no subtitle cues found for this recording');
  const lines = cues.map((c) => {
    const y = zh.length ? yue.find((v) => Math.abs(v.start - c.start) < 50) : null;
    return `[${clock(c.start)}] ${c.text}${y && y.text && y.text !== c.text ? `\n    （原文：${y.text}）` : ''}`;
  });
  return { text: lines.join('\n'), cues: cues.length, durationMs: cues[cues.length - 1].end, chars: lines.join('\n').length };
}

function systemPrompt(language) {
  const lang = LANG_NAMES[language] || language;
  return `你是一位擅长提炼与综合的知识编辑。你将收到一场演讲的完整逐字稿：演讲者说粤语，逐字稿是机器实时识别并翻译成普通话的结果（括号内“原文”为粤语识别文本，可用于消除歧义），每行以 [分:秒] 时间戳开头。识别与翻译可能有错字、断句错误或漏字，请结合上下文推断本意；无法确定时用（?）标注，绝不要编造。

目标：写一份一眼能抓住全貌、几分钟读完的学习摘要，用${lang}输出，Markdown 格式。它不是讲义、不是笔记、更不是逐字稿的复述，而是把演讲“消化”之后重新讲一遍。

工作方法：
1. 先通读全篇，问自己：这场演讲真正想让听众明白的是什么？哪些是支撑它的核心观点？
2. 综合而不是罗列：把讲同一件事的多处内容合并成一个观点；例子、故事、个人经历只保留它们所证明的那个原理，不保留经历本身。
3. 逻辑顺序而不是演讲顺序：先讲前提和基本原理，再讲由此推出的观点，最后讲做法，让读者顺着读就能理解为什么。
4. 完整性针对“重要的东西”：任何一个重要观点、原理、方法、关键结论都不能丢；重复、寒暄、会务、离题闲聊、细枝末节应当省略或并入上一级观点。

结构与分工（这是控制篇幅的关键，请严格遵守）：
- 一个小节回答一个问题。小节标题（###）就是该小节的一句话结论，解释和因果只写在这里。整篇最多 5 个小节，超过 5 个说明划分太细，请合并。
- 一条要点只陈述一个判断，是一个可以独立成立的句子，不附解释、不附例子、不附“因为/所以/于是”的后半句；不用分号、破折号或括号补充说明。
- 一个小节只保留让它的结论成立所必需的判断，通常 2–3 条。凡是删掉之后小节结论仍然成立的，就是细节，删掉或并入上一条。
- 分级、分类、清单、定义这类内容压成一条要点，只给结构与关键阈值，不逐项展开。
- 数字只在它本身是结论时保留（阈值、比例、关键年龄），不罗列示例性的数字和换算。
- 每条要点末尾附一个出处时间戳，如 [12:34]（一条只附一个）。
- 把每条要点最关键的短语用 **加粗**，让人只看粗体也能扫完全文。不用套话，不写“演讲者提到/认为”。

输出结构（只用这几个标题，按需省略空节）：
# 《推断出的演讲主题》
## 一段话  ← 两三句话说清这场演讲的核心主张，不用列表；不要在这里预先复述下面各节的要点
## 要点  ← 最多 5 个小节，每节 2–3 条要点；小节之间按“前提 → 观点 → 做法”排列
## 行动建议  ← 只列演讲者明确要求听众去做、且没有在要点里出现过的做法，一条一个动作，不写理由；通常 3–5 条，没有就省略
## 值得记住的话  ← 最多 2 句演讲中最有分量的话的原意转述；没有就省略

输出前在心里逐段对照逐字稿，确认重要观点无遗漏、无重复、无编造，但不要输出核对过程；只输出 Markdown 正文，不要前言或说明。`;
}

class SummaryQueue extends EventEmitter {
  constructor({ dir, provider = 'anthropic', apiKey, baseURL, model = 'claude-opus-5', language = 'zh', effort = 'high', pdfUrlFor = null, pdfRenderer = renderPdf } = {}) {
    super();
    this.dir = dir;
    this.pdfRenderer = pdfRenderer;
    this.pdfUrlFor = pdfUrlFor; // (base) => URL of the printable summary page; enables PDF output
    this.provider = provider;
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
    this.language = language;
    this.effort = effort;
    this.queue = [];
    this.current = null;
    this.done = [];
  }

  get configured() { return !!(this.apiKey || (this.provider === 'anthropic' && process.env.ANTHROPIC_AUTH_TOKEN)); }

  /** Request parameters per provider. TokenHub models think before answering: the budget replaces Claude's effort. */
  requestParams() {
    if (this.provider === 'seesubtitles') {
      const budget = { low: 0, medium: 6000, high: 16000 }[this.effort] ?? 16000;
      return { thinking: budget ? { type: 'enabled', budget_tokens: budget } : { type: 'disabled' } };
    }
    return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: this.effort } };
  }

  add(base) {
    if (!base || this.queue.includes(base) || (this.current && this.current.base === base)) return false;
    this.queue.push(base);
    this.emit('status');
    this._next();
    return true;
  }

  status() {
    return { configured: this.configured, provider: this.provider, model: this.model, language: this.language, current: this.current, queue: [...this.queue], done: this.done.slice(-5) };
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
    if (!this.configured) { const e = new Error(this.provider === 'seesubtitles' ? 'Log in under Settings so the app receives its summary key' : 'Add your Anthropic API key in Settings → AI summaries'); e.code = this.provider === 'seesubtitles' ? 'summary_login' : 'summary_key'; throw e; }
    const t0 = Date.now();
    const transcript = buildTranscript(this.dir, base);
    this.emit('log', `${base}: transcript ${transcript.cues} cues, ${transcript.chars} chars, ${clock(transcript.durationMs)} long`);
    const client = new Anthropic({ apiKey: this.apiKey || undefined, baseURL: this.baseURL || undefined, timeout: 30 * 60_000, maxRetries: 2 });
    this._set('asking the model', 0);
    let text = '';
    // Streaming keeps long outputs from hitting HTTP timeouts; server-side fallback re-runs on a
    // policy refusal so a talk is never left without a summary.
    const api = this.provider === 'seesubtitles' ? client.messages : client.beta.messages;
    const stream = api.stream({
      model: this.model,
      max_tokens: 64000,
      ...this.requestParams(),
      system: systemPrompt(this.language),
      messages: [{
        role: 'user',
        content: `录音文件：${base}（时长 ${clock(transcript.durationMs)}，${transcript.cues} 句，逐字稿约 ${transcript.chars} 字）。以下是完整逐字稿：\n\n<transcript>\n${transcript.text}\n</transcript>\n\n请按系统要求输出学习摘要。`,
      }],
    });
    stream.on('text', (delta) => { text += delta; this._set('writing summary', text.length); });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error(`the model declined: ${(message.stop_details && message.stop_details.explanation) || 'refusal'}`);
    let body = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!body) throw new Error('empty response from the model');
    body = sanitizeTimestamps(body, transcript.durationMs);
    const truncated = message.stop_reason === 'max_tokens';
    const usage = message.usage || {};
    const header = `<!-- recording: ${base} · model: ${message.model || this.model} · generated: ${new Date().toISOString()} · input ${usage.input_tokens || '?'} tokens · output ${usage.output_tokens || '?'} tokens -->\n\n`;
    const footer = truncated ? '\n\n> ⚠️ 输出在长度上限处被截断，最后部分可能不完整。\n' : '';
    const file = names.filePath(this.dir, base, 'summary');
    fs.writeFileSync(file, header + body + footer);
    let pdf = null;
    try {
      pdf = await this.makePdf(base);
    } catch (err) {
      this.emit('log', `${base}: PDF failed (${err.message}); the Markdown summary is still available`);
    }
    return { base, file: path.basename(file), pdf, bytes: Buffer.byteLength(body), chars: body.length, seconds: Math.round((Date.now() - t0) / 1000), truncated, usage: { input: usage.input_tokens, output: usage.output_tokens }, model: message.model || this.model };
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

/** Drop bracketed timestamps that lie beyond the recording (models occasionally invent them); keep the text. */
function sanitizeTimestamps(body, durationMs) {
  if (!durationMs) return body;
  const limit = durationMs / 1000 + 5;
  return String(body).replace(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g, (m, a, b, c) => {
    const sec = c != null ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
    return sec <= limit ? m : '';
  }).replace(/[ \t]+\n/g, '\n');
}

module.exports = { SummaryQueue, buildTranscript, parseSrt, systemPrompt, sanitizeTimestamps };
