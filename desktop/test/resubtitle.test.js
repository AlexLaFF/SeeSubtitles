'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ResubtitleQueue, liveName } = require('../lib/resubtitle');
const names = require('@subs/core/names');

function recording(dir, base, { withMp4 = true } = {}) {
  fs.writeFileSync(names.filePath(dir, base, 'mp3'), Buffer.alloc(1234, 1));
  fs.writeFileSync(names.filePath(dir, base, 'zh'), 'LIVE ZH');
  fs.writeFileSync(names.filePath(dir, base, 'yue'), 'LIVE YUE');
  if (withMp4) fs.writeFileSync(names.filePath(dir, base, 'mp4'), 'OLD MP4');
}

/** Fake CloudLink: records calls, advances the job on each poll, serves two SRTs. */
function fakeCloud({ fail = false } = {}) {
  const calls = { create: [], upload: [], downloads: [] };
  let polls = 0;
  return {
    calls,
    createJob: async (b) => { calls.create.push(b); return { id: 'job1', status: 'uploading' }; },
    uploadJob: async (id, file, onProgress) => { calls.upload.push([id, file]); onProgress(600); onProgress(1234); return { id, status: 'queued' }; },
    getJob: async (id) => {
      polls++;
      if (fail && polls >= 2) return { id, status: 'failed', error: 'recognition failed: bad audio', files: [] };
      if (polls < 3) return { id, status: polls === 1 ? 'recognizing' : 'translating', progress: polls * 30, files: [] };
      return { id, status: 'done', progress: 100, files: ['talk.yue.srt', 'talk.zh.srt', 'talk.bilingual.srt', 'talk.zh.txt'] };
    },
    downloadJobFile: async (id, name, dest) => { calls.downloads.push(name); fs.writeFileSync(dest, `CLOUD ${name}`); return dest; },
  };
}

const wait = (q, ev) => new Promise((resolve) => q.once(ev, resolve));

test('re-subtitle uploads the mp3, replaces the live SRTs (keeping them as .live.srt) and parks the old MP4', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resub-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = '9月5号14点02分';
  recording(dir, base);
  const cloud = fakeCloud();
  const stages = [];
  const q = new ResubtitleQueue({ cloud, pollMs: 5 });
  q.on('status', (s) => { if (s.current) stages.push(`${s.current.stage}:${s.current.percent}`); });
  assert.ok(q.add({ base, dir, sourceLang: 'yue', targetLang: 'zh' }));
  assert.ok(!q.add({ base, dir, sourceLang: 'yue', targetLang: 'zh' }), 'no duplicate while running');
  const done = await wait(q, 'done');
  assert.deepEqual(done.files, [names.fileName(base, 'yue'), names.fileName(base, 'zh')]);
  assert.deepEqual(cloud.calls.create, [{ filename: names.fileName(base, 'mp3'), size: 1234, sourceLang: 'yue', targetLang: 'zh' }]);
  assert.equal(cloud.calls.upload[0][1], names.filePath(dir, base, 'mp3'));
  assert.deepEqual(cloud.calls.downloads, ['talk.yue.srt', 'talk.zh.srt']);
  assert.equal(fs.readFileSync(names.filePath(dir, base, 'zh'), 'utf8'), 'CLOUD talk.zh.srt');
  assert.equal(fs.readFileSync(names.filePath(dir, base, 'yue'), 'utf8'), 'CLOUD talk.yue.srt');
  assert.equal(fs.readFileSync(liveName(dir, base, 'zh'), 'utf8'), 'LIVE ZH');
  assert.equal(fs.readFileSync(liveName(dir, base, 'yue'), 'utf8'), 'LIVE YUE');
  assert.ok(!fs.existsSync(names.filePath(dir, base, 'mp4')), 'old MP4 moved aside so Make MP4 reappears');
  assert.equal(fs.readFileSync(liveName(dir, base, 'mp4'), 'utf8'), 'OLD MP4');
  assert.ok(stages.some((s) => s.startsWith('uploading:')) && stages.includes('recognizing:30') && stages.includes('translating:60') && stages.includes('downloading:100'), stages.join(' '));
  assert.equal(q.status().last.ok, true);
  // the .live.srt backups are not mistaken for recordings
  assert.equal(names.parse(path.basename(liveName(dir, base, 'zh'))), null);
});

test('a failed cloud job leaves the live files untouched and reports the error', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resub-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = '9月6号13点47分';
  recording(dir, base);
  const q = new ResubtitleQueue({ cloud: fakeCloud({ fail: true }), pollMs: 5 });
  q.add({ base, dir, sourceLang: 'yue', targetLang: 'zh' });
  const err = await wait(q, 'error');
  assert.match(err.error, /bad audio/);
  assert.equal(fs.readFileSync(names.filePath(dir, base, 'zh'), 'utf8'), 'LIVE ZH');
  assert.ok(fs.existsSync(names.filePath(dir, base, 'mp4')));
  assert.equal(q.status().current, null);
  assert.equal(q.status().last.ok, false);
});
