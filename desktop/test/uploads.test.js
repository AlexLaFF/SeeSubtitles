'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { UploadQueue } = require('../lib/uploads');

test('added files are uploaded as cloud jobs one at a time with progress', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f1 = path.join(dir, 'talk.mp4'); fs.writeFileSync(f1, Buffer.alloc(1000));
  const f2 = path.join(dir, 'b.mp3'); fs.writeFileSync(f2, Buffer.alloc(10));
  const calls = [];
  let created = 0;
  const cloud = { createJob: async (b) => { calls.push(['create', b.filename, b.size, b.sourceLang, b.targetLang]); return { id: `j${++created}` }; }, uploadJob: async (id, file, onP) => { calls.push(['upload', id, path.basename(file)]); onP(500); onP(1000); return { id }; } };
  const q = new UploadQueue({ cloud });
  const seen = [];
  q.on('status', (s) => seen.push(s.current ? `${s.current.name}:${s.current.percent}` : 'idle'));
  assert.ok(q.add({ file: f1, sourceLang: 'yue', targetLang: 'zh' }));
  assert.ok(!q.add({ file: f1, sourceLang: 'yue', targetLang: 'zh' }), 'no duplicates');
  assert.ok(q.add({ file: f2, sourceLang: 'yue', targetLang: 'zh' }));
  assert.deepEqual(q.status().queue, ['b.mp3']);
  await new Promise((r) => { let n = 0; q.on('done', () => { if (++n === 2) r(); }); });
  assert.deepEqual(calls, [['create', 'talk.mp4', 1000, 'yue', 'zh'], ['upload', 'j1', 'talk.mp4'], ['create', 'b.mp3', 10, 'yue', 'zh'], ['upload', 'j2', 'b.mp3']]);
  assert.ok(seen.includes('talk.mp4:50') && seen.includes('talk.mp4:100'));
  assert.equal(q.status().last.jobId, 'j2');
  assert.throws(() => q.add({ file: path.join(dir, 'missing.mp4') }), /not found/);
});
