'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Decimator } = require('../decimator');

const IN_RATE = 48000;
function sine(freq, seconds, amp = 10000) {
  const n = Math.round(IN_RATE * seconds);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / IN_RATE));
  return s;
}
function peak(arr, from = 0) {
  let p = 0;
  for (let i = from; i < arr.length; i++) p = Math.max(p, Math.abs(arr[i]));
  return p;
}

test('48k → 16k produces one third as many samples', () => {
  const out = new Decimator().process(sine(1000, 0.3));
  assert.equal(out.length, 4800);
});

test('passes 1 kHz with ~unity gain', () => {
  const out = new Decimator().process(sine(1000, 0.3));
  const p = peak(out, 200);
  assert.ok(p > 9700 && p < 10300, `peak ${p}`);
});

test('kills 20 kHz (would alias to 4 kHz without the low-pass)', () => {
  const out = new Decimator().process(sine(20000, 0.3));
  const p = peak(out, 200);
  assert.ok(p < 100, `peak ${p}`);
});

test('chunk boundaries do not change the output', () => {
  const src = new Int16Array(9600);
  let seed = 42;
  for (let i = 0; i < src.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    src[i] = (seed % 20000) - 10000;
  }
  const whole = new Decimator().process(src);
  const chunked = new Decimator();
  const parts = [];
  let pos = 0;
  for (const size of [7, 1000, 3, 2900, 890, 1, 4799]) {
    parts.push(chunked.process(src.subarray(pos, pos + size)));
    pos += size;
  }
  const joined = new Int16Array(whole.length);
  let o = 0;
  for (const p of parts) { joined.set(p, o); o += p.length; }
  assert.equal(o, whole.length);
  assert.deepEqual(Array.from(joined), Array.from(whole));
});

test('empty input is a no-op', () => {
  const d = new Decimator();
  assert.equal(d.process(new Int16Array(0)).length, 0);
  assert.equal(d.process(sine(1000, 0.1)).length, 1600);
});
