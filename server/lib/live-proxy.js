'use strict';
// The live pipeline with the server in the audio path, so the account's hours are a fact rather than a
// report. The app opens one WebSocket here, sends the same 200 ms PCM chunks it would have sent Tencent,
// and gets the same result frames back. The server runs the real TranslationStream on its behalf.
//
// Why this rather than handing the app a signed URL: a signed URL opens a stream the server is not a party
// to. It cannot see how long that stream runs, cannot close it, and can only ask the app to own up
// afterwards — which a modified app simply will not do. Metering audio as it passes through is the only
// arrangement where "ten hours a month" means ten hours. The cost is one network hop and the server's
// bandwidth; the audio is 32 KB/s per talk, and the hop is a few tens of milliseconds against a pipeline
// that waits a second of silence before it ends a sentence.
//
// What the client sends: binary frames of 16 kHz mono 16-bit PCM, and JSON {type:'settings', ...} to change
// languages or tuning mid-talk. What it receives: JSON {type:'ready'|'result'|'status'|'log'|'error'}.
const { WebSocketServer } = require('ws');
const { TranslationStream, SplitStream, schema } = require('@subs/core');

const SAMPLE_BYTES = 16000 * 2; // one second of the audio the pipeline sends
const METER_MS = 15_000; // how often streamed audio is charged to the month
const IDLE_MS = 120_000; // a client that sends nothing for this long is dropped, so nothing is held open
const MAX_FRAME = 64 * 1024;

/** Seconds of audio in a run of PCM bytes. */
const secondsOf = (bytes) => bytes / SAMPLE_BYTES;

/**
 * @param {object} o
 * @param {object} o.creds      Tencent credentials — they stay here and are never sent anywhere
 * @param {string} [o.tokenhubKey]  TokenHub key for the split pipeline's translation — it stays here too
 * @param {Function} o.authenticate  (req) → user row or null
 * @param {object} o.quotas     Quotas (plans.js): remaining() and add()
 * @param {Function} o.planRow  (user) → the row whose plan applies (a team's owner, usually)
 * @param {Function} o.log
 * @param {object} [o.env]      TENCENT_EDGE ('cn', the default: the Guangzhou edge; 'auto'; 'system'), TENCENT_ROTATE_MINUTES
 * @param {number} [o.meterMs]  how often streamed audio is charged
 * @param {string} [o.wsUrl]    stand-in for the Tencent endpoint (tests only)
 */
