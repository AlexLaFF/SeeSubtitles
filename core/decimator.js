'use strict';
// Streaming low-pass FIR + integer decimator. Default: 48 kHz → 16 kHz (factor 3).
// Keeps filter state across calls so audio can be fed in arbitrary chunk sizes.

class Decimator {
  /**
   * @param {object} [o]
   * @param {number} [o.factor=3]   integer decimation ratio
   * @param {number} [o.taps=63]    FIR length (odd)
   * @param {number} [o.cutoff]     cutoff as a fraction of the INPUT sample rate;
   *                                default 0.9 × output Nyquist (7.2 kHz for 48k→16k)
   */
  constructor({ factor = 3, taps = 63, cutoff } = {}) {
    if (!Number.isInteger(factor) || factor < 1) throw new Error('factor must be a positive integer');
    if (taps % 2 === 0) taps += 1;
    this.factor = factor;
    this.taps = taps;
    this.h = Decimator.design(taps, cutoff ?? 0.9 / (2 * factor));
    this.hist = new Float32Array(taps - 1); // last taps-1 input samples
    this.phase = 0; // where the next output falls in the next chunk
  }

  /** Windowed-sinc (Hamming) low-pass, normalised to unity DC gain. */
  static design(taps, fc) {
    const h = new Float64Array(taps);
    const m = (taps - 1) / 2;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const x = k - m;
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (taps - 1));
      h[k] = sinc * w;
      sum += h[k];
    }
    for (let k = 0; k < taps; k++) h[k] /= sum;
    return h;
  }

  /**
   * @param {Int16Array} input samples at the input rate
   * @returns {Int16Array} samples at input rate / factor
   */
  process(input) {
    const { taps, factor, h, hist } = this;
    const n = taps - 1;
    const len = n + input.length;
    const buf = new Float32Array(len);
    buf.set(hist, 0);
    for (let i = 0; i < input.length; i++) buf[n + i] = input[i];

    const out = new Int16Array(Math.ceil(Math.max(0, len - n - this.phase) / factor));
    let o = 0;
    let i = n + this.phase;
    for (; i < len; i += factor) {
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += h[k] * buf[i - k];
      out[o++] = acc > 32767 ? 32767 : acc < -32768 ? -32768 : Math.round(acc);
    }
    this.phase = i - len;
    hist.set(buf.subarray(len - n, len));
    return o === out.length ? out : out.subarray(0, o);
  }
}

module.exports = { Decimator };
