'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { UploadQueue } = require('../lib/uploads');

const tmp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const done = (q) => new Promise((r) => q.once('done', r));
const idle = (q) => new Promise((r) => { const on = (s) => { if (!s.current && !s.queue.length && !s.queuedJobs.length) { q.off('status', on); r(); } }; q.on('status', on); });
/** A pending-upload store as main.js gives the queue one (there it is config.json). */
const store = (map = {}) => ({ map, getPending: () => store.read(map), setPending(m) { for (const k of Object.keys(map)) delete map[k]; Object.assign(map, m); } });
store.read = (m) => JSON.parse(JSON.stringify(m));

/** A server that has `received` bytes of each job and breaks the connection where `breakAt` says. */
function fakeCloud({ breakAt = [] } = {}) {
  const jobs = {}; const calls = []; let n = 0;
  return {
    jobs, calls,
    createJob: async (b) => { const id = `j${++n}`; jobs[id] = { id, status: 'uploading', received: 0, size: b.size }; calls.push(['create', b.filename, b.size, b.sourceLang, b.targetLang]); return { id, status: 'uploading' }; },
    getJob: async (id) => { if (!jobs[id]) throw Object.assign(new Error('no such job'), { status: 404 }); return { ...jobs[id] }; },
    uploadJob: async (id, file, onP, signal, offset = 0) => {
      calls.push(['upload', id, path.basename(file), offset]);
      const j = jobs[id];
      if (offset !== j.received) throw Object.assign(new Error('offset'), { status: 409, code: 'upload_offset', received: j.received });
      const stop = breakAt.length ? breakAt.shift() : null;
      const upTo = stop == null ? j.size : Math.min(stop, j.size);
      onP(upTo - offset);
      j.received = upTo;
      if (upTo < j.size) throw new Error('fetch failed');
      j.status = 'queued'; delete j.received;
      return { ...j };
    },
  };
}

test('added files are uploaded as cloud jobs one at a time with progress', async (t) => {
  const dir = tmp(t);
  const f1 = path.join(dir, 'talk.mp4'); fs.writeFileSync(f1, Buffer.alloc(1000));
  const f2 = path.join(dir, 'b.mp3'); fs.writeFileSync(f2, Buffer.alloc(10));
  const cloud = fakeCloud();
  const q = new UploadQueue({ cloud });
  const seen = [];
  q.on('status', (s) => seen.push(s.current ? `${s.current.name}:${s.current.percent}` : 'idle'));
  assert.ok(q.add({ file: f1, sourceLang: 'yue', targetLang: 'zh' }));
  assert.ok(!q.add({ file: f1, sourceLang: 'yue', targetLang: 'zh' }), 'no duplicates');
  assert.ok(q.add({ file: f2, sourceLang: 'yue', targetLang: 'zh' }));
  assert.deepEqual(q.status().queue, ['b.mp3']);
  await new Promise((r) => { let n = 0; q.on('done', () => { if (++n === 2) r(); }); });
  assert.deepEqual(cloud.calls, [['create', 'talk.mp4', 1000, 'yue', 'zh'], ['upload', 'j1', 'talk.mp4', 0], ['create', 'b.mp3', 10, 'yue', 'zh'], ['upload', 'j2', 'b.mp3', 0]]);
  assert.ok(seen.includes('talk.mp4:0') && seen.includes('talk.mp4:100'));
  assert.equal(q.status().last.jobId, 'j2');
  assert.throws(() => q.add({ file: path.join(dir, 'missing.mp4') }), /not found/);
});

test('a connection that breaks is carried on from what the server has, not begun again', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'talk.mp4'); fs.writeFileSync(f, Buffer.alloc(1000));
  const cloud = fakeCloud({ breakAt: [300, 300, 800] }); // 300 arrive, then an attempt that gets nowhere, then 800, then the rest
  const s = store();
  const q = new UploadQueue({ cloud, retryMs: [1], ...s });
  const seen = [];
  q.on('status', (st) => { if (st.current) seen.push(`${st.current.percent}${st.current.retrying ? ' retrying' : ''}`); });
  q.add({ file: f, sourceLang: 'yue', targetLang: 'zh' });
  const job = await done(q);
  assert.equal(job.status, 'queued');
  assert.deepEqual(cloud.calls.filter((c) => c[0] === 'upload').map((c) => c[3]), [0, 300, 300, 800], 'each attempt starts where the server got to');
  assert.equal(cloud.calls.filter((c) => c[0] === 'create').length, 1, 'one job throughout');
  assert.ok(seen.includes('30 retrying') && seen.includes('80 retrying') && seen.includes('100'), seen.join(' | '));
  assert.deepEqual(s.map, {}, 'nothing left to carry on once it has arrived');
});

