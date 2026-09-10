'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JobImporter, baseFromFilename } = require('../lib/import-job');
const names = require('@subs/core/names');
const { Recorder } = require('@subs/core/recorder');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subs-import-'));
  let map = {};
  const downloaded = [];
  const cloud = {
    downloadJobFile: async (id, name, dest) => { downloaded.push(name); fs.writeFileSync(dest, `CLOUD ${name}`); return dest; },
  };
  const importer = new JobImporter({ cloud, dir: () => dir, getMap: () => map, setMap: (m) => { map = m; }, log: () => {} });
  return { dir, importer, downloaded, getMap: () => map };
}
const doneJob = (over = {}) => ({
  id: 'abc123', filename: 'talk.mp4', status: 'done', source_lang: 'yue', target_lang: 'zh',
  created_at: Date.parse('2026-09-10T14:33:00'),
  files: ['talk.yue.srt', 'talk.zh.srt', 'talk.bilingual.srt', 'talk.zh.vtt'], ...over,
});

test('the base drops the extension, and a stem already ending in 录音 is not doubled', () => {
  assert.equal(baseFromFilename('talk.mp4', 0), 'talk');
  assert.equal(baseFromFilename('测试 讲座录音.mp3', 0), '测试 讲座');
  assert.equal(names.fileName(baseFromFilename('测试 讲座录音.mp3', 0), 'mp3', 'cn'), '测试 讲座录音.mp3');
  assert.equal(baseFromFilename('a/b:c.wav', 0), 'a b c');
  assert.match(baseFromFilename('', Date.parse('2026-09-10T14:33:00')), /^9月10号14点33分$/);
});

test('a finished job becomes a recording the Files list can show', async () => {
  const { dir, importer, downloaded } = setup();
  const { base, written } = await importer._import(doneJob());
  assert.equal(base, 'talk');
  assert.deepEqual(downloaded, ['audio.mp3', 'talk.yue.srt', 'talk.zh.srt']);
  assert.deepEqual(written.sort(), ['talk中文字幕.zh.srt', 'talk录音.json', 'talk录音.mp3', 'talk粤语字幕.yue.srt'].sort());
  for (const f of written) assert.ok(fs.existsSync(path.join(dir, f)), `${f} on disk`);

  // the real check: the recorder lists it, with both subtitle tracks
  const list = new Recorder({ dir }).list();
  assert.equal(list.length, 1);
  assert.equal(list[0].base, 'talk');
  assert.ok(list[0].mp3, 'an mp3 is what makes it a recording');
  assert.ok(list[0].srtTarget && list[0].srtSource);
});

test('a rendered MP4 comes down too', async () => {
  const { dir, importer } = setup();
  const job = doneJob({ files: ['talk.yue.srt', 'talk.zh.srt', 'talk.bilingual.mp4'] });
  await importer._import(job);
  assert.ok(fs.existsSync(path.join(dir, 'talk录音＋字幕.mp4')));
  assert.ok(new Recorder({ dir }).list()[0].mp4);
});

test('a job with no translation still imports', async () => {
  const { dir, importer } = setup();
  await importer._import(doneJob({ target_lang: 'none', files: ['talk.yue.srt'] }));
  const rec = new Recorder({ dir }).list()[0];
  assert.ok(rec.mp3 && rec.srtSource);
  // no translation was asked for, so both slots are the same file: the recording transcribes rather than translates
  assert.equal(rec.srtTarget, rec.srtSource);
  assert.deepEqual([rec.source, rec.target], ['yue', 'yue']);
});

test('a second import of the same name does not overwrite the first', async () => {
  const { dir, importer } = setup();
  await importer._import(doneJob());
  const second = await importer._import(doneJob({ id: 'def456' }));
  assert.equal(second.base, 'talk-2');
  assert.equal(new Recorder({ dir }).list().length, 2);
});

test('annotate imports a done job once, then reports the recording it became', async () => {
  const { importer, getMap } = setup();
  const jobs = [doneJob()];
  importer.annotate(jobs);
  assert.equal(jobs[0].importedBase, undefined, 'the first pass only starts it');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(getMap()['abc123'], 'talk');
  const again = [doneJob()];
  importer.annotate(again);
  assert.equal(again[0].importedBase, 'talk', 'a later poll tags it so the Files list hides the job row');
});

test('jobs that are not finished are left alone', async () => {
  const { importer, downloaded, getMap } = setup();
  importer.annotate([doneJob({ status: 'recognizing' }), doneJob({ id: 'x', status: 'failed' })]);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(downloaded, []);
  assert.deepEqual(getMap(), {});
});

test('a download failure does not leave a half-imported job marked as done', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subs-import-'));
  let map = {};
  const cloud = { downloadJobFile: async () => { throw new Error('network down'); } };
  const importer = new JobImporter({ cloud, dir: () => dir, getMap: () => map, setMap: (m) => { map = m; }, log: () => {} });
  await assert.rejects(() => importer._import(doneJob()), /network down/);
  assert.deepEqual(map, {}, 'not marked imported, so the next poll retries');
});
