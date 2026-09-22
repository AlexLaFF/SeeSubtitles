'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildTranscript, parseSrt, systemPrompt } = require('../lib/summary');

test('parseSrt reads cues', () => {
  const cues = parseSrt('1\n00:00:01,000 --> 00:00:03,500\n你好\n\n2\n00:01:00,000 --> 00:01:02,000\n第二句\n');
  assert.deepEqual(cues, [{ start: 1000, end: 3500, text: '你好' }, { start: 60000, end: 62000, text: '第二句' }]);
});

test('buildTranscript merges zh and yue with timestamps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sum-'));
  fs.writeFileSync(path.join(dir, 'r.zh.srt'), '1\n00:00:01,000 --> 00:00:03,500\n大家好\n\n2\n01:01:00,000 --> 01:01:02,000\n谢谢\n');
  fs.writeFileSync(path.join(dir, 'r.yue.srt'), '1\n00:00:01,000 --> 00:00:03,500\n大家好呀\n\n2\n01:01:00,000 --> 01:01:02,000\n谢谢\n');
  const t = buildTranscript(dir, 'r');
  assert.equal(t.cues, 2);
  assert.equal(t.durationMs, 3662000);
  assert.equal(t.text, '[00:01] 大家好\n    （原文：大家好呀）\n[1:01:00] 谢谢');
  assert.throws(() => buildTranscript(dir, 'missing'), /no subtitle cues/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('system prompt asks for a synthesized, logically ordered, skimmable digest', () => {
  const p = systemPrompt('zh');
  for (const must of ['综合而不是罗列', '逻辑顺序而不是演讲顺序', '不能丢', '简体中文', '时间戳', '一条要点只陈述一个判断', '## 一段话']) assert.ok(p.includes(must), must);
  assert.ok(!p.includes('要点索引'), 'no chronological index');
});

test('the summary is asked of the server with the recording\'s cues, the chosen model and effort, and written next to the recording', async () => {
  const { SummaryQueue, sanitizeTimestamps } = require('../lib/summary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sum-q-'));
  fs.writeFileSync(path.join(dir, 'r.zh.srt'), '1\n00:00:01,000 --> 00:00:03,500\n大家好\n\n2\n01:01:00,000 --> 01:01:02,000\n谢谢\n');
  fs.writeFileSync(path.join(dir, 'r.yue.srt'), '1\n00:00:01,000 --> 00:00:03,500\n大家好呀\n');
  const asked = [];
  const summarise = async (req, { onStage, onDelta }) => {
    asked.push(req);
    onStage('asking'); onStage('writing'); onDelta('# 《总结》\n'); onDelta('要点。');
    return { markdown: '<!-- recording: r · model: stand-in -->\n\n# 《总结》\n要点。', meta: { model: 'stand-in', chars: 7, ratio: 50, usage: { input: 10, output: 5 }, truncated: false } };
  };
  let loggedIn = false;
  const q = new SummaryQueue({ dir, summarise, loggedIn: () => loggedIn, model: 'kimi-k3', effort: 'low', language: 'zh', pdfUrlFor: null });
  assert.equal(q.configured, false, 'no account, no summaries');
  loggedIn = true;
  assert.equal(q.configured, true);
  const stages = [];
  q.on('status', () => { if (q.current) stages.push(q.current.stage); });
  const done = await new Promise((resolve, reject) => { q.on('done', resolve); q.on('error', (e) => reject(new Error(e.error))); q.add('r'); });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].name, 'r');
  assert.equal(asked[0].model, 'kimi-k3');
  assert.equal(asked[0].effort, 'low');
  assert.equal(asked[0].language, 'zh');
  assert.deepEqual(asked[0].target.map((c) => c.text), ['大家好', '谢谢']);
  assert.deepEqual(asked[0].source.map((c) => c.text), ['大家好呀']);
  assert.ok(stages.includes('asking') && stages.includes('writing'), stages.join(','));
  const names = require('@subs/core/names');
  assert.equal(fs.readFileSync(names.filePath(dir, 'r', 'summary'), 'utf8'), '<!-- recording: r · model: stand-in -->\n\n# 《总结》\n要点。');
  assert.equal(done.file, path.basename(names.filePath(dir, 'r', 'summary')));
  assert.equal(done.model, 'stand-in');
  assert.deepEqual(done.usage, { input: 10, output: 5 });
  assert.equal(done.pdf, null, 'no PDF renderer configured: the Markdown alone');
  // the server's refusal reaches the queue as the error it named
  const refusing = new SummaryQueue({ dir, summarise: async () => { const e = new Error('AI summaries are not in this plan'); e.code = 'plan_summaries'; throw e; }, loggedIn: () => true });
  const failed = await new Promise((resolve) => { refusing.on('error', resolve); refusing.add('r'); });
  assert.match(failed.error, /not in this plan/);
  fs.rmSync(dir, { recursive: true, force: true });
  // timestamps past the end of the recording are removed, the rest stay
  assert.equal(sanitizeTimestamps('见 [12:30] 和 [1:05:00]，还有 [59:59] 处。', 3600_000), '见 [12:30] 和 ，还有 [59:59] 处。');
  assert.equal(sanitizeTimestamps('[00:10] ok', 0), '[00:10] ok');
});