function createLiveProxy({ creds, authenticate, quotas, planRow, log, env = process.env, meterMs = METER_MS, wsUrl = null,
  tokenhubKey = (env.TOKENHUB_API_KEY || '').trim() }) {
  const wss = new WebSocketServer({ noServer: true });
  const live = new Map(); // ws → session, for status and shutdown

  /** Charge what has streamed since the last time, and stop the talk if the plan is spent. */
  function meter(s, { final = false } = {}) {
    const seconds = secondsOf(s.bytes - s.charged);
    if (seconds < 1 && !final) return;
    const whole = Math.floor(seconds);
    if (whole > 0) {
      s.charged += whole * SAMPLE_BYTES;
      quotas.add(s.user.id, 'live', whole);
      s.billed += whole;
    }
    if (final) return;
    if (quotas.remaining(planRow(s.user), 'live') <= 0) {
      log('warn', `live: ${s.user.email} has used the month's live hours — closing the talk`);
      send(s.ws, { type: 'error', code: 'plan_quota', message: 'the live subtitle hours of this month are used up' });
      close(s, 4003, 'plan quota');
    }
  }

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) { try { ws.send(JSON.stringify(msg)); } catch { /* going away */ } }
  }

  function close(s, code, reason) {
    if (s.closed) return;
    s.closed = true;
    clearInterval(s.meterTimer);
    meter(s, { final: true });
    try { s.stream.stop(); } catch { /* already stopped */ }
    live.delete(s.ws);
    log('info', `live: ${s.user.email} finished — ${Math.round(s.billed / 60)} min charged (${reason})`);
    try { s.ws.close(code, reason); } catch { /* already gone */ }
  }

  wss.on('connection', (ws, req, user) => {
    const url = new URL(req.url, 'http://x');
    // Which pipeline carries this talk: the split one (recognition here, translation ours) unless the client
    // asks for 实时语音翻译, and never the split one without a TokenHub key to translate with.
    const asked = String(url.searchParams.get('pipeline') || schema.DEFAULT_PIPELINE);
    const pipeline = schema.PIPELINES.includes(asked) && (asked !== 'split' || tokenhubKey) ? asked : 'combined';
    const source = String(url.searchParams.get('source') || 'yue');
    const target = String(url.searchParams.get('target') || 'zh');
    if (!schema.pairsFor(pipeline)[source] || !schema.targetsFor(source, pipeline).includes(target)) {
      send(ws, { type: 'error', code: 'bad_language', message: `${source} → ${target} is not a pair this pipeline accepts` });
      return ws.close(4000, 'bad language pair');
    }
    if (quotas.remaining(planRow(user), 'live') <= 0) {
      send(ws, { type: 'error', code: 'plan_quota', message: 'the live subtitle hours of this month are used up' });
      return ws.close(4003, 'plan quota');
    }
    // How many talks the plan runs at once, a team's all together (server/lib/plans.js, talks).
    if (quotas.talkLimit) {
      const { limit, ids } = quotas.talkLimit(planRow(user));
      const open = [...live.values()].filter((s) => ids.includes(s.user.id)).length;
      if (limit != null && open >= limit) {
        send(ws, { type: 'error', code: 'plan_talks', message: `this plan runs ${limit} talk${limit === 1 ? '' : 's'} at a time, and ${open} ${open === 1 ? 'is' : 'are'} running` });
        return ws.close(4004, 'talk limit');
      }
    }

    const model = schema.coerceModel(pipeline, url.searchParams.get('transModel'));
    // Tencent through its Guangzhou edge unless TENCENT_EDGE says otherwise. Everyone using this service is in
    // mainland China, which Tencent bills as mainland use; from this Hong Kong server ordinary DNS answers with
    // Singapore, where recognition is billed 跨境 at more than twice the price. A stand-in for Tencent is reached directly.
    const edge = wsUrl ? 'system' : (env.TENCENT_EDGE || 'cn');
    const stream = pipeline === 'split'
      ? new SplitStream(creds, {
        source,
        target,
        model,
        tokenhubKey,
        engine: url.searchParams.get('engine') || undefined,
        vadSilenceTime: Number(url.searchParams.get('vadSilenceTime')) || undefined,
        maxSpeakTime: Number(url.searchParams.get('maxSpeakTime')) || undefined,
        hotwords: url.searchParams.get('hotwords') || undefined,
        edge,
        ...(wsUrl ? { wsUrl } : {}), // tests point this at a stand-in for Tencent
      })
      : new TranslationStream(creds, {
        source,
        target,
        transModel: model,
        rotateMs: (Number(env.TENCENT_ROTATE_MINUTES) || 290) * 60_000,
        edge,
        ...(wsUrl ? { wsUrl } : {}),
      });
    const s = { ws, user, stream, pipeline, bytes: 0, charged: 0, billed: 0, closed: false, lastFrom: Date.now() };
    live.set(ws, s);

    stream.on('result', (r) => send(ws, { type: 'result', result: r }));
    stream.on('status', (st) => send(ws, { type: 'status', status: st }));
    stream.on('log', (text) => send(ws, { type: 'log', text }));
    stream.on('server-error', (msg) => send(ws, { type: 'error', code: `tencent_${msg.code}`, message: msg.message }));
    stream.start();

    s.meterTimer = setInterval(() => {
      if (Date.now() - s.lastFrom > IDLE_MS) return close(s, 4008, 'idle');
      meter(s);
    }, meterMs);
    s.meterTimer.unref();

    ws.on('message', (data, isBinary) => {
      s.lastFrom = Date.now();
      if (isBinary) {
        if (data.length > MAX_FRAME) return close(s, 4009, 'oversized audio frame');
        if (data.length <= 8) return;
        // Eight bytes of capture time, then the PCM. The timestamp is the client's, and results are mapped
        // back onto it, so a recording's cue times never drift by the network delay to this server.
        const t0 = data.readDoubleBE(0);
        const pcm = data.subarray(8);
        s.bytes += pcm.length; // metered on the timer, so a burst cannot dodge the count
        return stream.push(pcm, { t0: Number.isFinite(t0) && t0 > 0 ? t0 : Date.now() });
      }
      let msg = null;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'settings') {
        const nextSource = schema.coerceSource(msg.source, s.pipeline);
        const nextTarget = schema.coerceTarget(nextSource, msg.target, s.pipeline);
        const nextModel = schema.coerceModel(s.pipeline, msg.transModel);
        stream.setOptions({ source: nextSource, target: nextTarget, transModel: nextModel, model: nextModel, hotwords: msg.hotwords,
          vadSilenceTime: msg.vadSilenceTime, maxSpeakTime: msg.maxSpeakTime, noiseThreshold: msg.noiseThreshold, filterModal: msg.filterModal });
      } else if (msg.type === 'stop') {
        close(s, 1000, 'client stopped');
      }
    });
    ws.on('close', () => close(s, 1000, 'client went away'));
    ws.on('error', (err) => { log('warn', `live: ${s.user.email} socket: ${err.message}`); close(s, 1011, 'socket error'); });

    send(ws, { type: 'ready', source, target });
    log('info', `live: ${user.email} opened a talk (${source}→${target})`);
  });

  return {
    /** Hand an HTTP upgrade to the proxy. Returns false when the path is not ours, so other routes still work. */
    upgrade(req, socket, head) {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/api/desktop/live') return false;
      const user = authenticate(req);
      if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return true; }
      if (!creds) { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); return true; }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
      return true;
    },
    /** Talks in progress right now, for the operator. */
    status() {
      return [...live.values()].map((s) => ({ email: s.user.email, seconds: s.billed, state: s.stream.status().state }));
    },
    closeAll() { for (const s of [...live.values()]) close(s, 1001, 'server shutting down'); },
    _sessions: live,
  };
}

module.exports = { createLiveProxy, secondsOf, SAMPLE_BYTES };
