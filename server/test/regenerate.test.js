'use strict';
// A file's subtitles can be made again in other languages, and nothing made before is lost. The job runner itself,
// with a stand-in translator and ffprobe: what the job held moves to versions/<n>/ (edits and MP4s included), the
// upload is not needed again, and when only the subtitle language changes the file is not recognised — or counted
// against the plan — a second time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { JobRunner } = require('../lib/jobs');

const SENTENCE = 'Good morning everyone.';
const HEARD = { ResultDetail: [{ FinalSentence: SENTENCE, StartMs: 0, EndMs: 2000, Words: SENTENCE.split(' ').map((w, i) => ({ Word: w, OffsetStartMs: i * 500, OffsetEndMs: i * 500 + 400 })) }] };

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'regenerate-'));
  const db = openDb(root);
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.run('INSERT INTO users(id,email,pass_hash,created_at) VALUES(1,?,?,?)', 'fixture', 'unused', 0);
  const ffprobe = path.join(root, 'ffprobe.sh');
  fs.writeFileSync(ffprobe, '#!/bin/sh\necho \'{"format":{"duration":"3600"},"streams":[{"codec_type":"audio"},{"codec_type":"video","width":1280,"height":720}]}\'\n', { mode: 0o755 });
  const counted = []; const translated = [];
  const jobs = new JobRunner({ db, dir: path.join(root, 'jobs'), creds: null, ffprobe, log() {},
    translate: async (p) => { translated.push(p.target); return p.text.split('\n').map((l) => `[${p.target}] ${l}`).join('\n'); },
    onDuration: (job, seconds) => counted.push(seconds) });
  // a finished job as a first run leaves it: the upload, what was heard, the cues and their exports, and an MP4 made from them
  const j = jobs.create(1, { filename: 'Lecture 12.mp4', size: 10, sourceLang: 'en', targetLang: 'zh' });
  const dir = jobs.jobDir(j.id);
  fs.writeFileSync(path.join(dir, 'source.mp4'), 'the video');
  fs.writeFileSync(path.join(dir, 'audio.mp3'), 'its sound');
  fs.writeFileSync(path.join(dir, 'asr.json'), JSON.stringify(HEARD));
  jobs._update(j.id, { status: 'done', progress: 100 });
  jobs.saveCues(j.id, [{ start: 0, end: 2000, text: SENTENCE, trans: '大家早上好。（我改过的）' }]);
  fs.writeFileSync(path.join(dir, 'Lecture 12.zh.mp4'), 'a rendered video');
  // resolved a moment after the job says it is over: the runner lets go of it a tick later
  const settled = (id) => new Promise((resolve) => { const on = (v) => { if (v.id === id && ['done', 'failed'].includes(v.status)) { jobs.off('update', on); setTimeout(() => resolve(v), 20); } }; jobs.on('update', on); });
  return { jobs, j, dir, counted, translated, settled };
}

test('subtitles made again in another language keep the earlier ones as a version, and recognise nothing twice', async (t) => {
  const s = setup(t);
  const before = fs.readFileSync(path.join(s.dir, 'Lecture 12.zh.srt'), 'utf8');
  const wait = s.settled(s.j.id);
  s.jobs.regenerate(s.j.id, { sourceLang: 'en', targetLang: 'ja' });
  const after = await wait;
  assert.equal(after.status, 'done', after.error);
  assert.equal(after.target_lang, 'ja');
  assert.ok(after.files.includes('Lecture 12.ja.srt') && !after.files.some((f) => /\.zh\./.test(f)), after.files.join(', '));
  assert.match(fs.readFileSync(path.join(s.dir, 'Lecture 12.ja.srt'), 'utf8'), /\[ja\] Good/);
  assert.deepEqual(s.counted, [], 'the same speech is not recognised again, so no file time is counted');
  assert.deepEqual(s.translated, ['ja']);

  assert.equal(after.versions.length, 1);
  const v = after.versions[0];
  assert.deepEqual([v.n, v.sourceLang, v.targetLang, v.targetLabel], [1, 'en', 'zh', '简体中文']);
  assert.ok(v.files.includes('Lecture 12.zh.srt') && v.files.includes('Lecture 12.zh.mp4'), v.files.join(', '));
  assert.equal(fs.readFileSync(s.jobs.versionFile(s.j.id, 1, 'Lecture 12.zh.srt'), 'utf8'), before, 'the earlier subtitles, edits and all');
  assert.match(fs.readFileSync(s.jobs.versionFile(s.j.id, 1, 'cues.json'), 'utf8'), /我改过的/);
  assert.equal(fs.readFileSync(path.join(s.dir, 'source.mp4'), 'utf8'), 'the video', 'the upload stays where it is');

  // and again: versions add up, none is overwritten
  const wait2 = s.settled(s.j.id);
  s.jobs.regenerate(s.j.id, { sourceLang: 'en', targetLang: 'none' });
  const third = await wait2;
  assert.deepEqual(third.versions.map((x) => `${x.n}:${x.targetLang}`), ['1:zh', '2:ja']);
  assert.ok(fs.existsSync(s.jobs.versionFile(s.j.id, 1, 'Lecture 12.zh.srt')) && fs.existsSync(s.jobs.versionFile(s.j.id, 2, 'Lecture 12.ja.srt')));
});

