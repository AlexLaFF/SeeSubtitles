'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { GummyStream } = require('../lib/gummy-stream');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 150; i++) { if (fn()) return; await wait(10); } assert.ok(fn(), 'timed out'); }

async function harness(t, { fetchImpl } = {}) {
  const sockets = [];
  const starts = [];
  const audio = [];
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.once('listening', r));
  wss.on('connection', (ws) => {
    sockets.push(ws);
    ws.on('message', (data, binary) => {
      if (binary) return audio.push(Buffer.from(data));
      const m = JSON.parse(data);
      starts.push(m);
      ws.send(JSON.stringify({ header: { event: 'task-started' } }));
    });
  });
  const requests = [];
  const stream = new GummyStream({ dashscopeKey: 'test-only', tokenhubKey: 'test-only', target: 'en', rollMs: 0,
    dashscopeUrl: `ws://127.0.0.1:${wss.address().port}`,
    fetchImpl: fetchImpl || (async (_url, opts) => {
      requests.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'English translation' } }] }) };
    }) });
  const results = [];
  stream.on('result', (r) => results.push(r));
  t.after(async () => { stream.stop(); for (const ws of sockets) ws.terminate(); await new Promise((r) => wss.close(r)); });
  stream.start();
  const emit = (sentence, ws = sockets.at(-1)) => ws.send(JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { transcription: sentence } } }));
  await until(() => stream.status().state === 'ready');
  return { stream, sockets, starts, audio, requests, results, emit };
}

test('Gummy uses recognition only, detects the source, and maps translated cues onto capture time', async (t) => {
  const h = await harness(t);
  assert.equal(h.starts[0].payload.parameters.translation_enabled, false);
  assert.equal(h.starts[0].payload.parameters.source_language, 'auto');
  const capture = Date.now();
  h.stream.push(Buffer.alloc(6400), { t0: capture });
  h.emit({ begin_time: 0, end_time: 200, text: '日本語', sentence_end: false });
  h.emit({ begin_time: 0, end_time: 200, text: '日本語です', sentence_end: true });
  h.emit({ begin_time: 0, end_time: 200, text: '日本語です', sentence_end: true });
  await until(() => h.results.some((r) => r.sentenceEnd));
  const final = h.results.find((r) => r.sentenceEnd);
  assert.equal(final.wallStart, capture);
  assert.equal(final.wallEnd, capture + 200);
  assert.equal(final.targetText, 'English translation');
  assert.equal(h.requests.length, 1, 'a duplicate final is not billed for translation twice');
  assert.equal(h.requests[0].source, undefined, 'Hunyuan detects source by omission');
  assert.equal(h.results[0].sentenceId, final.sentenceId);
});

test('a closed upstream reconnects with distinct cue IDs and a bounded audio queue', async (t) => {
  const h = await harness(t);
  const original = h.starts[0].header.task_id;
  h.sockets[0].terminate();
  await until(() => h.stream.status().state === 'reconnecting');
  for (let i = 0; i < 8; i++) h.stream.push(Buffer.alloc(6400, i), { t0: 1000 + 200 * i });
  assert.equal(h.stream.status().droppedBytes, 3 * 6400);
  await until(() => h.starts.length === 2 && h.stream.status().state === 'ready');
  assert.notEqual(h.starts[1].header.task_id, original);
  await until(() => h.audio.length >= 5);
  assert.deepEqual(h.audio.slice(-5).map((b) => b[0]), [3, 4, 5, 6, 7]);
});

test('translations from a superseded target never update the new talk', async (t) => {
  let resolve;
  const h = await harness(t, { fetchImpl: () => new Promise((r) => { resolve = r; }) });
  h.emit({ begin_time: 0, end_time: 200, text: 'hello', sentence_end: true });
  await until(() => resolve);
  h.stream.setOptions({ target: 'zh' });
  resolve({ ok: true, json: async () => ({ choices: [{ message: { content: 'old target' } }] }) });
  await wait(30);
  assert.equal(h.results.filter((r) => r.sentenceEnd).length, 0);
  await until(() => h.starts.length === 2 && h.stream.status().state === 'ready');
});
