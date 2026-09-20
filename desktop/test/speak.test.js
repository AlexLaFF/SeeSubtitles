'use strict';
// The translation, spoken (web/speak.js): what is said, in what order, how fast, and what is skipped to keep up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Queue, Speaker, textToSpeak, voiceLang, voicesFor } = require('../../web/speak');

const line = (id, targetText, extra = {}) => ({ id, sourceText: `原文${id}`, targetText, ended: true, ...extra });

test('only a settled translation is worth saying', () => {
  assert.equal(textToSpeak(line('a', 'Hello')), 'Hello');
  assert.equal(textToSpeak(line('a', 'Hello', { ended: false })), '', 'a draft is rewritten; sound cannot be');
  assert.equal(textToSpeak({ id: 'a', sourceText: '你好', targetText: '你好', ended: true }), '', 'the words as spoken, echoed late, help no one');
  assert.equal(textToSpeak({ id: 'a', sourceText: '你好', targetText: '', ended: true }), '');
  assert.equal(textToSpeak(line('a', 'Thanks', { kind: 'reply' })), '', 'what the reader typed is not read back to them');
});

test('sentences are said once, in order, and never the past', () => {
  const q = new Queue();
  assert.deepEqual(q.offer(line('early', 'before it was on')), []);
  assert.equal(q.next(), null, 'off until started');
  q.start(['old1', 'old2']);
  q.offer(line('old1', 'already on screen'));
  assert.equal(q.next(), null);
  q.offer(line('s1', 'One', { ended: false }));
  assert.equal(q.next(), null, 'not until it settles');
  q.offer(line('s1', 'One'));
  q.offer(line('s1', 'One, reworded')); // a late rewrite of a settled line is not said again
  assert.deepEqual(q.next(), { id: 's1', text: 'One', rate: 1.1 });
  assert.equal(q.next(), null, 'one at a time');
  q.offer(line('s2', 'Two'));
  q.finished('s1');
  assert.deepEqual(q.next(), { id: 's2', text: 'Two', rate: 1.1 });
  q.finished('s2');
  assert.equal(q.spoken, 2);
  assert.equal(q.behind, 0);
});

test('it speeds up when a sentence is waiting and skips to the newest rather than drift', () => {
  const q = new Queue();
  q.start();
  q.offer(line('a', 'A'));
  assert.equal(q.next().rate, 1.1);
  q.offer(line('b', 'B')); q.offer(line('c', 'C'));
  assert.deepEqual(q.offer(line('d', 'D')), ['b'], 'more than two waiting: the oldest goes');
  assert.equal(q.skipped, 1);
  q.finished('a');
  assert.deepEqual(q.next(), { id: 'c', text: 'C', rate: 1.265 }, 'one still waiting behind it: hurry');
  q.finished('c');
  assert.deepEqual(q.next(), { id: 'd', text: 'D', rate: 1.1 });
  // two waiting behind the one being said: rush, but never past the cap
  const fast = new Queue({ rate: 1.4 });
  fast.start(); fast.offer(line('x', 'X')); fast.offer(line('y', 'Y')); fast.offer(line('z', 'Z'));
  assert.equal(fast.next().rate, 1.6);
  q.stop();
  q.offer(line('e', 'E'));
  assert.equal(q.next(), null);
});

test('a language is given the system voice that fits it best', () => {
  assert.equal(voiceLang('yue'), 'zh-HK');
  assert.equal(voiceLang('zh'), 'zh-CN');
  assert.equal(voiceLang('xx'), 'xx');
  const all = [{ name: 'Sin-ji', lang: 'zh-HK', localService: true }, { name: 'Tingting', lang: 'zh-CN', localService: true }, { name: 'Google UK', lang: 'en-GB', localService: false },
    { name: 'Samantha', lang: 'en-US', localService: true }, { name: 'Ava (Premium)', lang: 'en-US', localService: true }];
  assert.deepEqual(voicesFor('en', all).map((v) => v.name), ['Ava (Premium)', 'Samantha', 'Google UK']);
  assert.deepEqual(voicesFor('zh', all).map((v) => v.name), ['Tingting'], 'Mandarin is never read in a Cantonese voice');
  assert.deepEqual(voicesFor('yue', all).map((v) => v.name), ['Sin-ji']);
  // the robotic and novelty voices sort first by name; they must not be what a listener gets by default
  const mandarin = [{ name: 'Eddy (Chinese (China mainland))', lang: 'zh-CN', localService: true }, { name: 'Grandma (Chinese (China mainland))', lang: 'zh-CN', localService: true }, { name: 'Tingting', lang: 'zh-CN', localService: true }];
  assert.deepEqual(voicesFor('zh', mandarin).map((v) => v.name), ['Tingting', 'Eddy (Chinese (China mainland))', 'Grandma (Chinese (China mainland))']);
});

test('the speaker says what the queue gives it, at its rate, and moves on when each sentence ends', () => {
  const said = [];
  const synth = { getVoices: () => [{ name: 'Samantha', lang: 'en-US', localService: true }], speak: (u) => said.push(u), cancel: () => { synth.cancelled = true; } };
  class Utterance { constructor(text) { this.text = text; } }
  let changes = 0;
  const s = new Speaker({ lang: 'en', synth, Utterance, onChange: () => { changes++; } });
  assert.equal(s.supported, true);
  s.start(['old']);
  s.offer(line('a', 'First')); s.offer(line('b', 'Second'));
  assert.equal(said.length, 1);
  assert.equal(said[0].text, 'First');
  assert.equal(said[0].lang, 'en-US');
  assert.equal(said[0].voice.name, 'Samantha');
  said[0].onend();
  assert.deepEqual(said.map((u) => u.text), ['First', 'Second']);
  said[1].onerror(); // a voice that fails must not stop the ones after it
  s.offer(line('c', 'Third'));
  assert.equal(said.length, 3);
  s.stop();
  assert.equal(synth.cancelled, true);
  assert.ok(changes > 3);
  assert.equal(new Speaker({ lang: 'en', synth: null, Utterance: null }).start(), false, 'a browser without speech says so instead of pretending');
});
