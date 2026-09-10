'use strict';
// Runs the live pipeline through the hosted server, and drops back to a direct connection when the server
// cannot be reached — but only for an account allowed to connect directly, which means one that pays the
// Tencent bill. Everyone else stays on the metered path and waits for the server to come back, because a
// fallback available to everybody would be a way around the metering rather than a safety net.
//
// The distinction that matters here is between *unreachable* and *refused*. A server that is down is a
// reason to fall back. A server that says "this month's hours are used up" is not, and never becomes one
// however many times it is asked.
const { EventEmitter } = require('node:events');

const SWITCH_AFTER = 2; // failed attempts at the server before trying the direct route
const RETURN_AFTER_MS = 10 * 60_000; // how long to stay direct before giving the server another chance

/** Refusals — decisions the server has made, which trying again or going around will not change. */
const REFUSALS = new Set(['plan_quota', 'bad_language', 'not_trusted']);

class FailoverStream extends EventEmitter {
  /**
   * @param {object} o
   * @param {Function} o.viaServer   () → a metered stream through the hosted server
   * @param {Function} [o.direct]    () → a stream straight to Tencent, for accounts allowed one
   * @param {Function} [o.directAllowed] () → boolean, checked at the moment of switching
   * @param {Function} [o.log]
   */
  constructor({ viaServer, direct = null, directAllowed = () => false, log = () => {} }) {
    super();
    this.make = { viaServer, direct };
    this.directAllowed = directAllowed;
    this.log = log;
    this.on_ = 'viaServer';
    this.failures = 0;
    this.refused = false;
    this.since = 0;
    this.stream = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._use('viaServer');
  }

  stop() {
    this.running = false;
    this._teardown();
  }

  push(chunk, meta) { if (this.stream) this.stream.push(chunk, meta); }
  setOptions(patch) { if (this.stream) this.stream.setOptions(patch); }
  reconnect(reason) { if (this.stream) this.stream.reconnect(reason); }

  status() {
    const s = this.stream ? this.stream.status() : { state: 'idle' };
    return { ...s, route: this.on_, metered: this.on_ === 'viaServer' };
  }

  // ---------------------------------------------------------------- internals

  _teardown() {
    if (!this.stream) return;
    try { this.stream.stop(); } catch { /* already stopped */ }
    this.stream.removeAllListeners();
    this.stream = null;
  }

  _use(which) {
    this._teardown();
    this.on_ = which;
    this.failures = 0;
    this.since = Date.now();
    const stream = this.make[which]();
    this.stream = stream;

    stream.on('result', (r) => this.emit('result', r));
    stream.on('log', (t) => this.emit('log', t));
    stream.on('server-error', (e) => {
      // a decision, not an outage: stay where we are and let the operator see why
      if (e && REFUSALS.has(e.code)) this.refused = true;
      this.emit('server-error', e);
    });
    stream.on('status', (st) => {
      if (st.state === 'ready') this.failures = 0;
      if (st.state === 'reconnecting') this._failed();
      this.emit('status', this.status());
    });
    if (this.running) stream.start();
  }

  /** One failed attempt. Enough of them, and an account that is allowed to goes direct. */
  _failed() {
    if (!this.running) return;
    this.failures++;
    if (this.on_ === 'viaServer') {
      if (this.refused || this.failures < SWITCH_AFTER) return;
      if (!this.make.direct || !this.directAllowed()) return; // metered accounts wait it out
      this.log('the subtitle server is not answering — connecting to Tencent directly for now');
      return this._use('direct');
    }
    // on the direct route: come back to the metered one once it has had time to recover
    if (Date.now() - this.since > RETURN_AFTER_MS) {
      this.log('trying the subtitle server again');
      this.refused = false;
      this._use('viaServer');
    }
  }
}

module.exports = { FailoverStream };
