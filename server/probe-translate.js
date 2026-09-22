#!/usr/bin/env node
'use strict';
// Translate one transcript several ways and lay the translations side by side, line for line, so that the choice
// of translator for uploaded files is read, not guessed. Files are translated whole here — the model sees the
// transcript in windows of many lines with the previous window as context — because nothing is waiting: a name
// or a form of address settled at minute three can stay settled at minute fifty.
//
//   node server/probe-translate.js transcript.jsonl --source ja --target en --out run1
//   node server/probe-translate.js transcript.srt --source ja --target en --arms today,deepseek --out run1
//
// The transcript is an SRT or a probe-file.js .jsonl ({startMs, endMs, text} a line). Arms:
//   today        hy-mt2-pro as the server translates uploads now: eight lines a request, no context     TOKENHUB_API_KEY
//   context      hy-mt2-pro one line at a time with the two previous lines as `context` (the live way)  TOKENHUB_API_KEY
//   deepseek     deepseek-v4-flash, whole windows, on TokenHub's Anthropic-shaped endpoint               TOKENHUB_API_KEY
//   qwen         qwen3.5-plus, whole windows, on 百炼's OpenAI-shaped endpoint                            DASHSCOPE_API_KEY
//   qwen-mt      qwen-mt-plus, 百炼's translation model, a window a request                               DASHSCOPE_API_KEY
// A window that comes back with the wrong number of lines is translated again line by line, so every column is
// aligned with the original; the summary counts how often that happened. Cost: a 100-minute film is ~15k tokens.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { loadEnv } = require('@subs/core');
const PlainText = require('../core/plain-text');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WINDOW = 120; // lines a request
const CARRY = 30;   // previous lines shown as context
const NAMES = { ja: 'Japanese', en: 'English', zh: 'Simplified Chinese', yue: 'Cantonese', ko: 'Korean' };
const TOKENHUB = process.env.TOKENHUB_BASE_URL || 'https://tokenhub.tencentmaas.com';
const DASHSCOPE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

// --------------------------------------------------------------------------- transport

async function post(url, headers, body, what, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
      const text = await res.text();
      if (res.status === 429 && i < tries) { await sleep(5000 * i); continue; }
      if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 200)}`);
      return JSON.parse(text);
    } catch (err) {
      if (i >= tries || /HTTP 4\d\d/.test(err.message)) throw err;
      await sleep(3000 * i);
    }
  }
}

/** hy-mt2 on TokenHub: one text in, its translation out. */
async function hyTranslate(key, { model = 'hy-mt2-pro', text, source, target, context }) {
  const r = await post(`${TOKENHUB}/v1/api/translations`, { authorization: `Bearer ${key}` }, { model, text, source, target, ...(context ? { context } : {}), stream: false }, model);
  return String((r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '').trim();
}
/** A chat model on TokenHub's Anthropic-shaped endpoint. */
async function tokenhubChat(key, model, system, user) {
  const r = await post(`${TOKENHUB}/v1/messages`, { authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }], stream: false }, model);
  return (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}
/** A chat model on 百炼's OpenAI-shaped endpoint; qwen-mt takes its languages in translation_options instead of a prompt. */
async function dashscopeChat(key, model, system, user, extra = {}) {
  const messages = system ? [{ role: 'system', content: system }, { role: 'user', content: user }] : [{ role: 'user', content: user }];
  const r = await post(`${DASHSCOPE}/chat/completions`, { authorization: `Bearer ${key}` }, { model, messages, ...extra }, model);
  return String((r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || '').trim();
}

// --------------------------------------------------------------------------- whole-file translation

function prompt(source, target) {
  return `You translate the subtitles of a ${NAMES[source] || source} video into natural, fluent ${NAMES[target] || target}.
