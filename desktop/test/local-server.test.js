'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createLocalServer } = require('../local-server');
const names = require('@subs/core/names');

test('ported recording, summary, overlay and preset routes work with desktop authentication', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-port-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  for (const [base, style] of [['9月6号10点00分', 'cn'], ['2026-09-05_14-33-05', 'legacy']]) {
    fs.writeFileSync(path.join(rec, names.fileName(base, 'mp3', style)), 'fixture');
    fs.writeFileSync(path.join(rec, names.srtName(base, 'zh', style)), '1\n00:00:01,000 --> 00:00:03,000\n大家好\n');
    fs.writeFileSync(path.join(rec, names.fileName(base, 'summary', style)), '# 学习摘要\n\n- **结论** [00:01]\n');
  }
  let closed = 0, printed;
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    demo: true, token: 'test-token', env: { MP4_AUTO: '0' }, consoleLog() {}, onCloseOverlay() { closed++; },
    async pdfRenderer({ url, out }) {
      const page = await fetch(url);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /summary.js/);
      assert.equal(new URL(url).searchParams.get('token'), 'test-token');
      fs.writeFileSync(out, '%PDF-fixture'); printed = out;
      return { bytes: 12 };
    },
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const get = (p) => fetch(server.base+p, {headers:{cookie:'token=test-token'}});
  const post = (p, data) => fetch(server.base+p, {method:'POST',headers:{cookie:'token=test-token','content-type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await fetch(server.base+'/api/recordings')).status,401);
  const list = await (await get('/api/recordings')).json(); assert.equal(list.length,2);
  assert.ok(list.every(r => r.summary && r.srtTarget));
  const cn=list.find(r=>r.style==='cn');
  assert.equal(cn.mp3,'9月6号10点00分录音.mp3');
  assert.equal((await get('/summary?rec='+encodeURIComponent(cn.base))).status,200);
  assert.match((await get('/recordings/'+encodeURIComponent(cn.summary))).headers.get('content-type'),/text\/markdown/);
  assert.equal((await post('/api/overlay/close',{})).status,200); assert.equal(closed,1);
  const summary=await post('/api/recordings/summary',{base:cn.base}); assert.equal(summary.status,400);
  assert.match((await summary.json()).error,/Settings/);
  assert.equal((await post('/api/recordings/summary',{base:'../missing'})).status,404);
  assert.equal((await post('/api/recordings/summary-pdf',{base:cn.base})).status,200);
  for(let i=0; !printed && i<50; i++) await new Promise(r=>setTimeout(r,20));
  assert.equal(path.basename(printed), cn.base+'AI总结.pdf');
  assert.equal((await get('/recordings/'+encodeURIComponent(path.basename(printed)))).headers.get('content-type'),'application/pdf');
  let settingsEvent;
  server.emitter.on('event',(ev,d)=>{if(ev==='settings') settingsEvent=d;});
  await post('/api/presets',{action:'save',name:'test',patch:{fontSize:99}});
  await post('/api/presets',{action:'apply',name:'test',from:'same-browser'});
  assert.equal(settingsEvent.settings.fontSize,99); assert.equal(settingsEvent.from,null);
  await new Promise(r=>setTimeout(r,350));
});

test('Files lists the whole history and identifies imported files after they are stored locally', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-history-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  for (let i = 0; i < 26; i++) {
    const base = `history-${String(i).padStart(2, '0')}`;
    const audio = path.join(rec, names.fileName(base, 'mp3'));
    fs.writeFileSync(audio, 'fixture');
    fs.utimesSync(audio, new Date(1_000_000 + i * 1000), new Date(1_000_000 + i * 1000));
  }
  fs.writeFileSync(path.join(rec, names.fileName('history-00', 'manifest')), JSON.stringify({ source: 'ja', target: 'zh', importedFrom: 'old-job' }));
  fs.writeFileSync(path.join(rec, names.fileName('history-01', 'manifest')), JSON.stringify({ source: 'yue', target: 'zh', job: 'resubtitle-job' }));
  let importedJobs = { 'legacy-job': 'history-02' };
  let queued;
  const resubtitle = new (require('node:events').EventEmitter)();
  resubtitle.add = (item) => { queued = item; return true; };
  resubtitle.status = () => ({});
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    demo: true, token: 'tk', env: { MP4_AUTO: '0' }, consoleLog() {},
    importedJobs: () => importedJobs,
    onRenameRecording: (oldBase, newBase) => { importedJobs = Object.fromEntries(Object.entries(importedJobs).map(([id, base]) => [id, base === oldBase ? newBase : base])); },
    resubtitle, cloudStatus: () => ({ loggedIn: true }),
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const headers = { cookie: 'token=tk' };
  const list = await (await fetch(`${server.base}/api/recordings`, { headers })).json();
  assert.equal(list.length, 26);
  assert.equal(list.at(-1).base, 'history-00', 'the oldest entry remains available');
  assert.equal(list.at(-1).addedFile, true);
  assert.equal(list.find((r) => r.base === 'history-01').addedFile, false, 're-subtitling a talk does not turn it into an added file');
  assert.equal(list.find((r) => r.base === 'history-02').addedFile, true, 'the earliest imports had a saved job mapping but no manifest');
  assert.equal((await fetch(`${server.base}/api/recordings/cues?base=history-00`, { headers })).status, 200);
  const post = (route, body) => fetch(`${server.base}${route}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/recordings/rename', { base: 'history-02', name: 'renamed-old-import' })).status, 200);
  assert.equal(importedJobs['legacy-job'], 'renamed-old-import');
  assert.equal((await post('/api/recordings/resubtitle', { base: 'renamed-old-import' })).status, 200);
  assert.equal(queued.jobId, 'legacy-job', 'the server already has the uploaded file');
  assert.equal(JSON.parse(fs.readFileSync(names.filePath(rec, 'renamed-old-import', 'manifest'), 'utf8')).importedFrom, 'legacy-job');
});

test('bulk download zips the chosen kinds and delete removes a whole recording set', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-bulk-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  for (const base of ['9月6号10点00分', '9月6号11点00分']) {
    fs.writeFileSync(path.join(rec, names.fileName(base, 'mp3')), 'fixture');
    fs.writeFileSync(path.join(rec, names.srtName(base, 'zh')), '1\n00:00:01,000 --> 00:00:03,000\n大家好。\n');
    fs.writeFileSync(path.join(rec, names.fileName(base, 'summary')), '# 摘要\n');
  }
  fs.writeFileSync(path.join(rec, '9月6号10点00分中文字幕.zh.live.srt'), 'live');
  const trashed = [];
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    demo: true, token: 'tk', env: { MP4_AUTO: '0' }, consoleLog() {}, onTrash: async (paths) => { trashed.push(...paths.map((p) => path.basename(p))); for (const p of paths) fs.rmSync(p); },
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const H = { cookie: 'token=tk' };
  const zip = await fetch(`${server.base}/api/recordings/archive?bases=${encodeURIComponent('9月6号10点00分,9月6号11点00分')}&kinds=subtitles,plain`, { headers: H });
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await zip.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'a zip archive');
  fs.writeFileSync(path.join(root, 'out.zip'), buf);
  const ex = path.join(root, 'extracted'); fs.mkdirSync(ex);
  require('node:child_process').execFileSync('/usr/bin/ditto', ['-x', '-k', path.join(root, 'out.zip'), ex]);
  assert.deepEqual(fs.readdirSync(ex).sort(), ['9月6号10点00分中文字幕.zh.plain.txt', '9月6号10点00分中文字幕.zh.srt', '9月6号11点00分中文字幕.zh.plain.txt', '9月6号11点00分中文字幕.zh.srt']);
  assert.equal(fs.readFileSync(path.join(ex, '9月6号10点00分中文字幕.zh.plain.txt'), 'utf8'), '大家好。\n');
  assert.equal((await fetch(`${server.base}/api/recordings/archive?bases=nope&kinds=mp4`, { headers: H })).status, 400);
  const del = await fetch(`${server.base}/api/recordings/delete`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ bases: ['9月6号10点00分', 'unknown'] }) });
  assert.deepEqual(await del.json(), { ok: true, deleted: 1 });
  assert.deepEqual(trashed.sort(), ['9月6号10点00分AI总结.md', '9月6号10点00分中文字幕.zh.live.srt', '9月6号10点00分中文字幕.zh.srt', '9月6号10点00分录音.mp3']);
  const left = await (await fetch(`${server.base}/api/recordings`, { headers: H })).json();
  assert.deepEqual(left.map((r) => r.base), ['9月6号11点00分']);
});

test('a recording set can be renamed; bad names and clashes are handled', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-rename-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  for (const base of ['9月6号10点00分', '营养讲座']) {
    fs.writeFileSync(path.join(rec, names.fileName(base, 'mp3')), 'fixture');
    fs.writeFileSync(path.join(rec, names.srtName(base, 'zh')), '1\n00:00:01,000 --> 00:00:03,000\n大家好。\n');
  }
  fs.writeFileSync(path.join(rec, '9月6号10点00分中文字幕.zh.live.srt'), 'live');
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    demo: true, token: 'tk', env: { MP4_AUTO: '0' }, consoleLog() {},
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const post = (data) => fetch(`${server.base}/api/recordings/rename`, { method: 'POST', headers: { cookie: 'token=tk', 'content-type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json());
  assert.deepEqual(await post({ base: '9月6号10点00分', name: ' 第一天/上午 讲座 ' }), { ok: true, base: '第一天 上午 讲座' });
  assert.deepEqual(fs.readdirSync(rec).filter((f) => f.startsWith('第一天')).sort(), ['第一天 上午 讲座中文字幕.zh.live.srt', '第一天 上午 讲座中文字幕.zh.srt', '第一天 上午 讲座录音.mp3']);
  assert.equal((await post({ base: '第一天 上午 讲座', name: '营养讲座' })).base, '营养讲座-2', 'a clash gets a numbered name');
  assert.equal((await post({ base: '营养讲座', name: '   ' })).code, 'name_empty');
  assert.equal((await post({ base: 'nope', name: 'x' })).code, 'unknown_recording');
  const list = await (await fetch(`${server.base}/api/recordings`, { headers: { cookie: 'token=tk' } })).json();
  assert.deepEqual(list.map((r) => r.base).sort(), ['营养讲座', '营养讲座-2']);
});

test('an added file can be deleted from the Files list: the route hands the job to the cloud link', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-jobdel-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  const deleted = [];
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    demo: true, token: 'test-token', env: { MP4_AUTO: '0' }, consoleLog() {},
    deleteCloudJob: async (id) => { if (id === 'beef') throw new Error('job is running; wait for it to finish'); deleted.push(id); },
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const post = (p, data) => fetch(server.base + p, { method: 'POST', headers: { cookie: 'token=test-token', 'content-type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await post('/api/cloud/jobs/delete', { id: '43cf947cb2aeedaf' })).status, 200);
  assert.deepEqual(deleted, ['43cf947cb2aeedaf']);
  assert.equal((await post('/api/cloud/jobs/delete', { id: '../x' })).status, 400, 'only a job id');
  const busy = await post('/api/cloud/jobs/delete', { id: 'beef' });
  assert.equal(busy.status, 400);
  assert.match((await busy.json()).error, /running/);
  assert.deepEqual(deleted, ['43cf947cb2aeedaf']);
});

test('Add file asks first: the languages come from the server with Live\'s pair to start from, and the answer is what is sent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-addfile-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  const video = path.join(root, 'talk.mp4'); fs.writeFileSync(video, 'fixture');
  const added = [];
  let loggedIn = true;
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    demo: true, token: 'test-token', env: { MP4_AUTO: '0' }, consoleLog() {},
    cloudStatus: () => ({ loggedIn }),
    cloudLanguages: async () => ({ sources: { yue: '粤语 Cantonese', zh: '普通话 Mandarin', en: 'English' }, targets: { none: 'no translation', zh: '简体中文', en: 'English' } }),
    uploads: Object.assign(new (require('node:events').EventEmitter)(), { add: (x) => { added.push(x); return true; }, status: () => ({ current: null, queue: [], queuedJobs: [], last: null }) }),
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const get = (p) => fetch(server.base + p, { headers: { cookie: 'token=test-token' } });
  const post = (p, data) => fetch(server.base + p, { method: 'POST', headers: { cookie: 'token=test-token', 'content-type': 'application/json' }, body: JSON.stringify(data) });

  const o = await (await get('/api/files/options')).json();
  assert.deepEqual(Object.keys(o.sources), ['yue', 'zh', 'en']);
  assert.ok(o.sourceLang in o.sources && o.targetLang in o.targets, 'Live\'s pair, as file-job languages, is where the sheet starts');

  assert.equal((await post('/api/files/add', { path: video, sourceLang: 'en', targetLang: 'zh', audioOnly: true })).status, 200);
  assert.deepEqual(added[0], { file: video, sourceLang: 'en', targetLang: 'zh', audioOnly: true }, 'the file goes in the languages confirmed, not in Live\'s');
  assert.equal((await post('/api/files/add', { path: video, sourceLang: 'en', targetLang: 'none' })).status, 200);
  assert.equal(added[1].targetLang, 'none');
  assert.equal((await post('/api/files/add', { path: video })).status, 200);
  assert.equal(added[2].sourceLang, o.sourceLang, 'with no answer it is Live\'s pair, as before');

  loggedIn = false;
  const out = await get('/api/files/options');
  assert.equal(out.status, 400);
  assert.equal((await out.json()).code, 'login_first');
});

test('re-subtitling asks in the recording\'s own languages, sends the ones confirmed, and the earlier versions are listed and served', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-again-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  const base = '9月5号14点33分';
  fs.writeFileSync(path.join(rec, names.fileName(base, 'mp3', 'cn')), 'audio');
  fs.writeFileSync(path.join(rec, names.fileName(base, 'manifest', 'cn')), JSON.stringify({ base, source: 'en', target: 'ja', job: 'abc123' }));
  fs.writeFileSync(path.join(rec, names.srtName(base, 'ja')), '1\n00:00:01,000 --> 00:00:03,000\nおはよう\n');
  const v1 = path.join(rec, `${base}旧版本`, '1 英文→中文'); fs.mkdirSync(v1, { recursive: true });
  fs.writeFileSync(path.join(v1, names.srtName(base, 'zh')), 'ZH v1');
  fs.writeFileSync(path.join(v1, 'version.json'), JSON.stringify({ source: 'en', target: 'zh', keptAt: 1790000000000 }));
  const asked = [];
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    demo: true, token: 'test-token', env: { MP4_AUTO: '0' }, consoleLog() {},
    cloudStatus: () => ({ loggedIn: true }),
    cloudLanguages: async () => ({ sources: { yue: '粤语', zh: '普通话', en: 'English', ja: '日本語' }, targets: { none: 'no translation', zh: '简体中文', en: 'English', ja: '日本語' } }),
    uploads: Object.assign(new (require('node:events').EventEmitter)(), { add: () => true, status: () => ({ current: null, queue: [], queuedJobs: [], last: null }) }),
    resubtitle: Object.assign(new (require('node:events').EventEmitter)(), { add: (x) => { asked.push(x); return true; }, status: () => ({ current: null, queue: [], last: null }) }),
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const get = (p) => fetch(server.base + p, { headers: { cookie: 'token=test-token' } });
  const post = (p, data) => fetch(server.base + p, { method: 'POST', headers: { cookie: 'token=test-token', 'content-type': 'application/json' }, body: JSON.stringify(data) });

  const o = await (await get(`/api/files/options?base=${encodeURIComponent(base)}`)).json();
  assert.deepEqual([o.sourceLang, o.targetLang, o.jobId], ['en', 'ja', 'abc123'], 'the sheet starts from what the recording is, not from Live');

  assert.equal((await post('/api/recordings/resubtitle', { base, sourceLang: 'en', targetLang: 'zh' })).status, 200);
  assert.deepEqual(asked[0], { base, dir: rec, sourceLang: 'en', targetLang: 'zh', jobId: 'abc123' });
  assert.equal((await post('/api/recordings/resubtitle', { base })).status, 200);
  assert.deepEqual([asked[1].sourceLang, asked[1].targetLang], ['en', 'ja'], 'with nothing confirmed (a selection of recordings), each keeps its own languages');

  const [r] = await (await get('/api/recordings')).json();
  assert.equal(r.resubtitled, true);
  assert.deepEqual(r.versions.map((v) => [v.n, v.source, v.target, v.files]), [[1, 'en', 'zh', [names.srtName(base, 'zh')]]]);
  const file = await get(`/recording-versions/${encodeURIComponent(base)}/${encodeURIComponent(r.versions[0].folder)}/${encodeURIComponent(names.srtName(base, 'zh'))}`);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), 'ZH v1');
  assert.equal((await get(`/recording-versions/${encodeURIComponent(base)}/..%2F..%2F/${encodeURIComponent(names.fileName(base, 'mp3', 'cn'))}`)).status, 404, 'only what is in a version folder');
});

test('Try again: the routes behind the button hand an upload, and a failed job, back to be run again', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-retry-'));
  const rec = path.join(root, 'recordings'); fs.mkdirSync(rec);
  const calls = [];
  const server = await createLocalServer({
    webDir: path.resolve(__dirname, '../../web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(root, 'data'), recordingsDir: rec, transcriptsDir: path.join(root, 'transcripts'),
    demo: true, token: 'test-token', env: { MP4_AUTO: '0' }, consoleLog() {},
    cloudStatus: () => ({ loggedIn: true }),
    retryCloudJob: async (id) => { calls.push(`job ${id}`); if (id === 'dead') throw new Error('job is not failed'); },
    uploads: Object.assign(new (require('node:events').EventEmitter)(), {
      status: () => ({ current: null, queue: [], queuedJobs: [], last: null }),
      retryLast: () => { calls.push('last'); return true; },
      resume: async (jobId, file) => { calls.push(`resume ${jobId} ${file || '-'}`); if (!file) throw Object.assign(new Error('this app no longer knows where that file is'), { code: 'need_file' }); return true; },
    }),
  });
  t.after(async () => { await server.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const post = (p, data) => fetch(server.base + p, { method: 'POST', headers: { cookie: 'token=test-token', 'content-type': 'application/json' }, body: JSON.stringify(data) });

  assert.equal((await post('/api/files/retry', {})).status, 200);
  const need = await post('/api/files/retry', { jobId: 'abc123' });
  assert.equal(need.status, 400);
  assert.equal((await need.json()).code, 'need_file', 'the window is told to ask for the file');
  assert.equal((await post('/api/files/retry', { jobId: 'abc123', path: '/tmp/talk.mp4' })).status, 200);
  assert.equal((await post('/api/cloud/jobs/retry', { id: 'abc123' })).status, 200);
  const refused = await post('/api/cloud/jobs/retry', { id: 'dead' });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /not failed/);
  assert.equal((await post('/api/cloud/jobs/retry', { id: '../x' })).status, 400);
  assert.deepEqual(calls, ['last', 'resume abc123 -', 'resume abc123 /tmp/talk.mp4', 'job abc123', 'job dead']);
});
