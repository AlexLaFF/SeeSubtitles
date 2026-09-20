'use strict';
// What a learning summary is asked for, in one place: the prompt, the length budget it is held to, and the
// clean-up of what comes back. The Mac (desktop/lib/summary.js) and the server (server/lib/summaries.js, for
// the iOS app) both summarise through this, so a recording reads the same whichever device made it.
// Pure: no files, no network.

const LANG_NAMES = { zh: '简体中文', en: 'English', yue: '粤语书面语' };

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * The timestamped transcript a model reads, from a recording's cues.
 * @param {{start:number, end:number, text:string}[]} target   the subtitle track (ms)
 * @param {{start:number, end:number, text:string}[]} [source] the spoken-language track; a cue that starts
 *   with a target cue is quoted under it as 原文, so the model can see through a mistranslation
 */
function transcriptFromCues(target, source = []) {
  const main = target.length ? target : source;
  if (!main.length) throw new Error('no subtitle cues found for this recording');
  const lines = main.map((c) => {
    const y = target.length ? source.find((v) => Math.abs(v.start - c.start) < 50) : null;
    return `[${clock(c.start)}] ${c.text}${y && y.text && y.text !== c.text ? `\n    （原文：${y.text}）` : ''}`;
  });
  const text = lines.join('\n');
  const spokenChars = main.reduce((n, c) => n + c.text.replace(/\s+/g, '').length, 0);
  return { text, cues: main.length, durationMs: main[main.length - 1].end, chars: text.length, spokenChars };
}

/** Length budget: a summary is judged against the spoken text — target 5 %, hard cap 8 % (so it stays under a tenth
 *  even with timestamps and markup); never below a floor that still allows a real digest of a short recording. */
