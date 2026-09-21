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
  fs.writeFileSync(names.srtPath(dir, base, 'zh'), 'LIVE ZH');
  fs.writeFileSync(names.srtPath(dir, base, 'yue'), 'LIVE YUE');
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
  assert.deepEqual(done.files, [names.srtName(base, 'yue'), names.srtName(base, 'zh')]);
  assert.deepEqual(cloud.calls.create, [{ filename: names.fileName(base, 'mp3'), size: 1234, sourceLang: 'yue', targetLang: 'zh' }]);
  assert.equal(cloud.calls.upload[0][1], names.filePath(dir, base, 'mp3'));
  assert.deepEqual(cloud.calls.downloads, ['talk.yue.srt', 'talk.zh.srt']);
  assert.equal(fs.readFileSync(names.srtPath(dir, base, 'zh'), 'utf8'), 'CLOUD talk.zh.srt');
  assert.equal(fs.readFileSync(names.srtPath(dir, base, 'yue'), 'utf8'), 'CLOUD talk.yue.srt');
  assert.equal(fs.readFileSync(liveName(names.srtPath(dir, base, 'zh')), 'utf8'), 'LIVE ZH');
  assert.equal(fs.readFileSync(liveName(names.srtPath(dir, base, 'yue')), 'utf8'), 'LIVE YUE');
  assert.ok(!fs.existsSync(names.filePath(dir, base, 'mp4')), 'old MP4 moved aside so Make MP4 reappears');
  assert.equal(fs.readFileSync(liveName(names.filePath(dir, base, 'mp4')), 'utf8'), 'OLD MP4');
  assert.ok(stages.some((s) => s.startsWith('uploading:')) && stages.includes('recognizing:30') && stages.includes('translating:60') && stages.includes('downloading:100'), stages.join(' '));
  assert.equal(q.status().last.ok, true);
  // the .live.srt backups are not mistaken for recordings
  assert.equal(names.parse(path.basename(liveName(names.srtPath(dir, base, 'zh')))), null);
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
  assert.equal(fs.readFileSync(names.srtPath(dir, base, 'zh'), 'utf8'), 'LIVE ZH');
  assert.ok(fs.existsSync(names.filePath(dir, base, 'mp4')));
  assert.equal(q.status().current, null);
  assert.equal(q.status().last.ok, false);
});

// ---- made again, in other languages: nothing made before is lost, and a file the server has is not sent twice
const names2 = require('@subs/core/names');
const { listVersions, versionsDir } = require('../lib/resubtitle');

