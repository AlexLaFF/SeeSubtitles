'use strict';
// The route a talk takes is decided by who the account is, never by what failed. These tests hold the lines
// that make that true: a trusted account goes straight to Tencent from the first word, everyone else goes
// through the server however badly it is doing, and trust that is withdrawn takes effect at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RouteStream } = require('../route-stream');

function fake(kind, made) {
  const s = new EventEmitter();
  Object.assign(s, {
    kind, started: false, pushed: [], options: [],
    start() { s.started = true; },
    stop() { s.started = false; },
    push(chunk) { s.pushed.push(chunk); },
    setOptions(p) { s.options.push(p); },
    reconnect() {},
    status() { return { state: s.started ? 'ready' : 'stopped', kind }; },
  });
  made.push(s);
  return s;
}

function harness({ trusted = false, withDirect = true } = {}) {
  const made = [];
  const logs = [];
  let trust = trusted;
  const r = new RouteStream({
    viaServer: () => fake('viaServer', made),
    direct: withDirect ? () => fake('direct', made) : null,
    trusted: () => trust,
    log: (t) => logs.push(t),
  });
  return { r, made, logs, trust: (v) => { trust = v; }, last: () => made[made.length - 1] };
}

test('an account the server trusts sends its audio straight to Tencent from the first word', () => {
  const h = harness({ trusted: true });
  h.r.start();
  assert.equal(h.r.status().route, 'direct');
  assert.equal(h.r.status().metered, false);
  assert.deepEqual(h.made.map((s) => s.kind), ['direct'], 'the server route is never even built');
});

test('everyone else goes through the server and is never handed a direct stream', () => {
  const h = harness({ trusted: false });
  h.r.start();
  assert.equal(h.r.status().route, 'viaServer');
  assert.equal(h.r.status().metered, true);
  for (let i = 0; i < 10; i++) h.last().emit('status', { state: 'reconnecting' });
  assert.equal(h.r.status().route, 'viaServer', 'a server that keeps failing is not a reason to go around it');
  assert.equal(h.made.length, 1);
});

test('not knowing the plan yet counts as not trusted, and the plan arriving moves the talk', () => {
  const h = harness({ trusted: null });
  h.r.start();
  assert.equal(h.r.status().route, 'viaServer');
  h.trust(true);
  h.r.recheck();
  assert.equal(h.r.status().route, 'direct');
  assert.equal(h.made[0].started, false, 'the server stream was stopped');
  assert.ok(h.last().started, 'and the direct one started');
});

test('trust taken away in the plan moves a direct talk back onto the server', () => {
  const h = harness({ trusted: true });
  h.r.start();
  h.trust(false);
  h.r.recheck();
  assert.equal(h.r.status().route, 'viaServer');
  assert.ok(h.logs.some((l) => /through the subtitle server/.test(l)));
});

test('a refused signature moves the talk onto the server and keeps it there, whatever the cached plan says', () => {
  const h = harness({ trusted: true });
  h.r.start();
  h.r.withdraw();
  assert.equal(h.r.status().route, 'viaServer');
  h.r.recheck();
  assert.equal(h.r.status().route, 'viaServer', 'a stale plan cannot send it back');
});

test('without a direct route to offer, even a trusted account goes through the server', () => {
  const h = harness({ trusted: true, withDirect: false });
  h.r.start();
  assert.equal(h.r.status().route, 'viaServer');
});

test('a recheck that changes nothing does not reconnect', () => {
  const h = harness({ trusted: true });
  h.r.start();
  h.r.recheck();
  h.r.recheck();
  assert.equal(h.made.length, 1);
});

test('audio goes to whichever route is live, and its events come back', () => {
  const h = harness({ trusted: true });
  const results = [];
  h.r.on('result', (x) => results.push(x));
  h.r.start();
  h.r.push('chunk-1');
  h.r.setOptions({ target: 'en' });
  h.last().emit('result', { sourceText: 'hi' });
  assert.deepEqual(h.last().pushed, ['chunk-1']);
  assert.deepEqual(h.last().options, [{ target: 'en' }]);
  assert.deepEqual(results, [{ sourceText: 'hi' }]);
});

test('stopping tears the live stream down, removes its listeners, and a recheck does not revive it', () => {
  const h = harness({ trusted: false });
  h.r.start();
  const s = h.last();
  h.r.stop();
  assert.equal(s.started, false);
  assert.equal(s.listenerCount('result'), 0);
  h.trust(true);
  h.r.recheck();
  assert.equal(h.made.length, 1, 'nothing is built while stopped');
});
