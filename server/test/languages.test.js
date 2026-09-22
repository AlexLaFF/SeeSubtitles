'use strict';
// The upload pipeline's language tables were probed against the live account rather than copied from the
// docs (server/probe-languages.js --engines --translate). These tests hold the invariants that connect the
// three tables, so adding a language cannot leave the translator without a code to use.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINES, TARGETS } = require('../lib/jobs');

test('every engine names a real Tencent 16k engine and a translator source code', () => {
  assert.ok(Object.keys(ENGINES).length >= 20);
  for (const [key, e] of Object.entries(ENGINES)) {
    assert.match(e.engine, /^16k_[\w.-]+$/, `${key}: odd engine "${e.engine}"`);
    assert.ok(e.label && e.label.length, `${key}: no label`);
    // '' means "let the translator detect it" — anything else must be a language the translator knows
    if (e.hunyuan) assert.ok(e.hunyuan in TARGETS, `${key}: "${e.hunyuan}" is not a language the translator takes`);
  }
});

test('no two entries are the same choice, and Cantonese is heard by the large model', () => {
  // Cantonese and Mandarin share 16k_zh_large and differ in what the translator is told the source is, so the
  // pair — not the engine alone — is what must be unique; two identical pairs would be a copy-and-paste slip.
  const used = Object.values(ENGINES).map((e) => `${e.engine}/${e.hunyuan}`);
  assert.equal(new Set(used).size, used.length, 'two entries are the same engine and source language');
  assert.equal(ENGINES.yue.engine, '16k_zh_large', '16k_yue ignores hotwords and hears a talk far worse');
  assert.equal(ENGINES.yue.hunyuan, 'yue');
  assert.equal(ENGINES.zh.engine, '16k_zh_large');
  assert.equal(ENGINES.multi.hunyuan, '', 'the multi-language engine must let the translator detect');
});

test('targets start with "no translation" and cover the languages the app can record in', () => {
  assert.equal(Object.keys(TARGETS)[0], 'none');
  for (const code of ['zh', 'zh-TW', 'yue', 'en', 'ja', 'ko', 'id', 'th', 'ru']) {
    assert.ok(code in TARGETS, `${code} is missing from the subtitle languages`);
  }
  assert.equal(Object.keys(TARGETS).length, 32); // 31 verified languages + "no translation"
});
