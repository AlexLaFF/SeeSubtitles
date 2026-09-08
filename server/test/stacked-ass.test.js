'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toStackedAss } = require('../lib/subtitles');

function sample(n = 40) {
  const cues = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const len = 8 + (i * 7) % 30;
    cues.push({ start: t, end: t + 3000, text: '粤语原文'.repeat(8).slice(0, len), trans: `第${i}句普通话翻译内容示例文字`.repeat(3).slice(0, len) }); // ms, like buildCues
    t += 3500;
  }
  return cues;
}

test('stacked ASS fills the frame from the bottom, newest bright, older dimmed, fading at the top', () => {
  const ass = toStackedAss(sample(), { which: 'trans', width: 1080, height: 1920 });
  assert.match(ass, /PlayResX: 1080/);
  const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.ok(events.length > 300, `events ${events.length}`);
  // group by segment start time and inspect one segment deep into the talk
  const bySeg = new Map();
  for (const e of events) { const k = `${e.split(',')[1]}-${e.split(',')[2]}`; (bySeg.get(k) || bySeg.set(k, []).get(k)).push(e); }
  const segs = [...bySeg.entries()];
  // a segment deep into the talk during which a sentence is being spoken (not a gap between sentences)
  const [, seg] = segs.slice(Math.floor(segs.length * 0.6)).find(([, s]) => /alpha&H00&/.test(s[0]) && s.length >= 5);
  assert.ok(seg.length >= 5, `stack depth ${seg.length}`);
  const ys = seg.map((e) => Number(/pos\(\d+,(\d+)\)/.exec(e)[1]));
  assert.equal(ys[0], 1920 - Math.round(1920 * 0.08), 'newest block sits on the bottom padding');
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] < ys[i - 1], 'blocks stack upward');
  assert.ok(ys[ys.length - 1] >= 0 && ys[ys.length - 1] < 1920 * 0.35, 'stack reaches the upper part of the frame');
  assert.match(seg[0], /alpha&H00&/, 'newest is bright');
  assert.match(seg[1], /alpha&H73&/, 'earlier ones are dimmed');
  assert.match(seg[seg.length - 1], /alpha&HB0&/, 'top-most is dissolving');
  assert.ok(!/mov_text/.test(ass));
});

test('bilingual mode adds the original under the translation at a smaller size', () => {
  const ass = toStackedAss(sample(5), { which: 'both' });
  assert.match(ass, /\\N\{\\fs\d+\\alpha&H/);
});