function lengthBudget(spokenChars) {
  const target = Math.max(300, Math.round(spokenChars * 0.05));
  const cap = Math.max(450, Math.round(spokenChars * 0.08));
  const sections = Math.max(3, Math.min(5, Math.round(spokenChars / 6000)));
  return { target, cap, sections };
}
/** Characters of a summary that count against the budget: no timestamps, no Markdown syntax, no whitespace. */
const countChars = (md) => String(md).replace(/<!--[\s\S]*?-->/g, '').replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '').replace(/[#*>\-\s]/g, '').length;

function systemPrompt(language, budget = { target: 1200, cap: 1900, sections: 5 }) {
  const lang = LANG_NAMES[language] || language;
  return `你是一位擅长提炼与综合的知识编辑。你将收到一场演讲的完整逐字稿：演讲者说粤语，逐字稿是机器实时识别并翻译成普通话的结果（括号内“原文”为粤语识别文本，可用于消除歧义），每行以 [分:秒] 时间戳开头。识别与翻译可能有错字、断句错误或漏字，请结合上下文推断本意；无法确定时用（?）标注，绝不要编造。

目标：写一份一眼能抓住全貌、几分钟读完的学习摘要，用${lang}输出，Markdown 格式。它不是讲义、不是笔记、更不是逐字稿的复述，而是把演讲“消化”之后重新讲一遍。

篇幅（硬性）：全文正文约 ${budget.target} 字，绝不超过 ${budget.cap} 字（不含时间戳和 Markdown 符号）。这大约是逐字稿的二十分之一：只有真正的结论才放得进来，宁可少而准，不要多而全。

工作方法：
1. 先通读全篇，问自己：这场演讲真正想让听众明白的是什么？哪些是支撑它的核心观点？
2. 综合而不是罗列：把讲同一件事的多处内容合并成一个观点；例子、故事、个人经历只保留它们所证明的那个原理，不保留经历本身。
3. 逻辑顺序而不是演讲顺序：先讲前提和基本原理，再讲由此推出的观点，最后讲做法，让读者顺着读就能理解为什么。
4. 完整性针对“重要的东西”：任何一个重要观点、原理、方法、关键结论都不能丢；重复、寒暄、会务、离题闲聊、细枝末节应当省略或并入上一级观点。

结构与分工（这是控制篇幅的关键，请严格遵守）：
- 一个小节回答一个问题。小节标题（###）就是该小节的一句话结论（不超过 25 字），解释和因果只写在这里。整篇最多 ${budget.sections} 个小节，超过说明划分太细，请合并。
- 一条要点只陈述一个判断，是一个可以独立成立的句子，不超过 35 字，不附解释、不附例子、不附“因为/所以/于是”的后半句；不用分号、破折号或括号补充说明。
- 一个小节只保留让它的结论成立所必需的判断，2–3 条，绝不超过 3 条。凡是删掉之后小节结论仍然成立的，就是细节，删掉或并入上一条。
- 分级、分类、清单、定义这类内容压成一条要点，只给结构与关键阈值，不逐项展开。
- 数字只在它本身是结论时保留（阈值、比例、关键年龄），不罗列示例性的数字和换算。
- 每条要点末尾附一个出处时间戳，如 [12:34]（一条只附一个）。
- 把每条要点最关键的短语用 **加粗**，让人只看粗体也能扫完全文。不用套话，不写“演讲者提到/认为”。

输出结构（只用这几个标题，按需省略空节）：
# 《推断出的演讲主题》
## 一段话  ← 两三句话（不超过 80 字）说清这场演讲的核心主张，不用列表；不要在这里预先复述下面各节的要点
## 要点  ← 最多 5 个小节，每节 2–3 条要点；小节之间按“前提 → 观点 → 做法”排列
## 行动建议  ← 只列演讲者明确要求听众去做、且没有在要点里出现过的做法，一条一个动作（不超过 20 字），不写理由；最多 4 条，没有就省略
## 值得记住的话  ← 最多 2 句演讲中最有分量的话的原意转述，每句不超过 40 字；没有就省略

输出前在心里逐段对照逐字稿，确认重要观点无遗漏、无重复、无编造，但不要输出核对过程；只输出 Markdown 正文，不要前言或说明。`;
}

/** The request that carries the transcript. `name` is the recording's, for the model's orientation only. */
function userPrompt(name, transcript, budget) {
  return `录音文件：${name}（时长 ${clock(transcript.durationMs)}，${transcript.cues} 句，正文约 ${transcript.spokenChars} 字）。以下是完整逐字稿：\n\n<transcript>\n${transcript.text}\n</transcript>\n\n请按系统要求输出学习摘要。两条硬性要求：（1）全文正文约 ${budget.target} 字，绝不超过 ${budget.cap} 字（不含时间戳和 Markdown 符号），超出即不合格；（2）“要点”下的每一条以及“值得记住的话”的每一句，末尾都必须带一个出处时间戳，格式与逐字稿行首完全一致，例如 [12:34]（时间必须来自逐字稿，不得编造）。`;
}

/** The second, cheap pass for a summary that came back over its cap: the transcript is not resent. */
function condensePrompts(language, body, budget) {
  return {
    system: `你是一位严谨的编辑。用${LANG_NAMES[language] || language}输出 Markdown。`,
    user: `把下面这份学习摘要压缩到 ${budget.cap} 字以内（不含时间戳和 Markdown 符号），目标约 ${budget.target} 字。保持原有标题结构和每条要点末尾的时间戳；合并相近的要点，删掉例子、解释和重复，保留全部独立的结论。只输出压缩后的 Markdown。\n\n${body}`,
  };
}

/** These models think before answering; the effort setting sets the thinking budget. */
function thinkingFor(effort) {
  const budget = { low: 0, medium: 6000, high: 16000 }[effort] ?? 16000;
  return budget ? { type: 'enabled', budget_tokens: budget } : { type: 'disabled' };
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

module.exports = { LANG_NAMES, clock, transcriptFromCues, lengthBudget, countChars, systemPrompt, userPrompt, condensePrompts, thinkingFor, sanitizeTimestamps };
