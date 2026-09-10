'use strict';
// The language matrix is the one thing here that cannot be reasoned out from the code: it is what the live
// 实时语音翻译 endpoint answered when every pair was opened against the account (server/probe-languages.js).
// These tests hold the shape of that answer, so a careless edit cannot re-introduce a pair the API refuses.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../schema');

const { LIVE_PAIRS, LANG_NAMES, targetsFor, coerceTarget, byKey } = schema;

test('every source and target in the matrix has a name, and every name is used', () => {
  const used = new Set([...Object.keys(LIVE_PAIRS), ...Object.values(LIVE_PAIRS).flat()]);
  for (const code of used) assert.ok(LANG_NAMES[code], `no name for "${code}"`);
  for (const code of Object.keys(LANG_NAMES)) assert.ok(used.has(code), `"${code}" is named but unreachable`);
});

test('the pairs are the ones the API accepts, Cantonese first', () => {
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

test('every source can be transcribed without translating (source is its own target)', () => {
  for (const source of Object.keys(LIVE_PAIRS)) {
    assert.ok(targetsFor(source).includes(source), `${source} cannot be its own target`);
  }
});

test('the defaults are a pair the API accepts', () => {
  const d = schema.defaults();
  assert.equal(d.source, 'yue');
  assert.equal(d.target, 'zh');
  assert.equal(coerceTarget(d.source, d.target), 'zh');
});

test('coerceTarget keeps a valid pair and repairs an impossible one', () => {
  assert.equal(coerceTarget('yue', 'ja'), 'ja');
  assert.equal(coerceTarget('ru', 'ja'), 'zh'); // ru → ja is refused with 6001; fall back to the first target
  assert.equal(coerceTarget('th', 'ko'), 'zh');
  assert.equal(coerceTarget('zh_en', 'zh_en'), 'zh_en');
  assert.equal(coerceTarget('nonsense', 'zh'), 'zh'); // unknown source behaves like the default one
});

test('the subtitle-language field narrows itself to the chosen spoken language', () => {
  const target = byKey.target;
  assert.equal(typeof target.optionsFor, 'function');
  assert.deepEqual(target.optionsFor({ source: 'ru' }), ['zh', 'en', 'ru']);
  // every option the field can ever show is a language the matrix knows
  for (const [code] of target.options) assert.ok(LANG_NAMES[code], `target option "${code}" has no name`);
  for (const [code] of byKey.source.options) assert.ok(LIVE_PAIRS[code], `source option "${code}" has no pairs`);
});

test('sanitize still refuses a language that is not in the matrix at all', () => {
  assert.deepEqual(schema.sanitize({ source: 'kl' }), {});
  assert.deepEqual(schema.sanitize({ source: 'th' }), { source: 'th' });
});