test('a recording re-subtitled again, in another language, keeps the earlier subtitles, their MP4 and the summary as a version', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resub-versions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = '9月5号14点33分';
  // a recording that came from an added file: English heard, Chinese subtitles, made by job j1 — no talk, so nothing is "live"
  fs.writeFileSync(names2.filePath(dir, base, 'mp3'), 'audio');
  fs.writeFileSync(path.join(dir, names2.fileName(base, 'manifest', 'cn')), JSON.stringify({ base, source: 'en', target: 'zh', importedFrom: 'j1' }));
  fs.writeFileSync(path.join(dir, names2.srtName(base, 'en')), 'EN v1');
  fs.writeFileSync(path.join(dir, names2.srtName(base, 'zh')), 'ZH v1 (edited by hand)');
  fs.writeFileSync(path.join(dir, names2.srtName(base, 'zh').replace(/\.srt$/, '.plain.txt')), 'ZH v1 plain');
  fs.writeFileSync(names2.filePath(dir, base, 'mp4'), 'MP4 of v1');
  fs.writeFileSync(names2.filePath(dir, base, 'summary'), '# summary of v1');

  const calls = [];
  const cloud = {
    createJob: async () => { calls.push('create'); return { id: 'jNew' }; },
    uploadJob: async () => { calls.push('upload'); },
    regenerateJob: async (id, langs) => { calls.push(`regenerate ${id} ${langs.sourceLang}→${langs.targetLang}`); return { id, status: 'queued' }; },
    getJob: async (id) => ({ id, status: 'done', files: ['talk.en.srt', 'talk.ja.srt'] }),
    downloadJobFile: async (id, name, dest) => { fs.writeFileSync(dest, `${name} from ${id}`); },
  };
  const q = new ResubtitleQueue({ cloud, pollMs: 1 });
  const jobs = [];
  q.on('job', (j) => jobs.push(j));
  q.add({ base, dir, sourceLang: 'en', targetLang: 'ja', jobId: 'j1' });
  await new Promise((resolve, reject) => { q.once('done', resolve); q.once('error', (e) => reject(new Error(e.error))); });

  assert.deepEqual(calls, ['regenerate j1 en→ja'], 'the server has the file: nothing is created or uploaded');
  assert.equal(fs.readFileSync(path.join(dir, names2.srtName(base, 'ja')), 'utf8'), 'talk.ja.srt from j1');
  assert.deepEqual(names2.languagesOf(dir, base), { source: 'en', target: 'ja' }, 'the recording is in its new languages');
  assert.equal(JSON.parse(fs.readFileSync(names2.filePath(dir, base, 'manifest'), 'utf8')).job, 'j1');
  assert.equal(fs.existsSync(path.join(dir, names2.srtName(base, 'zh'))), false, 'the Chinese subtitles are no longer beside it…');
  const [v] = listVersions(dir, base);
  assert.deepEqual([v.n, v.source, v.target], [1, 'en', 'zh']);
  assert.equal(fs.readFileSync(path.join(versionsDir(dir, base), v.folder, names2.srtName(base, 'zh')), 'utf8'), 'ZH v1 (edited by hand)', '…they are a version, edits and all');
  assert.ok(v.files.includes(names2.srtName(base, 'en')) && v.files.some((f) => f.endsWith('.plain.txt')) && v.files.includes(names2.fileName(base, 'mp4', 'cn')), v.files.join(', '));
  assert.ok(v.files.includes(names2.fileName(base, 'summary', 'cn')) && fs.existsSync(names2.filePath(dir, base, 'summary')), 'the summary is copied: the recording still shows it');
  assert.ok(!fs.readdirSync(dir).some((f) => /\.live\./.test(f)), 'nothing here was the talk\'s own');

  // and once more: a second version, the first untouched
  q.add({ base, dir, sourceLang: 'en', targetLang: 'ja', jobId: 'j1' });
  await new Promise((resolve) => q.once('done', resolve));
  assert.deepEqual(listVersions(dir, base).map((x) => `${x.n}:${x.target}`), ['1:zh', '2:ja']);
});

test('a file the server no longer has is sent again; a talk\'s own subtitles still get their .live. name first', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resub-gone-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = '9月6号10点00分';
  fs.writeFileSync(names2.filePath(dir, base, 'mp3'), 'audio');
  fs.writeFileSync(path.join(dir, names2.fileName(base, 'manifest', 'cn')), JSON.stringify({ base, source: 'yue', target: 'zh' }));
  fs.writeFileSync(path.join(dir, names2.srtName(base, 'zh')), 'ZH from the talk');
  const calls = [];
  const cloud = {
    createJob: async () => { calls.push('create'); return { id: 'jNew' }; },
    uploadJob: async () => { calls.push('upload'); },
    regenerateJob: async () => { calls.push('regenerate'); throw Object.assign(new Error('no such job'), { status: 404 }); },
    getJob: async (id) => ({ id, status: 'done', files: ['a.yue.srt', 'a.en.srt'] }),
    downloadJobFile: async (id, name, dest) => { fs.writeFileSync(dest, name); },
  };
  const q = new ResubtitleQueue({ cloud, pollMs: 1 });
  const jobs = [];
  q.on('job', (j) => jobs.push(j));
  q.add({ base, dir, sourceLang: 'yue', targetLang: 'en', jobId: 'jOld' });
  await new Promise((resolve, reject) => { q.once('done', resolve); q.once('error', (e) => reject(new Error(e.error))); });
  assert.deepEqual(calls, ['regenerate', 'create', 'upload']);
  assert.deepEqual(jobs, [{ jobId: 'jNew', base }], 'the new job is said to be this recording, so it is not imported as another');
  assert.equal(fs.readFileSync(path.join(dir, names2.srtName(base, 'zh').replace(/\.srt$/, '.live.srt')), 'utf8'), 'ZH from the talk');
  assert.deepEqual(listVersions(dir, base), [], 'the talk\'s own went to .live., so there is no version to make');
  assert.deepEqual(names2.languagesOf(dir, base), { source: 'yue', target: 'en' });
});

