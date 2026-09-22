'use strict';
// Files are translated whole: numbered sentences in windows, the previous window in view, and alignment never guessed —
// a window that comes back short or refused is translated sentence by sentence instead, and so is a sentence left empty.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { translateWhole, parseNumbered, handles } = require('../lib/whole-translate');

/** A model that translates every numbered line it is asked for as "[en] text", and remembers what it was sent. */
function model({ drop = () => false, blank = () => false, stop = () => null } = {}) {
  const calls = [];
  const ask = async (body) => {
    const user = body.messages[0].content;
    calls.push({ body, user });
    const asked = user.split('Translate these lines:\n')[1].split('\n').map((l) => /^(\d+)\. (.*)$/.exec(l)).filter(Boolean);
    const lines = asked.filter(([, n]) => !drop(Number(n), calls.length)).map(([, n, t]) => `${n}. ${blank(Number(n)) ? '' : `[en] ${t}`}`);
    return { text: lines.join('\n'), stopReason: stop(calls.length) };
  };
  return { ask, calls };
}
const bySentence = (seen) => async (items) => { seen.push(...items); return items.map((t) => `(one by one) ${t}`); };

test('numbered answers are read back in order, and an answer missing a number is not accepted', () => {
  assert.deepEqual(parseNumbered('3. c\n1. a\n2. b', 1, 3), ['a', 'b', 'c']);
  assert.deepEqual(parseNumbered('11) x\n12、y', 11, 2), ['x', 'y']);
  assert.equal(parseNumbered('1. a\n3. c', 1, 3), null);
  assert.deepEqual(parseNumbered('1. a\n1. again\n2.', 1, 2), ['a', ''], 'the first answer for a number counts; an empty one is kept as empty');
});

test('a file goes through in windows, each with the previous lines and their translations as context', async () => {
  const m = model();
  const texts = ['一', '二', '三', '四', '五', '六', '七'];
  const r = await translateWhole(texts, { ask: m.ask, model: 'deepseek-v4-flash', source: 'ja', target: 'en', fallback: bySentence([]), window: 3, carry: 2 });
  assert.deepEqual(r.translations, texts.map((t) => `[en] ${t}`));
  assert.deepEqual([r.windows, r.fellBack, r.filled, m.calls.length], [3, 0, 0, 3]);
  assert.equal(m.calls[0].body.model, 'deepseek-v4-flash');
  assert.match(m.calls[0].body.system, /Japanese video into natural, fluent English/);
  assert.doesNotMatch(m.calls[0].user, /Earlier lines/);
  assert.match(m.calls[1].user, /Earlier lines \(context, already translated\):\n2\. 二 → \[en\] 二\n3\. 三 → \[en\] 三\n\nTranslate these lines:\n4\. 四\n5\. 五\n6\. 六$/);
});

test('a window that comes back short twice is translated sentence by sentence; the next window is not', async () => {
  const m = model({ drop: (n) => n === 2 }); // line 2 never comes back
  const seen = [];
  const r = await translateWhole(['a', 'b', 'c', 'd'], { ask: m.ask, model: 'x', source: 'ja', target: 'en', fallback: bySentence(seen), window: 2 });
  assert.deepEqual(r.translations, ['(one by one) a', '(one by one) b', '[en] c', '[en] d']);
  assert.deepEqual([r.fellBack, m.calls.length], [1, 3], 'asked twice, then the old way');
  assert.deepEqual(seen, ['a', 'b']);
});

test('a window the model stops on (refused or cut short) is asked again before falling back', async () => {
  const m = model({ stop: (call) => (call === 1 ? 'refusal' : 'end_turn') });
  const r = await translateWhole(['a', 'b'], { ask: m.ask, model: 'x', source: 'ja', target: 'en', fallback: bySentence([]) });
  assert.deepEqual(r.translations, ['[en] a', '[en] b']);
  assert.deepEqual([r.fellBack, m.calls.length], [0, 2]);
});