test('a connection that goes silent without failing is noticed, said, and replaced', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'talk.mp4'); fs.writeFileSync(f, Buffer.alloc(1000));
  const cloud = fakeCloud();
  const upload = cloud.uploadJob;
  let hung = 0;
  // Wi‑Fi off for ten seconds: 300 bytes go, then the connection takes nothing more and raises no error
  cloud.uploadJob = (id, file, onP, signal, offset) => (hung++ ? upload(id, file, onP, signal, offset) : new Promise((resolve, reject) => {
    cloud.calls.push(['upload', id, path.basename(file), offset]);
    onP(300); cloud.jobs[id].received = 300;
    signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
  }));
  const logs = [];
  const q = new UploadQueue({ cloud, retryMs: [1], quietMs: 20, stallMs: 80, log: (level, text) => logs.push(text) });
  const seen = [];
  q.on('status', (st) => { if (st.current) seen.push(`${st.current.percent}${st.current.retrying ? ' waiting' : ''}`); });
  q.add({ file: f, sourceLang: 'yue', targetLang: 'zh' });
  await done(q);
  assert.deepEqual(cloud.calls.filter((c) => c[0] === 'upload').map((c) => c[3]), [0, 300]);
  assert.ok(seen.indexOf('30 waiting') > seen.indexOf('30') && seen.indexOf('30') >= 0, `the row says it is waiting before anything fails: ${seen.join(' | ')}`);
  assert.equal(seen.at(-1), '100');
  assert.ok(logs.some((l) => /took nothing for/.test(l)), logs.join('\n'));
});

test('an upload the app was closed in the middle of carries on when it opens again', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'talk.mp4'); fs.writeFileSync(f, Buffer.alloc(1000));
  const cloud = fakeCloud({ breakAt: [400] });
  const s = store();
  const first = new UploadQueue({ cloud, retryMs: [60_000], ...s });
  first.add({ file: f, sourceLang: 'yue', targetLang: 'zh' });
  await new Promise((r) => { const on = (st) => { if (st.current && st.current.retrying) { first.off('status', on); r(); } }; first.on('status', on); });
  assert.deepEqual(Object.keys(s.map), ['j1'], 'written down while it is under way');
  assert.equal(s.map.j1.file, f);
  // the app is closed here: nothing of `first` survives but what it wrote down

  const second = new UploadQueue({ cloud, retryMs: [1], ...s });
  assert.equal(second.resumePending(), 1);
  assert.equal(second.resumePending(), 0, 'asked again, it is already in hand');
  assert.equal((await done(second)).id, 'j1');
  assert.deepEqual(cloud.calls.filter((c) => c[0] !== 'create').at(-1), ['upload', 'j1', 'talk.mp4', 400]);
  assert.equal(cloud.calls.filter((c) => c[0] === 'create').length, 1);
  assert.deepEqual(s.map, {});
  first.cancel('j1');
});

test('what cannot be carried on is let go: the job deleted elsewhere, the file changed or gone', async (t) => {
  const dir = tmp(t);
  const cloud = fakeCloud();
  const gone = path.join(dir, 'gone.mp4'); const changed = path.join(dir, 'changed.mp4'); const orphan = path.join(dir, 'orphan.mp4');
  for (const f of [changed, orphan]) fs.writeFileSync(f, Buffer.alloc(1000));
  cloud.jobs.jc = { id: 'jc', status: 'uploading', received: 100, size: 1000 };
  const s = store({
    jg: { file: gone, source: gone, name: 'gone.mp4', size: 1000, mtimeMs: 1 },
    jc: { file: changed, source: changed, name: 'changed.mp4', size: 999, mtimeMs: fs.statSync(changed).mtimeMs },
    jo: { file: orphan, source: orphan, name: 'orphan.mp4', size: 1000, mtimeMs: fs.statSync(orphan).mtimeMs }, // no such job on the server
  });
  const q = new UploadQueue({ cloud, retryMs: [1], ...s });
  const waiting = idle(q);
  assert.equal(q.resumePending(), 2, 'a file that is gone is not even tried');
  await waiting;
  assert.deepEqual(s.map, {});
  assert.deepEqual(cloud.calls, [], 'nothing was sent');
  assert.match(q.status().last.error, /no such job|changed/);
});

