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
