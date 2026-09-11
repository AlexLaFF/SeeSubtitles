'use strict';
// Which way the live audio goes, decided by who the account is — never by whether something failed.
//
// Everyone's audio goes through the hosted server, which holds the Tencent key and counts the seconds as
// they pass: that is what makes a plan's hours a fact rather than a report. An account the server trusts to
// connect directly (server/lib/plans.js, directLive — the account that pays the Tencent bill) sends its audio
// straight to Tencent instead, on connections the server signs but never carries. A talk already running on
// that route keeps going through a server restart or outage; starting one, or reconnecting once the spare
// signatures run out, still needs the server for the moment it takes to sign. The key never leaves the
// server, for anyone.
//
// There is no failing over. Falling back from the server to Tencent would be a way around the metering for
// everyone else, and the trusted account's direct route needs the server to sign anyway, so a fallback would
// have nothing to fall back to. An account whose trust is withdrawn moves onto the server at once.
const { EventEmitter } = require('node:events');

class RouteStream extends EventEmitter {
  /**
   * @param {object} o
   * @param {Function} o.viaServer  () → a stream through the hosted server, which meters it
   * @param {Function} [o.direct]   () → a stream straight to Tencent on server-signed URLs
   * @param {Function} [o.trusted]  () → true, false, or null while the account's plan is not known yet
   * @param {Function} [o.log]
   */
  constructor({ viaServer, direct = null, trusted = () => false, log = () => {} }) {
    super();
    this.make = { viaServer, direct };
    this.trusted = trusted;
    this.log = log;
    this.withdrawn = false;
    this.route = null;
    this.stream = null;
    this.running = false;
  }

  /** The route this account is entitled to now. Not knowing yet counts as not trusted: the server works for everyone. */
  wanted() {
    return this.make.direct && !this.withdrawn && this.trusted() === true ? 'direct' : 'viaServer';
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._use(this.wanted());
  }

  stop() {
    this.running = false;
    this._teardown();
    this.route = null;
  }

  push(chunk, meta) { if (this.stream) this.stream.push(chunk, meta); }
  setOptions(patch) { if (this.stream) this.stream.setOptions(patch); }
  reconnect(reason) { if (this.stream) this.stream.reconnect(reason); }

  status() {
    const route = this.route || this.wanted();
    const s = this.stream ? this.stream.status() : { state: 'idle' };
    return { ...s, route, metered: route === 'viaServer' };
  }

  /** Look again at who the account is — its plan arrives after login and can change. Moves the talk if the answer did. */
  recheck() {
    if (!this.running) return;
    const want = this.wanted();
    if (want === this.route) return;
    this.log(want === 'direct'
      ? 'this account connects straight to Tencent — moving the talk off the subtitle server'
      : 'this account connects through the subtitle server — moving the talk onto it');
    this._use(want);
  }

  /** The server refused to sign for this account: whatever the cached plan says, it goes through the server from now on. */
  withdraw() {
    if (this.withdrawn) return;
    this.withdrawn = true;
    this.recheck();
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
    this.route = which;
    const stream = this.make[which]();
    this.stream = stream;
    stream.on('result', (r) => this.emit('result', r));
    stream.on('log', (t) => this.emit('log', t));
    stream.on('server-error', (e) => this.emit('server-error', e));
    stream.on('status', () => this.emit('status', this.status()));
    if (this.running) stream.start();
    this.emit('status', this.status());
  }
}

module.exports = { RouteStream };