test('logged out, an upload waits for the next login instead of being let go', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'talk.mp4'); fs.writeFileSync(f, Buffer.alloc(1000));
  const cloud = fakeCloud();
  cloud.jobs.j9 = { id: 'j9', status: 'uploading', received: 500, size: 1000 };
  let loggedIn = false;
  const getJob = cloud.getJob;
  cloud.getJob = async (id) => { if (!loggedIn) throw new Error('not logged in'); return getJob(id); };
  const s = store({ j9: { file: f, source: f, name: 'talk.mp4', size: 1000, mtimeMs: fs.statSync(f).mtimeMs } });
  const q = new UploadQueue({ cloud, retryMs: [1], ...s });
  const waiting = idle(q);
  q.resumePending();
  await waiting;
  assert.deepEqual(Object.keys(s.map), ['j9']);
  loggedIn = true;
  q.resumePending();
  await done(q);
  assert.deepEqual(cloud.calls, [['upload', 'j9', 'talk.mp4', 500]]);
  assert.deepEqual(s.map, {});
});

test('deleting the row of the file being sent gives the upload up, and the next one starts', async (t) => {
  const dir = tmp(t);
  const f1 = path.join(dir, 'talk.mp4'); fs.writeFileSync(f1, Buffer.alloc(1000));
  const f2 = path.join(dir, 'b.mp3'); fs.writeFileSync(f2, Buffer.alloc(10));
  const cloud = fakeCloud();
  let late; // the first upload's progress callback, called again after it was given up
  const upload = cloud.uploadJob;
  cloud.uploadJob = (id, file, onP, signal, offset) => (id === 'j1'
    ? new Promise((resolve, reject) => { late = onP; onP(300); signal.addEventListener('abort', () => reject(new Error('aborted'))); })
    : upload(id, file, onP, signal, offset));
  const s = store();
  const q = new UploadQueue({ cloud, retryMs: [1], ...s });
  q.add({ file: f1, sourceLang: 'yue', targetLang: 'zh' });
  q.add({ file: f2, sourceLang: 'yue', targetLang: 'zh' });
  await new Promise((r) => { const on = (st) => { if (st.current && st.current.jobId === 'j1' && st.current.percent === 30) { q.off('status', on); r(); } }; q.on('status', on); });
  assert.equal(q.cancel('other'), false, 'only a job this queue has');
  assert.equal(q.cancel('j1'), true);
  assert.equal((await done(q)).id, 'j2');
  assert.doesNotThrow(() => late(900));
  assert.equal(q.status().current, null);
  assert.deepEqual(s.map, {}, 'a deleted row is not carried on next time');
  assert.notEqual(q.status().last.ok, false, 'and is not reported as a failure');
});

/** A stand-in for ffmpeg: writes "sound" to its last argument; with REFUSE_COPY it fails when asked to copy the stream. */
function fakeFfmpeg(dir, { refuseCopy = false } = {}) {
  const bin = path.join(dir, 'ffmpeg.sh');
  fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${path.join(dir, 'ffmpeg.log')}"\nfor a; do out=$a; done\n${refuseCopy ? 'case " $* " in *" copy "*) echo "codec not currently supported in container" >&2; exit 1;; esac\n' : ''}printf sound > "$out"\n`, { mode: 0o755 });
  return bin;
}

test('a video sent as audio only has its sound taken out first, and that is what is uploaded', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'Lecture 12.mp4'); fs.writeFileSync(f, Buffer.alloc(5000));
  const cloud = fakeCloud();
  const s = store();
  const q = new UploadQueue({ cloud, ffmpeg: fakeFfmpeg(dir), tmpDir: path.join(dir, 'tmp'), ...s });
  const stages = [];
  q.on('status', (st) => { if (st.current && stages.at(-1) !== st.current.stage) stages.push(st.current.stage); });
  q.add({ file: f, sourceLang: 'zh', targetLang: 'zh', audioOnly: true });
  assert.ok(!q.add({ file: f, sourceLang: 'zh', targetLang: 'zh' }), 'the same video is not sent twice, either way');
  await done(q);
  assert.deepEqual(stages, ['extracting', 'uploading']);
  assert.deepEqual(cloud.calls[0], ['create', 'Lecture 12.m4a', 5, 'zh', 'zh'], 'the job is named for the sound, and is its size');
  assert.match(cloud.calls[1][2], /^[a-f0-9]{12}\.m4a$/);
  assert.match(fs.readFileSync(path.join(dir, 'ffmpeg.log'), 'utf8'), /-map 0:a:0 -vn .*-c:a copy /, 'the sound as it is in the file');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), [], 'and is not kept once it has arrived');
  assert.ok(fs.existsSync(f), 'the video is untouched');
});

