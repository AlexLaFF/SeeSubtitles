'use strict';
// 百炼 file recognition against a stand-in: the upload, the asynchronous task and the transcript, and the reshaping
// of its sentences into the form Tencent returns so that cues come out the same whichever service listened.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dashscope = require('../lib/dashscope');
const { buildCues } = require('../lib/subtitles');

const SENTENCES = [
  { begin_time: 1000, end_time: 3200, text: 'あの髪の長い子ね。', words: [
    { begin_time: 1000, end_time: 1400, text: 'あの' }, { begin_time: 1400, end_time: 2200, text: '髪の長い' }, { begin_time: 2200, end_time: 3200, text: '子ね。' }] },
  { begin_time: 3900, end_time: 6000, text: '彼女で問題ないと思います。', words: [] },
];

/** A 百炼 that answers as the real one does: policy, OSS upload, submit, one poll still running, then the transcript. */
function standIn() {
  const seen = { uploads: 0, submits: [], polls: 0 };
  let base = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, base);
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/v1/uploads') {
      assert.equal(req.headers.authorization, 'Bearer test-key');
      return reply(200, { data: { upload_host: `${base}/oss`, upload_dir: `dashscope-instant/acct/2026-09-22/${url.searchParams.get('model')}`, policy: 'p', signature: 's', oss_access_key_id: 'id', x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true' } });
    }
    if (url.pathname === '/oss') {
      let n = 0; req.on('data', (c) => { n += c.length; });
      return req.on('end', () => { seen.uploads++; seen.uploadBytes = n; if (seen.uploads > 1) { res.writeHead(409); return res.end('<Error><Code>FileAlreadyExists</Code></Error>'); } res.writeHead(200); res.end(); });
    }
    if (url.pathname === '/api/v1/services/audio/asr/transcription') {
      let body = ''; req.on('data', (c) => { body += c; });
      return req.on('end', () => { seen.submits.push({ headers: req.headers, body: JSON.parse(body) }); reply(200, { output: { task_id: 'task-1', task_status: 'PENDING' } }); });
    }
    if (url.pathname === '/api/v1/tasks/task-1') {
      seen.polls++;
      if (seen.polls === 1) return reply(200, { output: { task_id: 'task-1', task_status: 'RUNNING' } });
      return reply(200, { output: { task_id: 'task-1', task_status: 'SUCCEEDED', results: [{ file_url: 'oss://x', transcription_url: `${base}/transcript.json`, subtask_status: 'SUCCEEDED' }] } });
    }
    if (url.pathname === '/transcript.json') return reply(200, { file_url: 'oss://x', transcripts: [{ channel_id: 0, sentences: SENTENCES }] });
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve({ base, seen, close: () => server.close() }); }));
}

test('a file goes up, is recognised and comes back in the shape cues are cut from', async () => {
  const s = await standIn();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
    const file = path.join(dir, 'audio.mp3');
    fs.writeFileSync(file, Buffer.alloc(3000, 7));
    const url = await dashscope.upload('test-key', 'fun-asr', file, { baseUrl: s.base });
    assert.equal(url, 'oss://dashscope-instant/acct/2026-09-22/fun-asr/audio.mp3');
    assert.ok(s.seen.uploadBytes > 3000, 'the file went up in the form');
    // a second upload of the same object is answered 409 and counts as landed
    assert.equal(await dashscope.upload('test-key', 'fun-asr', file, { baseUrl: s.base }), url);

    const taskId = await dashscope.submit('test-key', { model: 'fun-asr', url, lang: 'ja', baseUrl: s.base });
    assert.equal(taskId, 'task-1');
    const sub = s.seen.submits[0];
    assert.equal(sub.headers['x-dashscope-async'], 'enable');
    assert.equal(sub.headers['x-dashscope-ossresourceresolve'], 'enable');
    assert.deepEqual(sub.body, { model: 'fun-asr', input: { file_urls: [url] }, parameters: { language_hints: ['ja'] } });

    assert.equal((await dashscope.status('test-key', taskId, { baseUrl: s.base })).status, 'RUNNING');
    const done = await dashscope.status('test-key', taskId, { baseUrl: s.base });
    assert.equal(done.status, 'SUCCEEDED');
    const detail = dashscope.toResultDetail(done.sentences);
    assert.deepEqual(detail[0], { StartMs: 1000, EndMs: 3200, FinalSentence: 'あの髪の長い子ね。', SpeakerId: null,
      Words: [{ Word: 'あの', OffsetStartMs: 0, OffsetEndMs: 400 }, { Word: '髪の長い', OffsetStartMs: 400, OffsetEndMs: 1200 }, { Word: '子ね。', OffsetStartMs: 1200, OffsetEndMs: 2200 }] });
    assert.deepEqual(detail[1].Words, [], 'a sentence without words keeps its own span');
    const cues = buildCues(detail);
    assert.deepEqual(cues.map((c) => [c.text, c.start, c.end]), [['あの髪の長い子ね。', 1000, 3200], ['彼女で問題ないと思います。', 3900, 6000]]);
  } finally { s.close(); }
});

test('a task that failed is an error with 百炼\'s reason', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ subtask_status: 'FAILED', message: 'A valid file URL is required.' }] } })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(dashscope.status('k', 't', { baseUrl: `http://127.0.0.1:${server.address().port}` }), /recognition failed: A valid file URL is required/);
  } finally { server.close(); }
});

test('Japanese goes to 百炼 only when the server has the key', () => {
  const { JobRunner } = require('../lib/jobs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-'));
  const db = { run() {}, get() { return null; }, all() { return []; } };
  const withKey = new JobRunner({ db, dir, creds: null, log() {}, translate: async () => '', dashscopeKey: 'k' });
  const without = new JobRunner({ db, dir, creds: null, log() {}, translate: async () => '' });
  assert.equal(withKey.engineFor('ja'), 'fun-asr');
  assert.equal(without.engineFor('ja'), '16k_ja');
  assert.equal(withKey.engineFor('zh'), '16k_zh', 'Chinese stays with Tencent until it has been compared');
  assert.equal(dashscope.isAlibaba('fun-asr'), true);
  assert.equal(dashscope.isAlibaba('16k_ja'), false);
});
