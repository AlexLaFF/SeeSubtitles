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