test('sound that m4a cannot hold as it is gets encoded instead; a file with none says so', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'old.avi'); fs.writeFileSync(f, Buffer.alloc(5000));
  const cloud = fakeCloud();
  const q = new UploadQueue({ cloud, ffmpeg: fakeFfmpeg(dir, { refuseCopy: true }), tmpDir: path.join(dir, 'tmp') });
  q.add({ file: f, sourceLang: 'zh', targetLang: 'zh', audioOnly: true });
  await done(q);
  const runs = fs.readFileSync(path.join(dir, 'ffmpeg.log'), 'utf8').trim().split('\n');
  assert.equal(runs.length, 2);
  assert.match(runs[1], /-c:a aac /);

  const none = new UploadQueue({ cloud, ffmpeg: '/usr/bin/false', tmpDir: path.join(dir, 'tmp') });
  const waiting = idle(none);
  none.add({ file: f, sourceLang: 'zh', targetLang: 'zh', audioOnly: true });
  await waiting;
  assert.match(none.status().last.error, /could not take the sound out of old\.avi/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
  assert.equal(cloud.calls.filter((c) => c[0] === 'create').length, 1, 'no job for a file with nothing to send');
});

test('Try again: an upload that failed before it had a job is added again as it was asked for', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'Lecture.mp4'); fs.writeFileSync(f, Buffer.alloc(5000));
  const cloud = fakeCloud();
  let down = true;
  const create = cloud.createJob;
  cloud.createJob = async (b) => { if (down) throw Object.assign(new Error('the file subtitling hours of this month are used up'), { status: 403 }); return create(b); };
  const q = new UploadQueue({ cloud, ffmpeg: fakeFfmpeg(dir), tmpDir: path.join(dir, 'tmp'), retryMs: [1] });
  const waiting = idle(q);
  q.add({ file: f, sourceLang: 'en', targetLang: 'ja', audioOnly: true });
  await waiting;
  assert.equal(q.status().last.ok, false);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), [], 'the sound taken out for nothing is not kept');
  down = false;
  assert.equal(q.retryLast(), true);
  assert.equal(q.status().last, null, 'what went wrong is no longer the news once it is being tried again');
  await done(q);
  assert.deepEqual(cloud.calls[0], ['create', 'Lecture.m4a', 5, 'en', 'ja'], 'the same languages, and audio only again');
  assert.equal(q.retryLast(), false, 'nothing failed since');
});

test('Try again: an upload the server has part of carries on — also one this app never wrote down, given the same file', async (t) => {
  const dir = tmp(t);
  const f = path.join(dir, 'talk.mp4'); fs.writeFileSync(f, Buffer.alloc(1000));
  const other = path.join(dir, 'other.mp4'); fs.writeFileSync(other, Buffer.alloc(999));
  const cloud = fakeCloud();
  cloud.jobs.j7 = { id: 'j7', status: 'uploading', received: 620, size: 1000, filename: 'talk.mp4' }; // begun by an older build: 62% there, nothing written down here
  const s = store();
  const q = new UploadQueue({ cloud, retryMs: [1], ...s });
  await assert.rejects(q.resume('j7'), (e) => e.code === 'need_file', 'without the file there is nothing to carry on with: the window asks for it');
  await assert.rejects(q.resume('j7', other), (e) => e.code === 'not_the_file', 'and it has to be the file that was being sent');
  assert.deepEqual(cloud.calls, []);
  assert.equal(await q.resume('j7', f), true);
  assert.equal((await done(q)).id, 'j7');
  assert.deepEqual(cloud.calls, [['upload', 'j7', 'talk.mp4', 620]], 'from where the server got to, not from 0');
  assert.deepEqual(s.map, {});
  await assert.rejects(q.resume('j7', f), /arrived already/);
});


test('late buffered progress from a settled upload cannot restart its watchdog or change its state', async () => {
  let progress;
  const q = new UploadQueue({ cloud: { uploadJob: async (_id, _file, onProgress) => { progress = onProgress; onProgress(100); return { id: 'done' }; } } });
  const cur = { abort: new AbortController(), percent: 0, retrying: false };
  await q._send(cur, 'job', 'file', 100, 0);
  assert.equal(cur.percent, 100);
  progress(10);
  assert.equal(cur.percent, 100, 'a completed attempt ignores late progress');
});
