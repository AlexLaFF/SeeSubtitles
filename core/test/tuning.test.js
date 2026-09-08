'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hotwordList, buildConnection } = require('../tencent');
const { recognitionParams } = require('../translator');

test('hotword text → hotword_list with clamped weights', () => {
  assert.equal(hotwordList('张培光|10\n安利 | 8\n纽崔莱\n坏|99\n强制|100\n\n'), '张培光|10,安利|8,纽崔莱|10,坏|11,强制|100');
  assert.equal(hotwordList(''), '');
  assert.equal(hotwordList('a|1,b|2'), 'a|1,b|2');
});

test('recognition params omit defaults and convert units', () => {
  assert.deepEqual(recognitionParams({ hotwords: '', vadSilenceTime: 1000, maxSpeakTime: 10, noiseThreshold: 0 }), {});
  assert.deepEqual(recognitionParams({ hotwords: '张培光|10', vadSilenceTime: 700, maxSpeakTime: 6, noiseThreshold: 0.5 }),
    { hotword_list: '张培光|10', vad_silence_time: 700, max_speak_time: 6000, noise_threshold: 0.5 });
});

test('non URL-safe values are signed raw and sent URL-encoded', () => {
  const creds = { appid: '1250000000', secretId: 'AKIDx', secretKey: 'sk' };
  const c = buildConnection(creds, { voiceId: 'v', extra: { hotword_list: '张培光|10,安利|8' } });
  assert.ok(c.stringToSign.includes('hotword_list=张培光|10,安利|8'), 'raw in the string to sign');
  assert.ok(c.url.includes(`hotword_list=${encodeURIComponent('张培光|10,安利|8')}`), 'encoded in the URL');
  assert.ok(!c.url.includes('张'));
});
