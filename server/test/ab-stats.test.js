'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { percentile, median, spread, frameRms, noiseFloor, speechClock, signTest, decompose, alignRows, endAgreement } = require('../lib/ab-stats');

/** Build 16 kHz mono PCM: `segments` of {ms, amp}, amp 0 being room tone. */
function pcm(segments, { noise = 60 } = {}) {
  const total = segments.reduce((n, s) => n + Math.round(16 * s.ms), 0);
  const buf = Buffer.alloc(total * 2);
  let i = 0;
  for (const seg of segments) {
    const n = Math.round(16 * seg.ms);
    for (let k = 0; k < n; k++, i++) {
      const tone = seg.amp ? seg.amp * Math.sin((2 * Math.PI * 220 * i) / 16000) : 0;
      const room = noise * Math.sin((2 * Math.PI * 7919 * i) / 16000);
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(tone + room))), i * 2);
    }
  }
  return buf;
}

test('ab-stats: ordinary statistics ignore the gaps a dropped line leaves', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([3, null, 1, undefined, 2]), 2);
  assert.equal(median([]), null);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 10);
  assert.deepEqual(spread([812, 789, 827, 867]), { n: 4, min: 789, max: 867, range: 78 });
  assert.deepEqual(spread([]), { n: 0, min: null, max: null, range: null });
});

test('ab-stats: the speech clock finds the end of speech, and says how far the service was from it', () => {
  // two seconds of talking, then four seconds of room tone
  const audio = pcm([{ ms: 2000, amp: 6000 }, { ms: 4000, amp: 0 }]);
  const rms = frameRms(audio);
  assert.equal(rms.length, 6000 / 20);
  assert.ok(noiseFloor(rms) > 0, 'the floor is never zero, or the threshold blows up');

  const clock = speechClock(audio);
  // an arm that reports the end of speech honestly: nothing to correct
  const honest = clock.endOf(2000);
  assert.ok(honest.found);
  assert.ok(Math.abs(honest.shiftMs) <= 40, `expected ~0, got ${honest.shiftMs}`);

  // an arm that reports the moment its 800 ms silence timer fired: the same speech, 800 ms of credit
  const late = clock.endOf(2800);
  assert.ok(late.found);
  assert.ok(late.shiftMs < -700 && late.shiftMs > -900, `expected about -800, got ${late.shiftMs}`);
  assert.ok(Math.abs(late.ms - honest.ms) <= 40, 'both land on the same physical moment');

  // ...which is the whole point: measured from the recording, the two arms differ by 0, not by 800
  const finalAt = 9000; // same wall-clock moment for both
  assert.equal((finalAt - honest.ms) - (finalAt - late.ms), 0);
  assert.equal((finalAt - 2000) - (finalAt - 2800), 800, 'measured from each service, one looks 800 ms quicker');
});

test('ab-stats: the speech clock reports nothing rather than guessing when the window is silent', () => {
  const clock = speechClock(pcm([{ ms: 3000, amp: 0 }]));
  const r = clock.endOf(2000);
  assert.equal(r.found, false);
  assert.equal(r.shiftMs, null);
  assert.equal(r.ms, 2000, 'the service still gets the benefit of the doubt, flagged');
  assert.equal(clock.endOf(null).found, false);
});

test('ab-stats: four talks, one pass each, cannot carry the claim; repeats can', () => {
  // the run we already have: B quicker on three of four (positive = B quicker)
  const once = signTest([1340 - 812, 1198 - 789, 1225 - 827, 558 - 867]);
  assert.deepEqual({ n: once.n, wins: once.wins, losses: once.losses }, { n: 4, wins: 3, losses: 1 });
  assert.ok(once.p > 0.6, `three of four is a coin: p=${once.p}`);

  // even a clean sweep of four is weak
  assert.ok(signTest([1, 1, 1, 1]).p > 0.1, 'four for four is still p = 0.125');
  // twelve cells of the same sweep is not
  assert.ok(signTest(Array(12).fill(1)).p < 0.001);
  assert.deepEqual(signTest([]), { n: 0, wins: 0, losses: 0, ties: 0, p: null });
  assert.equal(signTest([5, -5, 0]).ties, 1);
});

