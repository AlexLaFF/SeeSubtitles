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
    fs.writeFileSync(path.join(rec, names.fileName(base, 'zh', style)), '1\n00:00:01,000 --> 00:00:03,000\n大家好\n');
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
  assert.ok(list.every(r => r.summary && r.zh));
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
