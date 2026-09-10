'use strict';
// The fallback exists so the account paying the Tencent bill is not held hostage by one server. These tests
// hold the line that separates a safety net from a hole: an unreachable server is a reason to go direct, a
// server that has refused is not, and an account with no right to a direct connection never gets one.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { FailoverStream } = require('../failover-stream');

/** A stand-in with the stream interface, driven by hand. */
function fake(name, made) {
  const s = new EventEmitter();
  s.name = name;
  s.started = false;
  s.pushed = [];
  s.start = () => { s.started = true; };
  s.stop = () => { s.started = false; };
  s.push = (c) => s.pushed.push(c);
  s.setOptions = () => {};
  s.reconnect = () => {};
  s.status = () => ({ state: s.state || 'idle', name });
  s.fail = () => { s.state = 'reconnecting'; s.emit('status', s.status()); };
  s.ready = () => { s.state = 'ready'; s.emit('status', s.status()); };
  s.refuse = (code) => s.emit('server-error', { code, message: code });
  made.push(s);
  return s;
}

function harness({ allowed = true, withDirect = true } = {}) {
  const made = [];
  const logs = [];
  const f = new FailoverStream({
    viaServer: () => fake('viaServer', made),
    direct: withDirect ? () => fake('direct', made) : null,
    directAllowed: () => allowed,
    log: (t) => logs.push(t),
  });
  return { f, made, logs, last: () => made[made.length - 1] };
}

test('a server that cannot be reached sends a trusted account to the direct route', () => {
  const h = harness();
  h.f.start();
  assert.equal(h.f.status().route, 'viaServer');
  assert.equal(h.f.status().metered, true);

  h.last().fail();
  assert.equal(h.f.status().route, 'viaServer', 'one failure is not enough');
  h.last().fail();

  assert.equal(h.f.status().route, 'direct');
  assert.equal(h.f.status().metered, false, 'and the status says plainly that it is no longer metered');
  assert.ok(h.last().started, 'the direct stream was started');
  assert.ok(h.logs.some((l) => /not answering/.test(l)));
});

test('an account with no right to a direct connection waits it out instead', () => {
  const h = harness({ allowed: false });
  h.f.start();
  for (let i = 0; i < 10; i++) h.last().fail();
  assert.equal(h.f.status().route, 'viaServer', 'it stays on the metered path however long the server is down');
  assert.equal(h.made.length, 1, 'and never builds a direct stream at all');
});

test('a refusal is never a reason to go around — that would be the hole this closes', () => {
  for (const code of ['plan_quota', 'not_trusted', 'bad_language']) {
    const h = harness();
    h.f.start();
    h.last().refuse(code);
    for (let i = 0; i < 5; i++) h.last().fail();
    assert.equal(h.f.status().route, 'viaServer', `${code} must not fall back`);
    assert.equal(h.made.length, 1);
  }
});

test('a connection that recovers resets the count, so a flap never accumulates into a switch', () => {
  const h = harness();
  h.f.start();
  h.last().fail();
  h.last().ready();
  h.last().fail();
  assert.equal(h.f.status().route, 'viaServer', 'two failures either side of a good connection are not two in a row');
});

test('audio goes to whichever route is live, and events come back from it', () => {
  const h = harness();
  const results = [];
  h.f.on('result', (r) => results.push(r));
  h.f.start();
  h.f.push('a');
  assert.deepEqual(h.last().pushed, ['a']);

  h.last().fail(); h.last().fail();
  h.f.push('b');
  assert.equal(h.f.status().route, 'direct');
  assert.deepEqual(h.last().pushed, ['b'], 'audio follows the switch');
  h.last().emit('result', { targetText: '你好' });
  assert.deepEqual(results, [{ targetText: '你好' }], 'and results still reach the pipeline');
});

test('stopping tears down whichever stream is live and stays down', () => {
  const h = harness();
  h.f.start();
  h.last().fail(); h.last().fail();
  const direct = h.last();
  h.f.stop();
  assert.equal(direct.started, false);
  assert.equal(direct.listenerCount('result'), 0, 'listeners are removed, so a stopped stream cannot leak events');
});