You receive numbered subtitle lines in order. Reply with exactly the same numbers, one translated line each, in the form "N. text", and nothing else.
Never merge, split, skip or reorder lines. Keep names, terms and forms of address consistent throughout; keep each speaker's tone and register; translate interjections and fragments the way a native subtitler would, not literally.
Lines under "Earlier lines" are context already translated: do not translate them again.`;
}
const numbered = (lines, from = 1) => lines.map((t, i) => `${from + i}. ${t}`).join('\n');
function parseNumbered(text, from, count) {
  const out = new Array(count).fill(null);
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)[.)、:：]\s*(.*)$/.exec(line);
    if (!m) continue;
    const i = Number(m[1]) - from;
    if (i >= 0 && i < count && out[i] === null) out[i] = m[2].trim();
  }
  return out.every((x) => x !== null) ? out : null;
}

/** Translate all lines through `chat(system, user)` in windows; falls back to one line a request where a window misaligns. */
async function whole(lines, source, target, chat, log) {
  const out = [];
  let fallbacks = 0;
  for (let at = 0; at < lines.length; at += WINDOW) {
    const chunk = lines.slice(at, at + WINDOW);
    const carryFrom = Math.max(0, at - CARRY);
    const earlier = at ? `Earlier lines (context, already translated):\n${lines.slice(carryFrom, at).map((t, i) => `${carryFrom + i + 1}. ${t} → ${out[carryFrom + i]}`).join('\n')}\n\n` : '';
    const user = `${earlier}Translate these lines:\n${numbered(chunk, at + 1)}`;
    let got = null;
    try { got = parseNumbered(await chat(prompt(source, target), user), at + 1, chunk.length); } catch (err) { log(`window at ${at + 1}: ${err.message}`); }
    if (!got) {
      fallbacks++;
      got = [];
      for (const t of chunk) { try { got.push((await chat(prompt(source, target), `Translate this one line, reply with the translation only:\n${t}`)).replace(/^\s*1[.)]\s*/, '')); } catch (err) { got.push(''); log(`line: ${err.message}`); } }
    }
    out.push(...got);
    log(`${Math.min(at + WINDOW, lines.length)}/${lines.length}`);
  }
  return { out, fallbacks };
}

// --------------------------------------------------------------------------- the arms

function arms(keys, source, target) {
  const th = keys.tokenhub; const ds = keys.dashscope;
  return {
    today: { id: 'hy-mt2-pro (today: 8 lines, no context)', key: th, run: async (lines, log) => {
      const out = []; let fallbacks = 0;
      for (let at = 0; at < lines.length; at += 8) {
        const chunk = lines.slice(at, at + 8);
        const got = (await hyTranslate(th, { text: chunk.join('\n'), source, target })).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (got.length === chunk.length) out.push(...got);
        else { fallbacks++; for (const t of chunk) out.push(await hyTranslate(th, { text: t, source, target })); }
        if (at % 120 === 0) log(`${Math.min(at + 8, lines.length)}/${lines.length}`);
      }
      return { out, fallbacks };
    } },
    context: { id: 'hy-mt2-pro + 2 lines context', key: th, run: async (lines, log) => {
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        out.push(await hyTranslate(th, { text: lines[i], source, target, context: lines.slice(Math.max(0, i - 2), i).join('\n') || undefined }));
        if (i % 120 === 0) log(`${i + 1}/${lines.length}`);
      }
      return { out, fallbacks: 0 };
    } },
    deepseek: { id: 'deepseek-v4-flash, whole', key: th, run: (lines, log) => whole(lines, source, target, (s, u) => tokenhubChat(th, 'deepseek-v4-flash', s, u), log) },
    // qwen3.5-plus thinks before answering unless told not to — a minute a line, and the thinking is not the translation
    qwen: { id: 'qwen3.5-plus, whole', key: ds, run: (lines, log) => whole(lines, source, target, (s, u) => dashscopeChat(ds, 'qwen3.5-plus', s, u, { enable_thinking: false }), log) },
    'qwen-mt': { id: 'qwen-mt-plus, windows', key: ds, run: (lines, log) => whole(lines, source, target,
      (_s, u) => dashscopeChat(ds, 'qwen-mt-plus', null, u, { translation_options: { source_lang: source, target_lang: target } }), log) },
  };
}

// --------------------------------------------------------------------------- input and report

const toMs = (s) => { const m = /(\d+):(\d{2}):(\d{2})[,.](\d{3})/.exec(s); return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] : 0; };
function readLines(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => ({ startMs: r.startMs, text: PlainText.clean(r.text) })).filter((r) => r.text);
  const rows = [];
  for (const block of raw.replace(/^﻿/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n'); const at = lines.findIndex((l) => /-->/.test(l));
    if (at >= 0) rows.push({ startMs: toMs(lines[at]), text: PlainText.clean(lines.slice(at + 1).join(' ')) });
  }
  return rows.filter((r) => r.text);
}
const stamp = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

async function main() {
  loadEnv();
  const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!file) throw new Error('usage: probe-translate.js transcript.(jsonl|srt) --source ja --target en --out dir [--arms today,context,deepseek,qwen,qwen-mt]');
  const source = flag('source', 'ja'); const target = flag('target', 'en'); const out = flag('out', 'probe-translate-out');
  const keys = { tokenhub: (process.env.TOKENHUB_API_KEY || '').trim(), dashscope: (process.env.DASHSCOPE_API_KEY || '').trim() };
  const ARMS = arms(keys, source, target);
  const wanted = flag('arms', null) ? flag('arms').split(',').map((s) => s.trim()) : Object.keys(ARMS).filter((k) => ARMS[k].key);
  for (const w of wanted) { if (!ARMS[w]) throw new Error(`unknown arm ${w}`); if (!ARMS[w].key) throw new Error(`${w} needs ${w === 'qwen' || w === 'qwen-mt' ? 'DASHSCOPE_API_KEY' : 'TOKENHUB_API_KEY'}`); }
  if (!wanted.length) throw new Error('no key: TOKENHUB_API_KEY or DASHSCOPE_API_KEY');
  const rows = readLines(file);
  const lines = rows.map((r) => r.text);
  console.log(`# ${path.basename(file)} — ${lines.length} lines, ${source}→${target}, arms: ${wanted.join(', ')}`);
  fs.mkdirSync(out, { recursive: true });

  const results = await Promise.all(wanted.map(async (w) => {
    const t0 = Date.now(); const log = (m) => console.log(`  ${w.padEnd(9)} ${m}`);
    try { const r = await ARMS[w].run(lines, log); return { w, ...r, ms: Date.now() - t0 }; }
    catch (err) { log(`✖ ${err.message}`); return { w, out: [], fallbacks: 0, ms: null, error: err.message }; }
  }));
  for (const r of results) fs.writeFileSync(path.join(out, `${r.w}.txt`), r.out.join('\n') + '\n');
  const cols = results.filter((r) => !r.error);
  const table = [`| time | ${source} | ${cols.map((r) => ARMS[r.w].id).join(' | ')} |`, `|---|---|${cols.map(() => '---').join('|')}|`];
  rows.forEach((r, i) => table.push(`| ${stamp(r.startMs)} | ${r.text.replace(/\|/g, '｜')} | ${cols.map((c) => String(c.out[i] || '').replace(/\|/g, '｜')).join(' | ')} |`));
  fs.writeFileSync(path.join(out, 'side-by-side.md'), `# ${path.basename(file)}, ${lines.length} lines\n\n${table.join('\n')}\n`);
  const summary = { file: path.basename(file), lines: lines.length, source, target, at: new Date().toISOString(),
    arms: results.map((r) => ({ id: ARMS[r.w].id, characters: r.out.reduce((n, t) => n + String(t || '').length, 0), empty: r.out.filter((t) => !t).length, fallbacks: r.fallbacks, tookSeconds: r.ms == null ? null : Math.round(r.ms / 1000), error: r.error || null })) };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('\n# summary');
  for (const s of summary.arms) console.log(`  ${s.id.padEnd(40)} ${String(s.characters).padStart(6)} chars  ${s.empty} empty  ${s.fallbacks} windows redone line by line${s.tookSeconds != null ? `  took ${s.tookSeconds} s` : ''}${s.error ? `  ✖ ${s.error}` : ''}`);
  console.log(`\n# written to ${out}/ — read side-by-side.md`);
}

main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