test('ab-stats: within-audio spread is the connection, between-audio spread is the talk', () => {
  // A: steady on each talk, different between them — the audio is doing the work
  // B: all over the place on the same audio — that is the connection, whatever the talk
  const cells = [
    { arm: 'A', audio: 't1', pass: 1, value: 1340 }, { arm: 'A', audio: 't1', pass: 2, value: 1310 },
    { arm: 'A', audio: 't2', pass: 1, value: 560 }, { arm: 'A', audio: 't2', pass: 2, value: 575 },
    { arm: 'B', audio: 't1', pass: 1, value: 800 }, { arm: 'B', audio: 't1', pass: 2, value: 1500 },
    { arm: 'B', audio: 't2', pass: 1, value: 810 }, { arm: 'B', audio: 't2', pass: 2, value: 1460 },
  ];
  const [a, b] = decompose(cells);

  assert.equal(a.arm, 'A');
  assert.equal(a.within.max, 30);
  assert.ok(a.between > 700, 'A swings between talks');
  assert.ok(a.within.max < a.between, 'so for A the talk explains it');

  assert.equal(b.within.max, 700);
  assert.ok(b.between < 50, 'B lands in the same place on both talks');
  assert.ok(b.within.max > b.between, 'so for B the run explains it — that is what "which server" looks like');

  assert.equal(a.audios.length, 2);
  assert.equal(a.audios[0].passes, 2);
  assert.equal(decompose([{ arm: 'A', audio: 't1', pass: 1, value: 10 }])[0].within.max, null, 'one pass says nothing');
});

test('ab-stats: two arms are matched by overlap, and splits are dropped rather than compared', () => {
  const a = [{ startMs: 0, endMs: 2000 }, { startMs: 3000, endMs: 5000 }];
  // B hears the same first sentence 400 ms later at the end, and splits the second one in two
  const b = [{ startMs: 20, endMs: 2400 }, { startMs: 3000, endMs: 3900 }, { startMs: 3950, endMs: 5000 }];
  const { pairs, aCount, bCount } = alignRows(a, b);
  assert.equal(aCount, 2);
  assert.equal(bCount, 3);
  assert.equal(pairs.length, 1, 'only the sentence both arms ran together is comparable');
  assert.equal(pairs[0].a.endMs, 2000);
  assert.equal(pairs[0].b.endMs, 2400);

  assert.equal(alignRows([{ startMs: 0, endMs: 1000 }], [{ startMs: 5000, endMs: 6000 }]).pairs.length, 0, 'no overlap, no pair');
  assert.equal(alignRows([{ startMs: 0, endMs: null }], [{ startMs: 0, endMs: 1000 }]).pairs.length, 0, 'a row without an end is not a row');
});

test('ab-stats: agreeing on the start and differing on the end is endpointing, not speed', () => {
  // the same six utterances: both arms hear them begin together, A ends each one 480 ms later
  const a = [];
  const b = [];
  for (let i = 0; i < 6; i++) {
    const at = i * 4000;
    a.push({ startMs: at, endMs: at + 2480 });
    b.push({ startMs: at + (i % 2 ? 10 : -10), endMs: at + 2000 });
  }
  const r = endAgreement(a, b);
  assert.equal(r.matched, 6);
  assert.ok(Math.abs(r.start.median) <= 10, `starts agree: ${r.start.median}`);
  assert.equal(r.end.median, 480);
  // which is the whole point: 480 ms of the gap was there before either pipeline translated anything
  assert.ok(r.end.median - Math.abs(r.start.median) > 400);
});

test('ab-stats: a sentence split near its start is dropped, not scored as a 1.5 s disagreement', () => {
  // the trap mutual-best matching alone walks into: B's first fragment has the larger overlap, so it wins
  // the match, and its interior boundary at 3500 would be compared against A's real end at 5000
  const a = [{ startMs: 0, endMs: 5000 }];
  const b = [{ startMs: 0, endMs: 3500 }, { startMs: 3600, endMs: 5000 }];
  assert.equal(alignRows(a, b).pairs.length, 0);
  assert.equal(endAgreement(a, b).end.median, null, 'no pairs, no claim');
  assert.equal(endAgreement(a, b).aCount, 1);
});