test('a status check or a download that fails is tried again: the server goes on with the work whether or not it is watched', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resub-patient-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = '9月7号09点00分';
  fs.writeFileSync(names2.filePath(dir, base, 'mp3'), 'audio');
  fs.writeFileSync(path.join(dir, names2.fileName(base, 'manifest', 'cn')), JSON.stringify({ base, source: 'zh', target: 'zh', importedFrom: 'j1' }));
  fs.writeFileSync(path.join(dir, names2.srtName(base, 'zh')), 'ZH v1');
  let polls = 0; let downloads = 0;
  const aborted = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }); // what a VPN that blinks looks like from here
  const cloud = {
    regenerateJob: async (id) => ({ id, status: 'queued' }),
    getJob: async (id) => { polls++; if (polls === 3 || polls === 4) throw aborted(); return polls < 6 ? { id, status: 'translating', progress: 50, source_lang: 'zh', target_lang: 'zh' } : { id, status: 'done', source_lang: 'ja', target_lang: 'en', files: ['a.ja.srt', 'a.en.srt'] }; },
    downloadJobFile: async (id, name, dest) => { if (++downloads === 1) throw new Error('fetch failed'); fs.writeFileSync(dest, name); },
  };
  const q = new ResubtitleQueue({ cloud, pollMs: 1 });
  q.add({ base, dir, sourceLang: 'ja', targetLang: 'en', jobId: 'j1' });
  await new Promise((resolve, reject) => { q.once('done', resolve); q.once('error', (e) => reject(new Error(e.error))); });
  assert.ok(polls >= 6 && downloads === 3, `${polls} polls, ${downloads} downloads`);
  assert.equal(fs.readFileSync(path.join(dir, names2.srtName(base, 'en')), 'utf8'), 'a.en.srt');
  assert.deepEqual(names2.languagesOf(dir, base), { source: 'ja', target: 'en' });

  // what the server refuses is an answer, not an outage
  const gone = new ResubtitleQueue({ cloud: { ...cloud, getJob: async () => { throw Object.assign(new Error('no such job'), { status: 404 }); }, regenerateJob: async () => { throw new Error('never asked'); }, createJob: async () => { throw Object.assign(new Error('the file subtitling hours of this month are used up'), { status: 403 }); } }, pollMs: 1 });
  gone.add({ base, dir, sourceLang: 'ja', targetLang: 'zh', jobId: 'j1' });
  const err = await new Promise((resolve) => gone.once('error', resolve));
  assert.match(err.error, /used up/);
});

test('subtitles the server already made in the languages asked for, and the Mac never fetched, are fetched — not made a third time', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resub-fetch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = 'SPSA 08';
  fs.writeFileSync(names2.filePath(dir, base, 'mp3'), 'audio');
  fs.writeFileSync(path.join(dir, names2.fileName(base, 'manifest', 'cn')), JSON.stringify({ base, source: 'zh', target: 'zh', importedFrom: 'c0ba' }));
  fs.writeFileSync(path.join(dir, names2.srtName(base, 'zh')), 'ZH as imported');
  const calls = [];
  const cloud = {
    regenerateJob: async (id, l) => { calls.push(`regenerate ${l.sourceLang}→${l.targetLang}`); return { id, status: 'queued' }; },
    getJob: async (id) => ({ id, status: 'done', source_lang: 'ja', target_lang: 'en', files: ['v.ja.srt', 'v.en.srt'] }),
    downloadJobFile: async (id, name, dest) => { calls.push(`download ${name}`); fs.writeFileSync(dest, name); },
  };
  const q = new ResubtitleQueue({ cloud, pollMs: 1 });
  q.add({ base, dir, sourceLang: 'ja', targetLang: 'en', jobId: 'c0ba' });
  await new Promise((resolve, reject) => { q.once('done', resolve); q.once('error', (e) => reject(new Error(e.error))); });
  assert.deepEqual(calls, ['download v.ja.srt', 'download v.en.srt'], 'the server was not asked to make them again');
  assert.deepEqual(names2.languagesOf(dir, base), { source: 'ja', target: 'en' });
  assert.deepEqual(listVersions(dir, base).map((v) => `${v.n}:${v.source}→${v.target}`), ['1:zh→zh'], 'and what the Mac had is kept');

  // now the Mac is where the server is: asking for the same languages again really does make them again
  q.add({ base, dir, sourceLang: 'ja', targetLang: 'en', jobId: 'c0ba' });
  await new Promise((resolve) => q.once('done', resolve));
  assert.equal(calls.filter((c) => c.startsWith('regenerate')).length, 1);
});
