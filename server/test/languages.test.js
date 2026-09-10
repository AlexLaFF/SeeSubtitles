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

test('engines are distinct, and the Cantonese default is still there', () => {
  const used = Object.values(ENGINES).map((e) => e.engine);
  assert.equal(new Set(used).size, used.length, 'two entries share one engine');
  assert.equal(ENGINES.yue.engine, '16k_yue');
  assert.equal(ENGINES.yue.hunyuan, 'yue');
  assert.equal(ENGINES.multi.hunyuan, '', 'the multi-language engine must let the translator detect');
});

test('targets start with "no translation" and cover the languages the app can record in', () => {
  assert.equal(Object.keys(TARGETS)[0], 'none');
  for (const code of ['zh', 'zh-TW', 'yue', 'en', 'ja', 'ko', 'id', 'th', 'ru']) {
    assert.ok(code in TARGETS, `${code} is missing from the subtitle languages`);
  }
  assert.equal(Object.keys(TARGETS).length, 32); // 31 verified languages + "no translation"
});
