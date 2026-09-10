#!/usr/bin/env node
'use strict';
// Does the `expired` query parameter only gate the handshake, or does it also cut an established stream?
//
// The answer decides how short-lived a server-signed WebSocket URL can be (see the short-lived credentials
// plan): if `expired` only gates the handshake, the server can hand out URLs that die in a minute and a
// live talk is unaffected; if it caps the session, `expired` has to cover a whole rotation window instead.
//
//   node server/probe-signature.js [--cn] [--hold 150]
//
// Four connections, each streaming silence so the server does not drop us for an idle socket (it closes
// after ~6 s without audio). A couple of minutes of silence is all this costs.
const path = require('node:path');
const WebSocket = require('ws');
const { loadEnv, getCredentials, buildConnection, resolveMainland, pinnedOptions } = require('@subs/core');

const CHUNK_BYTES = 6400; // 200 ms of 16 kHz mono 16-bit PCM
const CHUNK_MS = 200;
const SILENCE = Buffer.alloc(CHUNK_BYTES);
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : def; };
const HOLD_S = flag('hold', 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open one connection and hold it, streaming silence, for `holdS` seconds.
 * @returns {Promise<{opened:boolean, authed:boolean, closedAfter:number|null, why:string}>}
 */
function hold(creds, { expiresIn, delayS = 0, holdS, ip, label }) {
  return new Promise(async (resolve) => {
    const now = Math.floor(Date.now() / 1000);
    const conn = buildConnection(creds, { source: 'yue', target: 'zh', extra: { timestamp: now, expired: now + expiresIn } });
    if (delayS) { process.stdout.write(`   waiting ${delayS} s before connecting…\n`); await sleep(delayS * 1000); }
    const t0 = Date.now();
    const since = () => Math.round((Date.now() - t0) / 1000);
    const ws = new WebSocket(conn.url, { handshakeTimeout: 10_000, ...pinnedOptions(ip) });
    const state = { opened: false, authed: false, closedAfter: null, why: '' };
    let pacer = null;
    const finish = () => { clearInterval(pacer); clearTimeout(timer); try { ws.terminate(); } catch { /* gone */ } resolve(state); };
    const timer = setTimeout(() => { state.why = state.why || `still open after ${holdS} s`; finish(); }, holdS * 1000 + 12_000);

    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { state.why = `handshake refused: HTTP ${res.statusCode} ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`; finish(); });
    });
    ws.on('open', () => {
      state.opened = true;
      pacer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(SILENCE, { binary: true }); }, CHUNK_MS);
      setTimeout(() => { if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: 'end' })); } catch { /* gone */ } } }, holdS * 1000);
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg = null;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.code !== 0) { state.why = `server error at ${since()} s — ${msg.code}: ${msg.message}`; return finish(); }
      if (!state.authed) { state.authed = true; process.stdout.write(`   authenticated at ${since()} s\n`); }
      if (msg.final) { state.why = state.why || `server ended the stream at ${since()} s (we asked)`; }
    });
    ws.on('error', (err) => { state.why = state.why || `error at ${since()} s: ${err.message}`; });
    ws.on('close', (code, reason) => {
      state.closedAfter = since();
      state.why = state.why || `closed ${code} at ${since()} s${reason && reason.length ? ` (${reason})` : ''}`;
      finish();
    });
  });
}

async function main() {
  loadEnv(path.join(__dirname, '..', '.env'));
  const creds = getCredentials();
  const ip = args.includes('--cn') ? await resolveMainland({}) : null;
  if (ip) console.log(`# mainland edge ${ip}`);

  const cases = [
    { label: `A · expired 60 s in the PAST`, expiresIn: -60, holdS: 5 },
    { label: `B · expired ${HOLD_S + 120} s out (control), hold ${HOLD_S} s`, expiresIn: HOLD_S + 120, holdS: HOLD_S },
    { label: `C · expired 45 s out, hold ${HOLD_S} s — does the stream survive its own expiry?`, expiresIn: 45, holdS: HOLD_S },
    { label: `D · expired 30 s out, connect at 60 s — is a stale URL refused?`, expiresIn: 30, delayS: 60, holdS: 10 },
  ];
  for (const c of cases) {
    console.log(`\n▶ ${c.label}`);
    const r = await hold(creds, { ...c, ip });
    console.log(`   ${r.opened ? (r.authed ? '✔ opened and authenticated' : '△ opened, never authenticated') : '✖ never opened'} — ${r.why}`);
  }
  console.log('\n# Read C against B: if C closes near its 45 s expiry while B runs the full hold, `expired` caps the session.');
}

main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
