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

test('TokenHub provider sends a thinking budget instead of Claude effort, and needs no Anthropic key', () => {
  const { SummaryQueue, sanitizeTimestamps } = require('../lib/summary');
  const q = new SummaryQueue({ dir: '/tmp', provider: 'seesubtitles', apiKey: 'k', baseURL: 'https://tokenhub.tencentmaas.com', model: 'deepseek-v4-flash', effort: 'high' });
  assert.equal(q.configured, true);
  assert.deepEqual(q.requestParams(), { thinking: { type: 'enabled', budget_tokens: 16000 } });
  q.effort = 'low';
  assert.deepEqual(q.requestParams(), { thinking: { type: 'disabled' } });
  const c = new SummaryQueue({ dir: '/tmp', provider: 'anthropic', apiKey: '', model: 'claude-opus-5', effort: 'medium' });
  assert.equal(c.configured, !!process.env.ANTHROPIC_AUTH_TOKEN);
  assert.deepEqual(c.requestParams().output_config, { effort: 'medium' });
  assert.deepEqual(new SummaryQueue({ dir: '/tmp', provider: 'seesubtitles', apiKey: '' }).status().configured, false);
  // timestamps past the end of the recording are removed, the rest stay
  assert.equal(sanitizeTimestamps('见 [12:30] 和 [1:05:00]，还有 [59:59] 处。', 3600_000), '见 [12:30] 和 ，还有 [59:59] 处。');
  assert.equal(sanitizeTimestamps('[00:10] ok', 0), '[00:10] ok');
});