test('heard as another language the file is recognised again; a job that is running or has lost its upload says so', async (t) => {
  const s = setup(t);
  assert.throws(() => s.jobs.regenerate(s.j.id, { sourceLang: 'xx', targetLang: 'zh' }), /unknown source language/);
  assert.throws(() => s.jobs.regenerate(s.j.id, { sourceLang: 'en', targetLang: 'xx' }), /unknown target language/);
  const wait = s.settled(s.j.id);
  s.jobs.regenerate(s.j.id, { sourceLang: 'ja', targetLang: 'zh' });
  assert.throws(() => s.jobs.regenerate(s.j.id, { sourceLang: 'en', targetLang: 'zh' }), /still running/);
  const after = await wait; // no recogniser here (creds: null), so this run fails — after it set out to recognise again
  assert.equal(after.status, 'failed');
  assert.equal(fs.existsSync(path.join(s.dir, 'asr.json')), false, 'what was heard as English is not reused for Japanese');
  assert.deepEqual(s.counted, [3600], 'and recognising again is counted');
  assert.equal(after.versions.length, 1, 'the English subtitles are kept all the same');

  fs.rmSync(path.join(s.dir, 'source.mp4'));
  assert.throws(() => s.jobs.regenerate(s.j.id, { sourceLang: 'en', targetLang: 'zh' }), /no longer on the server/);
});

test('a transcript heard by an engine the language no longer uses is heard again, and one that says it was heard by the right one is kept', async (t) => {
  const { openDb } = require('../lib/db');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reheard-'));
  const db = openDb(root);
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.run('INSERT INTO users(id,email,pass_hash,created_at) VALUES(1,?,?,?)', 'fixture', 'unused', 0);
  const ffprobe = path.join(root, 'ffprobe.sh');
  fs.writeFileSync(ffprobe, '#!/bin/sh\necho \'{"format":{"duration":"60"},"streams":[{"codec_type":"audio"}]}\'\n', { mode: 0o755 });
  // 百炼 at a port nobody answers on: a run that sets out to recognise fails at once, and says so
  const jobs = new JobRunner({ db, dir: path.join(root, 'jobs'), creds: null, ffprobe, log() {}, dashscopeKey: 'k', dashscopeBaseUrl: 'http://127.0.0.1:9',
    translate: async (p) => p.text });
  const settled = (id) => new Promise((resolve) => { const on = (v) => { if (v.id === id && ['done', 'failed'].includes(v.status)) { jobs.off('update', on); setTimeout(() => resolve(v), 20); } }; jobs.on('update', on); });
  const job = (heard) => {
    const j = jobs.create(1, { filename: 'Film.mp4', size: 10, sourceLang: 'ja', targetLang: 'none' });
    const dir = jobs.jobDir(j.id);
    fs.writeFileSync(path.join(dir, 'source.mp4'), 'the video');
    fs.writeFileSync(path.join(dir, 'audio.mp3'), 'its sound');
    fs.writeFileSync(path.join(dir, 'asr.json'), JSON.stringify(heard));
    jobs._update(j.id, { status: 'done', progress: 100 });
    jobs.saveCues(j.id, [{ start: 0, end: 2000, text: '聞こえた', trans: '' }]);
    return { j, dir };
  };
  const SENTENCE = [{ FinalSentence: 'あの髪の長い子ね。', StartMs: 0, EndMs: 2000, Words: [] }];

  // heard before transcripts said who heard them — that was Tencent, and Japanese is 百炼's now
  const old = job({ ResultDetail: SENTENCE });
  let wait = settled(old.j.id);
  jobs.regenerate(old.j.id, { sourceLang: 'ja', targetLang: 'en' });
  assert.equal(fs.existsSync(path.join(old.dir, 'asr.json')), false, "Tencent's Japanese is not kept once 百炼 hears Japanese");
  assert.equal((await wait).status, 'failed', 'it set out to recognise again (and the stand-in refused)');

  // heard by fun-asr and saying so: the subtitle language changes, nothing is recognised twice
  const fresh = job({ ResultDetail: SENTENCE, Engine: 'fun-asr' });
  wait = settled(fresh.j.id);
  jobs.regenerate(fresh.j.id, { sourceLang: 'ja', targetLang: 'en' });
  const v = await wait;
  assert.equal(v.status, 'done', v.error);
  assert.deepEqual(jobs.cues(fresh.j.id).cues.map((c) => c.text), ['あの髪の長い子ね。']);
});
