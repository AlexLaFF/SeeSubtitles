'use strict';
// Reading an A/B run (server/probe-ab.js). The first four-talk comparison played each talk once through
// each pipeline, which leaves two questions it cannot answer:
//
//   1. Is a pipeline's number a property of the pipeline, of that talk, or of that one connection? With one
//      pass per talk those three are the same column. Repeating the same audio separates them: what still
//      moves between two passes over identical audio is the connection; what only moves between talks is
//      the talk.
//   2. Is 定稿 even the same event in both arms? Each arm measures from its own service's `end_time`, and the
//      two services end a sentence by their own VAD. If one reports the end of speech and the other the moment
//      its silence timer fired, the arms differ by that timer before either has translated anything. Reading
//      the end of speech off the recording itself puts both on one event.
//
// Everything here is arithmetic over numbers and PCM: no credentials, no network, so it is unit-tested.

// --- ordinary statistics ------------------------------------------------------------------------------

const clean = (values) => values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);

function percentile(values, q) {
  const s = clean(values);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

const median = (values) => percentile(values, 0.5);

/** min, max and the distance between them — the plain statement of "how much did this move". */
function spread(values) {
  const s = clean(values);
  if (!s.length) return { n: 0, min: null, max: null, range: null };
  return { n: s.length, min: s[0], max: s[s.length - 1], range: s[s.length - 1] - s[0] };
}

// --- where the speaker actually stopped ---------------------------------------------------------------

/** Per-frame RMS of 16-bit mono PCM. */
function frameRms(pcm, { sampleRate = 16000, frameMs = 20 } = {}) {
  const per = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const frames = Math.floor(pcm.length / 2 / per);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const base = f * per * 2;
    let sum = 0;
    for (let i = 0; i < per; i++) { const s = pcm.readInt16LE(base + i * 2); sum += s * s; }
    out[f] = Math.sqrt(sum / per);
  }
  return out;
}

/** The room, not the speaker: the quietest tenth of the recording. Never zero, so the threshold stays finite. */
function noiseFloor(rms) {
  const s = Array.from(rms).sort((a, b) => a - b);
  if (!s.length) return 1;
  return Math.max(1, s[Math.floor(s.length * 0.1)]);
}

/**
 * A clock over one recording that answers "when did the speaker stop talking near here?".
 *
 * `endOf(reportedMs)` walks back from a service's reported sentence end to the last frame louder than the
 * noise floor, and returns how far it had to walk. That shift is itself the interesting number: it is how
 * much of an arm's 定稿 was really its own silence timer rather than anything it did.
 */
function speechClock(pcm, {
  sampleRate = 16000, frameMs = 20, riseDb = 12, searchBackMs = 4000, searchForwardMs = 400,
} = {}) {
  const rms = frameRms(pcm, { sampleRate, frameMs });
  const floor = noiseFloor(rms);
  const threshold = floor * (10 ** (riseDb / 20));

  const endOf = (reportedMs) => {
    if (reportedMs == null || !Number.isFinite(reportedMs) || !rms.length) return { ms: reportedMs ?? null, shiftMs: null, found: false };
    const last = Math.min(rms.length - 1, Math.floor((reportedMs + searchForwardMs) / frameMs));
    const first = Math.max(0, Math.ceil((reportedMs - searchBackMs) / frameMs));
    for (let f = last; f >= first; f--) {
      if (rms[f] > threshold) {
        const ms = (f + 1) * frameMs;
        return { ms, shiftMs: ms - reportedMs, found: true };
      }
    }
    // nothing above the floor in the window: the reported end stands, flagged so the run can say so
    return { ms: reportedMs, shiftMs: null, found: false };
  };

  return { frameMs, rms, floor, threshold, endOf };
}

// --- did B really win? --------------------------------------------------------------------------------

const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

/**
 * A paired sign test over the cells of a run: one diff per (talk, pass), positive when B was quicker.
 * It asks only "did B win more cells than a coin would", which is all four talks can support — but that is
 * exactly the claim being made, and with one pass per talk n is 4 and even a clean sweep is p = 0.125.
 */
function signTest(diffs) {
  const d = diffs.filter((v) => v != null && Number.isFinite(v));
  const wins = d.filter((v) => v > 0).length;
  const losses = d.filter((v) => v < 0).length;
  const n = wins + losses;
  if (!n) return { n: 0, wins, losses, ties: d.length, p: null };
  const extreme = Math.max(wins, losses);
  let tail = 0;
  for (let k = extreme; k <= n; k++) tail += choose(n, k) * (0.5 ** n);
  return { n, wins, losses, ties: d.length - n, p: Math.min(1, 2 * tail) };
}

// --- what moved, and between what -------------------------------------------------------------------

/**
 * Split an arm's numbers into the two spreads that mean different things. `cells` are
 * {arm, audio, pass, value}.
 *
 *   within  — the same audio played twice through the same pipeline. Whatever differs here is the run:
 *             the connection, the backend behind it, the load at that minute. Nothing about the talk.
 *   between — the medians of different talks. This is speaking pace, pauses, sentence length.
 *
 * If within is the larger of the two, "it depends which server we landed on" is the honest reading. If it
 * is near zero while between is hundreds of milliseconds, the pipeline is behaving deterministically and
 * the talk is doing the work.
 */
function decompose(cells) {
  const arms = [...new Set(cells.map((c) => c.arm))];
  return arms.map((arm) => {
    const mine = cells.filter((c) => c.arm === arm && c.value != null && Number.isFinite(c.value));
    const names = [...new Set(mine.map((c) => c.audio))];
    const audios = names.map((audio) => {
      const values = mine.filter((c) => c.audio === audio).map((c) => c.value);
      const s = spread(values);
      // one pass over a talk has no spread — say so rather than reporting a confident zero
      return { audio, passes: values.length, median: median(values), min: s.min, max: s.max, range: values.length > 1 ? s.range : null };
    });
    const ranges = audios.map((a) => a.range).filter((r) => r != null);
    return {
      arm,
      level: median(mine.map((c) => c.value)),
      audios,
      within: { max: ranges.length ? Math.max(...ranges) : null, median: median(ranges) },
      between: audios.length > 1 ? spread(audios.map((a) => a.median)).range : null,
    };
  });
}

module.exports = { percentile, median, spread, frameRms, noiseFloor, speechClock, signTest, decompose };