test('a sentence the model left empty is filled in by the sentence translator; the rest of the window stands', async () => {
  const m = model({ blank: (n) => n === 2 });
  const seen = [];
  const r = await translateWhole(['a', 'b', 'c'], { ask: m.ask, model: 'x', source: 'ja', target: 'en', fallback: bySentence(seen) });
  assert.deepEqual(r.translations, ['[en] a', '(one by one) b', '[en] c']);
  assert.deepEqual([r.filled, seen], [1, ['b']]);
});

test('a model that cannot be reached leaves every window to the sentence translator', async () => {
  const r = await translateWhole(['a', 'b', 'c'], { ask: async () => { throw new Error('unreachable'); }, model: 'x', source: 'ja', target: 'en', fallback: bySentence([]), window: 2 });
  assert.deepEqual(r.translations, ['(one by one) a', '(one by one) b', '(one by one) c']);
  assert.equal(r.fellBack, 2);
});

test('the pairs the model writes well go to it; small languages stay with hy-mt2', () => {
  assert.equal(handles('ja', 'en'), true);
  assert.equal(handles('', 'zh'), true, 'a file in a language to be detected');
  assert.equal(handles('yue', 'zh-TR'), true);
  assert.equal(handles('zh', 'bo'), false, 'Tibetan');
  assert.equal(handles('zh', 'ug'), false, 'Uyghur');
});

test('a Japanese file is translated whole by the job runner, and a pair it does not handle sentence by sentence', async (t) => {
  const { openDb } = require('../lib/db');
  const { JobRunner } = require('../lib/jobs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-'));
  const db = openDb(root);
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.run('INSERT INTO users(id,email,pass_hash,created_at) VALUES(1,?,?,?)', 'fixture', 'unused', 0);
  const ffprobe = path.join(root, 'ffprobe.sh');
  fs.writeFileSync(ffprobe, '#!/bin/sh\necho \'{"format":{"duration":"60"},"streams":[{"codec_type":"audio"}]}\'\n', { mode: 0o755 });
  const m = model();
  const sentenceCalls = [];
  const jobs = new JobRunner({ db, dir: path.join(root, 'jobs'), creds: null, ffprobe, log() {},
    translate: async (p) => { sentenceCalls.push(p.target); return p.text.split('\n').map((l) => `[${p.target}] ${l}`).join('\n'); },
    wholeAsk: m.ask });
  const HEARD = { ResultDetail: [
    { FinalSentence: 'あの髪の長い子ね。', StartMs: 0, EndMs: 2000, Words: [] },
    { FinalSentence: '彼女で問題ないと思います。', StartMs: 2500, EndMs: 4500, Words: [] },
  ] };
  const j = jobs.create(1, { filename: 'Film.mp4', size: 10, sourceLang: 'ja', targetLang: 'en' });
  const dir = jobs.jobDir(j.id);
  fs.writeFileSync(path.join(dir, 'source.mp4'), 'the video');
  fs.writeFileSync(path.join(dir, 'asr.json'), JSON.stringify(HEARD));
  const settled = (id) => new Promise((resolve) => { const on = (v) => { if (v.id === id && ['done', 'failed'].includes(v.status)) { jobs.off('update', on); setTimeout(() => resolve(v), 20); } }; jobs.on('update', on); });

  let wait = settled(j.id);
  jobs._update(j.id, { status: 'queued' });
  jobs.kick();
  let v = await wait;
  assert.equal(v.status, 'done', v.error);
  assert.deepEqual(jobs.cues(j.id).cues.map((c) => c.trans), ['[en] あの髪の長い子ね。', '[en] 彼女で問題ないと思います。']);
  assert.equal(m.calls.length, 1, 'both sentences in one request');
  assert.deepEqual(sentenceCalls, []);

  wait = settled(j.id);
  jobs.regenerate(j.id, { sourceLang: 'ja', targetLang: 'bo' });
  v = await wait;
  assert.equal(v.status, 'done', v.error);
  assert.equal(m.calls.length, 1, 'Tibetan is not asked of the chat model');
  assert.ok(sentenceCalls.length > 0 && sentenceCalls.every((c) => c === 'bo'));
});
