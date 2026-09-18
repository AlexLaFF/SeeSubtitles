'use strict';
// When TokenHub refuses a model outright — as hy-mt2-pro was once its free trial ran out, on 2026-09-17 — the
// translation steps down a model instead of failing every cue. A busy or slow moment must not trigger that.
const test = require('node:test');
const assert = require('node:assert/strict');
const tokenhub = require('../lib/tokenhub');

test('a spent trial or missing billing is a refusal; a busy moment is not', () => {
  const trial = { error: { type: 'permission_error', code: '401008', message: 'The free trial quota for the service has been exhausted and postpaid billing is not enabled, so the service cannot be used' } };
  assert.equal(tokenhub.isRefused(402, trial), true);
  assert.equal(tokenhub.isRefused(403, null), true);
  assert.equal(tokenhub.isRefused(200, { error: { type: 'permission_error' } }), true);
  assert.equal(tokenhub.isRefused(429, { error: { message: 'The request rate exceeds the current model RPM limit 60' } }), false, 'the rate limit clears by itself');
  assert.equal(tokenhub.isRefused(500, { error: { message: 'internal error' } }), false);
});

test('pro steps down to plus, plus to lite, and lite has nowhere to go', () => {
  assert.equal(tokenhub.nextModel('hy-mt2-pro'), 'hy-mt2-plus');
  assert.equal(tokenhub.nextModel('hy-mt2-plus'), 'hy-mt2-lite');
  assert.equal(tokenhub.nextModel('hy-mt2-lite'), null);
  assert.equal(tokenhub.nextModel('something-else'), null);
});

test("pro's per-minute limit is a busy moment with a stand-in, not a refusal", () => {
  assert.equal(tokenhub.isRateLimited(429, null), true);
  assert.equal(tokenhub.isRateLimited(400, { error: { message: 'The request rate exceeds the current model RPM limit 60' } }), true);
  assert.equal(tokenhub.isRateLimited(402, { error: { message: 'free trial quota' } }), false);
  assert.equal(tokenhub.rateFallback('hy-mt2-pro'), 'hy-mt2-plus');
  assert.equal(tokenhub.rateFallback('hy-mt2-plus'), null, 'plus has no limit worth stepping around');
});

test('a file translating while pro is at its limit goes to plus for a while, then back to pro', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { JobRunner } = require('../lib/jobs');
  const real = tokenhub.translate;
  const asked = [];
  let limitHits = 1;
  tokenhub.translate = async (_key, { model, text }) => {
    asked.push(model);
    if (model === 'hy-mt2-pro' && limitHits > 0) {
      limitHits--;
      throw new tokenhub.TokenHubError(429, 'The request rate exceeds the current model RPM limit 60', { error: { message: 'The request rate exceeds the current model RPM limit 60' } });
    }
    return `${model}:${text}`;
  };
  const logs = [];
  try {
    const jobs = new JobRunner({ db: null, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'rate-')), creds: null, tokenhubKey: 'k', log: (lvl, t) => logs.push(t) });
    assert.equal(await jobs.translate({ text: '一', source: 'yue', target: 'zh' }), 'hy-mt2-plus:一', 'the line that met the limit is translated by plus');
    assert.equal(await jobs.translate({ text: '二', source: 'yue', target: 'zh' }), 'hy-mt2-plus:二', 'and so is the next, without asking pro');
    assert.deepEqual(asked, ['hy-mt2-pro', 'hy-mt2-plus', 'hy-mt2-plus']);
    assert.equal(jobs.model, 'hy-mt2-pro', 'pro is not stepped down from');
    assert.equal(logs.filter((t) => /rate limit/.test(t)).length, 1);
    jobs.rateLimitedUntil = 0; // the cooldown has passed
    assert.equal(await jobs.translate({ text: '三', source: 'yue', target: 'zh' }), 'hy-mt2-pro:三');
  } finally {
    tokenhub.translate = real;
  }
});
