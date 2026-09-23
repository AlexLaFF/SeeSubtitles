'use strict';
// The language matrix is the one thing here that cannot be reasoned out from the code: it is what the live
// 实时语音翻译 endpoint answered when every pair was opened against the account (server/probe-languages.js).
// These tests hold the shape of that answer, so a careless edit cannot re-introduce a pair the API refuses.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../schema');

const { LIVE_PAIRS, COMBINED_PAIRS, SPLIT_PAIRS, SPLIT_SOURCES, SPLIT_TARGETS, LANG_NAMES, targetsFor, coerceTarget, byKey } = schema;

test('every source and target of both pipelines has a name, and every name is used', () => {
  const used = new Set(Object.values(schema.PAIRS).flatMap((pairs) => [...Object.keys(pairs), ...Object.values(pairs).flat()]));
  for (const code of used) assert.ok(LANG_NAMES[code], `no name for "${code}"`);
  for (const code of Object.keys(LANG_NAMES)) assert.ok(used.has(code), `"${code}" is named but unreachable`);
});

test('the split pipeline offers the engines that open and the languages hy-mt2 takes', () => {
  // Both lists were checked against the account on 2026-09-16; see docs/LIVE-PIPELINE-MEASUREMENTS.md.
  assert.equal(SPLIT_SOURCES.length, 18, 'seventeen spoken languages, Mandarin twice for the mixed engine');
  assert.equal(SPLIT_TARGETS.length, 36);
  assert.ok(!SPLIT_SOURCES.includes('ru'), '16k_ru is refused, so Russian is a subtitle language only');
  assert.ok(SPLIT_TARGETS.includes('ru') && SPLIT_TARGETS.includes('it'));
  assert.ok(!SPLIT_TARGETS.includes('sv') && !SPLIT_TARGETS.includes('zh-Hant'), 'hy-mt2 refuses these');
  for (const source of SPLIT_SOURCES) {
    assert.ok(targetsFor(source, 'split').includes(source), `${source} cannot be transcribed without translating`);
    assert.ok(targetsFor(source, 'split').includes('zh'), `${source} cannot reach Mandarin`);
  }
});

test('the combined pipeline keeps the pairs the API accepts, Cantonese first', () => {
  assert.deepEqual(Object.keys(LIVE_PAIRS), ['yue', 'zh', 'zh_en', 'en', 'ja', 'ko', 'id', 'th', 'ru']);
  assert.deepEqual(LIVE_PAIRS.yue, ['zh', 'en', 'ja', 'ko', 'yue']);
  assert.deepEqual(LIVE_PAIRS.ru, ['zh', 'en', 'ru']); // Russian reaches only Chinese, English and itself
  assert.deepEqual(LIVE_PAIRS.id, ['zh', 'en', 'id']);
  assert.deepEqual(LIVE_PAIRS.th, ['zh', 'en', 'th']);
  for (const [source, targets] of Object.entries(LIVE_PAIRS)) {
    assert.ok(targets.length, `${source} has no target`);
    assert.equal(new Set(targets).size, targets.length, `${source} lists a target twice`);
  }
});

test('every combined source can be transcribed without translating (source is its own target)', () => {
  for (const source of Object.keys(LIVE_PAIRS)) {
    assert.ok(targetsFor(source, 'combined').includes(source), `${source} cannot be its own target`);
  }
});

test('the defaults are a pair the API accepts', () => {
  const d = schema.defaults();
  assert.equal(d.source, 'yue');
  assert.equal(d.target, 'zh');
  assert.equal(coerceTarget(d.source, d.target), 'zh');
  assert.equal(d.pipeline, 'split', 'the app opens on the split pipeline');
  assert.equal(d.transModel, 'hy-mt2-pro');
  assert.equal(d.vadSilenceTime, 700);
  assert.equal(d.maxSpeakTime, 6);
});

test('coerceTarget keeps a valid pair and repairs an impossible one, per pipeline', () => {
  assert.equal(coerceTarget('yue', 'ja', 'combined'), 'ja');
  assert.equal(coerceTarget('ru', 'ja', 'combined'), 'zh'); // ru → ja is refused with 6001; fall back to the first
  assert.equal(coerceTarget('th', 'ko', 'combined'), 'zh');
  assert.equal(coerceTarget('zh_en', 'zh_en', 'combined'), 'zh_en');
  assert.equal(coerceTarget('nonsense', 'zh', 'combined'), 'zh'); // unknown source behaves like the default one
  assert.equal(coerceTarget('yue', 'th', 'split'), 'th', 'the split pipeline reaches Thai from Cantonese');
  assert.equal(coerceTarget('de', 'sv', 'split'), 'zh', 'Swedish is not a language hy-mt2 has');
  assert.equal(schema.coerceSource('ru', 'split'), 'yue', 'Russian cannot be spoken on the split pipeline');
  assert.equal(schema.coerceSource('ru', 'combined'), 'ru');
  assert.equal(schema.coerceModel('split', 'hunyuan-translation'), 'hy-mt2-pro', 'each pipeline keeps its own models');
  assert.equal(schema.coerceModel('combined', 'hy-mt2-pro'), 'hunyuan-translation');
});

test('the subtitle-language field narrows itself to the chosen spoken language', () => {
  const target = byKey.target;
  assert.equal(typeof target.optionsFor, 'function');
  assert.deepEqual(target.optionsFor({ source: 'ru', pipeline: 'combined' }), ['zh', 'en', 'ru']);
  assert.equal(target.optionsFor({ source: 'de', pipeline: 'split' }).length, 36, 'the split pipeline offers them all');
  // every option the field can ever show is a language the matrix knows
  for (const [code] of target.options) assert.ok(LANG_NAMES[code], `target option "${code}" has no name`);
  for (const [code] of byKey.source.options) assert.ok(Object.values(schema.PAIRS).some((pairs) => pairs[code]), `source option "${code}" has no pairs`);
});

test('sanitize still refuses a language that is not in the matrix at all', () => {
  assert.deepEqual(schema.sanitize({ source: 'kl' }), {});
  assert.deepEqual(schema.sanitize({ source: 'th' }), { source: 'th' });
  assert.deepEqual(schema.sanitize({ pipeline: 'nonsense' }), {});
  assert.deepEqual(schema.sanitize({ pipeline: 'combined' }), { pipeline: 'combined' });
});

 test('multilingual mode survives settings validation and offers automatic source detection', () => {
  assert.deepEqual(schema.sanitize({ pipeline: 'mixed', source: 'auto', target: 'en' }), { pipeline: 'mixed', source: 'auto', target: 'en' });
  assert.equal(schema.coerceSource('yue', 'mixed'), 'auto');
  assert.equal(schema.coerceModel('hunyuan-translation', 'mixed'), 'hy-mt2-pro');
  assert.deepEqual(byKey.source.optionsFor({ pipeline: 'mixed' }), ['auto']);
 });
