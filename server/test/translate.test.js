'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { translateSentences, distribute } = require('../lib/translate');
const { buildCues } = require('../lib/subtitles');
const { openDb } = require('../lib/db');
const { JobRunner } = require('../lib/jobs');
const tokenhub = require('../lib/tokenhub');
const http = require('node:http');

test('sentences are batched per request and split back by line', async () => {
  const calls = [];
  const call = async (p) => { calls.push(p); return p.text.split('\n').map((l) => `T(${l})`).join('\n'); };
  const out = await translateSentences(['a', 'b', 'c'], { call, source: 'yue', target: 'zh' });
  assert.deepEqual(out, ['T(a)', 'T(b)', 'T(c)']);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].source, calls[0].target], ['yue', 'zh']);
});

test('a line-count mismatch falls back to one request per sentence so alignment is never guessed', async () => {
  const calls = [];
  const call = async (p) => { calls.push(p.text); return p.text.includes('\n') ? 'merged into one line' : `T(${p.text})`; };
  const progress = [];
  const out = await translateSentences(['x', 'y'], { call, source: 'zh', target: 'en', onProgress: (d, t) => progress.push([d, t]) });
  assert.deepEqual(out, ['T(x)', 'T(y)']);
  assert.deepEqual(calls, ['x\ny', 'x', 'y']);
  assert.deepEqual(progress, [[2, 2]]);
});

test('rate-limit errors are retried, auth errors are not', async () => {
  let n = 0;
  const flaky = async () => { if (n++ < 2) throw new Error('RequestLimitExceeded'); return 'ok'; };
  assert.deepEqual(await translateSentences(['s'], { call: flaky, source: 'zh', target: 'en', sleep: async () => {} }), ['ok']);
  await assert.rejects(translateSentences(['s'], { call: async () => { throw new Error('AuthFailure.UnauthorizedOperation nope'); }, source: 'zh', target: 'en', sleep: async () => {} }), /translation: AuthFailure/);
  await assert.rejects(translateSentences(['s'], { call: async () => { throw new tokenhub.TokenHubError(401, 'invalid api key'); }, source: 'zh', target: 'en', sleep: async () => {} }), /HTTP 401/);
});

test('distribute shares a translation over cues at punctuation, proportionally to cue length', () => {
  assert.deepEqual(distribute('我们昨天去看了医生，他说没什么事，不用吃药。', [8, 7, 6]), ['我们昨天去看了医生，', '他说没什么事，', '不用吃药。']);
  assert.deepEqual(distribute('Only one cue.', [5]), ['Only one cue.']);
  assert.deepEqual(distribute('We went to the doctor yesterday, and he said it was nothing.', [12, 12]), ['We went to the doctor yesterday,', 'and he said it was nothing.']);
  assert.deepEqual(distribute('', [3, 3]), ['', '']);
  const parts = distribute('短句', [5, 5, 5]); // shorter than the cue count: every piece still gets something or empty, nothing lost
  assert.equal(parts.join(''), '短句');
});

test('job runner translates whole sentences and shares them over the cues cut from each sentence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hy-jobs-'));
  const db = openDb(root);
  try {
    const seen = [];
    const jobs = new JobRunner({ db, dir: path.join(root, 'jobs'), creds: null, translate: async (p) => { seen.push(p.text); return p.text.split('\n').map((l) => `〔${l}〕`).join('\n'); } });
    // one long Cantonese sentence (cut into two cues) and one short one
    const long = '我哋琴日去咗睇醫生佢話冇乜嘢唔使食藥咁我哋就返屋企。';
    const words = (t, base) => [...t].map((ch, i) => ({ Word: ch, OffsetStartMs: i * 200, OffsetEndMs: i * 200 + 180 }));
    const cues = buildCues([
      { FinalSentence: long, StartMs: 0, EndMs: 6000, Words: words(long, 0) },
      { FinalSentence: '多謝。', StartMs: 7000, EndMs: 8000, Words: words('多謝。', 7000) },
    ]);
    assert.ok(cues.length >= 3, `expected ≥ 3 cues, got ${cues.length}`);
    assert.deepEqual([...new Set(cues.map((c) => c.sentence))], [0, 1]);
    await jobs._translate('none', cues, 'yue', 'zh');
    assert.deepEqual(seen, [`${long}\n多謝。`], 'sentences, not cues, were sent');
    const first = cues.filter((c) => c.sentence === 0);
    assert.equal(first.map((c) => c.trans).join(''), `〔${long}〕`, 'the sentence translation is shared over its cues without loss');
    assert.ok(first.every((c) => c.trans), 'every cue of the sentence got a piece');
    assert.equal(cues[cues.length - 1].trans, '〔多謝。〕');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('job runner picks TokenHub when a key is given, else the legacy Hunyuan API', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hy-backend-'));
  const db = openDb(root);
  try {
    const a = new JobRunner({ db, dir: path.join(root, 'a'), creds: null, tokenhubKey: 'k' });
    assert.deepEqual([a.backend, a.model], ['tokenhub', 'hy-mt2-pro']);
    const b = new JobRunner({ db, dir: path.join(root, 'b'), creds: null, tokenhubKey: 'k', model: 'hy-mt2-lite' });
    assert.equal(b.model, 'hy-mt2-lite');
    const c = new JobRunner({ db, dir: path.join(root, 'c'), creds: null });
    assert.deepEqual([c.backend, c.model], ['hunyuan-legacy', 'hunyuan-translation']);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TokenHub client posts the documented body with a Bearer key and returns the translated text', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      if (seen.length === 1) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: ' 我们昨天去看了医生。 ' }, finish_reason: 'stop' }], source: 'yue', target: 'zh', usage: {} })); }
      else { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'invalid api key' } })); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // tokenhub.translate uses https; point it at the plain-http test server through the module's request hook
  const httpsMod = require('node:https');
  const orig = httpsMod.request;
  httpsMod.request = (url, opts, cb) => http.request(url, opts, cb);
  try {
    const out = await tokenhub.translate('KEY', { text: '我哋琴日去咗睇醫生。', source: 'yue', target: 'zh' }, { baseUrl: base });
    assert.equal(out, '我们昨天去看了医生。');
    assert.equal(seen[0].url, '/v1/api/translations');
    assert.equal(seen[0].auth, 'Bearer KEY');
    assert.deepEqual(seen[0].body, { model: 'hy-mt2-pro', text: '我哋琴日去咗睇醫生。', target: 'zh', source: 'yue', stream: false });
    await assert.rejects(tokenhub.translate('KEY', { text: 'x', target: 'zh' }, { baseUrl: base }), (err) => err instanceof tokenhub.TokenHubError && err.status === 401 && /invalid api key/.test(err.message));
  } finally {
    httpsMod.request = orig;
    server.close();
  }
});
