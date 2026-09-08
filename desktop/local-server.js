'use strict';
// Local pipeline server used by the desktop app: mic → Tencent 实时语音翻译 → transcript → SSE → pages.
// Same routes as the original localhost tool, packaged as a factory so the Electron main process can
// own its lifecycle, feed it credentials from the Keychain, and mirror its events to the cloud.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { TranslationStream, Transcript, Recorder, schema } = require('@subs/core');
const { AudioCapture, FileCapture, listDevices, listDevicesFfmpeg } = require('./lib/capture');
const { Mp4Queue } = require('./lib/mp4');
const { SummaryQueue } = require('./lib/summary');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/**
 * @param {object} opts
 * @param {string} opts.webDir           static pages (display, control, playback)
 * @param {string} opts.schemaFile       core/schema.js, served as /schema.js
 * @param {string} opts.dataDir          settings.json / presets.json
 * @param {string} opts.recordingsDir
 * @param {string} opts.transcriptsDir
 * @param {object|null} opts.creds       {appid, secretId, secretKey} or null (no Tencent connection)
 * @param {string|null} [opts.credsError]
 * @param {boolean} [opts.demo]
 * @param {string} [opts.audioFile]      loop a 16 kHz WAV instead of the microphone
 * @param {string} [opts.host]
 * @param {number} [opts.port]           0 = random free port
 * @param {string} [opts.token]          when set, every request needs ?token= or the cookie it sets
 * @param {object} [opts.env]            MP4_*, RECORD_BITRATE, TENCENT_EDGE, TENCENT_ROTATE_MINUTES, AUDIO_DEVICE, TENCENT_TRANS_MODEL
 * @param {function} [opts.onOpenOverlay]
 * @param {function} [opts.onCloud]      (body) => result, for POST /api/cloud
 * @param {function} [opts.cloudStatus]  () => object merged into status()
 * @param {object}   [opts.resubtitle]   ResubtitleQueue (needs the cloud login) for POST /api/recordings/resubtitle
 * @param {function} [opts.consoleLog]   (level, text) — defaults to console
 */
async function createLocalServer(opts) {
  const env = opts.env || {};
  const DEMO = !!opts.demo;
  const SERVER_ID = `${Date.now().toString(36)}`;
  const NO_PERSIST = new Set(schema.FIELDS.filter((f) => f.persist === false).map((f) => f.key));
  const emitter = new EventEmitter();
  const SETTINGS_FILE = path.join(opts.dataDir, 'settings.json');
  const PRESETS_FILE = path.join(opts.dataDir, 'presets.json');
  fs.mkdirSync(opts.dataDir, { recursive: true });
  fs.mkdirSync(opts.recordingsDir, { recursive: true });

  // ---------------------------------------------------------------- log + SSE
  const logs = [];
  const clients = new Set();
  function broadcast(event, data) {
    emitter.emit('event', event, data);
    if (!clients.size) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.res.write(payload);
  }
  function log(level, text) {
    const entry = { t: Date.now(), level, text };
    logs.push(entry);
    if (logs.length > 300) logs.shift();
    if (opts.consoleLog) opts.consoleLog(level, text);
    else {
      const ts = new Date(entry.t).toTimeString().slice(0, 8);
      const mark = level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·';
      (level === 'error' ? console.error : console.log)(`${ts} ${mark} ${text}`);
    }
    broadcast('log', entry);
  }

  // ---------------------------------------------------------------- settings
  let settings = schema.defaults();
  try {
    Object.assign(settings, schema.sanitize(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', `settings.json ignored: ${err.message}`);
    Object.assign(settings, schema.sanitize({ audioDevice: env.AUDIO_DEVICE, transModel: env.TENCENT_TRANS_MODEL }));
  }
  settings.streaming = true;
  let saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const out = {};
      for (const [k, v] of Object.entries(settings)) if (!NO_PERSIST.has(k)) out[k] = v;
      fs.writeFile(SETTINGS_FILE, JSON.stringify(out, null, 2), (err) => { if (err) log('error', `saving settings: ${err.message}`); });
    }, 250);
  }

  // ---------------------------------------------------------------- presets
  const PRESET_KEYS = schema.FIELDS.filter((f) => ['text', 'layout', 'background'].includes(f.group) || f.key === 'showMode').map((f) => f.key);
  let userPresets = {};
  try { userPresets = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')); } catch (err) { if (err.code !== 'ENOENT') log('warn', `presets.json ignored: ${err.message}`); }
  const currentLook = () => { const o = {}; for (const k of PRESET_KEYS) o[k] = settings[k]; return o; };
  const presetsPayload = () => ({ builtin: schema.PRESETS, user: userPresets });
  const savePresetsFile = () => fs.writeFile(PRESETS_FILE, JSON.stringify(userPresets, null, 2), (err) => { if (err) log('error', `saving presets: ${err.message}`); });
  function presetAction(body) {
    const name = String(body.name || '').trim().slice(0, 60);
    switch (body.action) {
      case 'save':
        if (!name) throw new Error('preset needs a name');
        userPresets[name] = body.patch ? schema.sanitize(body.patch) : currentLook();
        savePresetsFile();
        log('info', `preset "${name}" saved`);
        break;
      case 'delete':
        if (!(name in userPresets)) throw new Error(`no saved preset "${name}"`);
        delete userPresets[name];
        savePresetsFile();
        log('info', `preset "${name}" deleted`);
        break;
      case 'rename': {
        const newName = String(body.newName || '').trim().slice(0, 60);
        if (!(name in userPresets) || !newName) throw new Error('rename needs an existing preset and a new name');
        userPresets[newName] = userPresets[name];
        if (newName !== name) delete userPresets[name];
        savePresetsFile();
        break;
      }
      case 'apply': {
        const patch = userPresets[name] || (schema.PRESETS[name] && schema.PRESETS[name].patch);
        if (!patch) throw new Error(`unknown preset "${name}"`);
        applySettings(patch, null);
        log('info', `preset "${name}" applied`);
        return { applied: name };
      }
      default:
        throw new Error('action must be save, delete, rename or apply');
    }
    broadcast('presets', presetsPayload());
    return presetsPayload();
  }

  // ---------------------------------------------------------------- pipeline
  const creds = DEMO ? null : opts.creds || null;
  const credsError = DEMO ? null : opts.credsError || (creds ? null : 'Tencent credentials are not set (Settings → Tencent Cloud)');
  if (credsError) log('error', credsError);

  const transcript = new Transcript({ logDir: opts.transcriptsDir });
  const recorder = new Recorder({ dir: opts.recordingsDir, bitrate: env.RECORD_BITRATE || '128k' });
  const MP4_AUTO = !/^(0|false|no|off)$/i.test(env.MP4_AUTO || '1');
  const mp4 = new Mp4Queue({
    dir: opts.recordingsDir,
    size: env.MP4_SIZE || '1080x1920',
    fontSize: Number(env.MP4_FONT_SIZE) || 64,
    show: env.MP4_SHOW || 'target',
    fps: Number(env.MP4_FPS) || 15,
    encoder: env.MP4_ENCODER || 'libx264',
  });
  mp4.on('log', (t) => log('info', `mp4: ${t}`));
  mp4.on('status', () => broadcast('status', status()));
  mp4.on('done', (r) => log('info', `mp4 ready: ${r.file} (${(r.bytes / 1e6).toFixed(1)} MB, took ${r.seconds} s)`));
  mp4.on('error', (e) => log('error', `mp4 ${e.base}: ${e.error}`));
  if (opts.resubtitle) {
    opts.resubtitle.on('status', () => broadcast('status', status()));
    opts.resubtitle.on('done', ({ base }) => { if (MP4_AUTO) { mp4.add(base); log('info', `re-rendering the MP4 for ${base} with the complete subtitles`); } });
  }
  const summaries = new SummaryQueue({
    dir: opts.recordingsDir,
    apiKey: (opts.summaryApiKey || '').trim(),
    model: env.SUMMARY_MODEL || 'claude-opus-5',
    language: env.SUMMARY_LANGUAGE || 'zh',
    effort: env.SUMMARY_EFFORT || 'high',
    pdfRenderer: opts.pdfRenderer,
    pdfUrlFor: (base) => `http://127.0.0.1:${port}/summary?rec=${encodeURIComponent(base)}&print=1${opts.token ? `&token=${opts.token}` : ""}`,
  });
  summaries.on('log', (t) => log('info', `summary: ${t}`));
  summaries.on('status', () => broadcast('status', status()));
  summaries.on('done', (r) => log('info', `summary ready: ${r.file}${r.pdf ? ` + ${r.pdf}` : ''} (${r.chars} chars, ${r.seconds} s, ${r.usage.input || '?'}→${r.usage.output || '?'} tokens${r.truncated ? ', TRUNCATED' : ''})`));
  summaries.on('error', (e) => log('error', `summary ${e.base}: ${e.error}`));
  const capture = DEMO ? null
    : opts.audioFile ? new FileCapture({ file: opts.audioFile })
      : new AudioCapture({ device: settings.audioDevice, backend: env.AUDIO_BACKEND || 'auto' });
  if (opts.audioFile && !DEMO) log('info', `audio file mode: looping ${opts.audioFile} instead of the microphone`);
  const stream = creds
    ? new TranslationStream(creds, {
      source: settings.source,
      target: settings.target,
      transModel: settings.transModel,
      hotwords: settings.hotwords,
      vadSilenceTime: settings.vadSilenceTime,
      maxSpeakTime: settings.maxSpeakTime,
      noiseThreshold: settings.noiseThreshold,
      filterModal: settings.filterModal,
      rotateMs: (Number(env.TENCENT_ROTATE_MINUTES) || 290) * 60_000,
      edge: env.TENCENT_EDGE || 'auto',
    })
    : null;

  let level = null;
  let devices = [];
  let overlay = { present: false, displays: [], bounds: null };

  if (capture) {
    capture.on('chunk', (chunk, lvl) => {
      level = lvl;
      if (stream && settings.streaming) stream.push(chunk, lvl);
    });
    capture.on('raw', (pcm) => recorder.writeAudio(pcm));
    capture.on('start', ({ device, backend }) => log('info', `audio capture started (device "${device}", ${backend} backend)`));
    capture.on('exit', ({ code, signal }) => log(signal || code === 0 || code === 3 ? 'info' : 'error', `capture process exited (${signal || `code ${code}`})`));
    capture.on('log', (t) => log(/capturing |compiling/.test(t) ? 'info' : 'warn', `capture: ${t}`));
    capture.on('stall', () => log('warn', 'no audio from the capture process for 5 s, restarting it'));
    capture.on('error', (err) => log('error', `audio capture: ${err.message}`));
  }
  transcript.on('line', (line) => {
    broadcast('line', line);
    if (line.ended) recorder.addSentence(line);
  });
  recorder.on('log', (t) => log('warn', `recorder: ${t}`));
  recorder.on('start', (st) => { log('info', `recording started → ${st.current.file}`); broadcast('status', status()); });
  recorder.on('stop', (info) => {
    log('info', `recording saved: ${info.file} (${(info.durationMs / 60000).toFixed(1)} min, ${(info.bytes / 1e6).toFixed(1)} MB, ${info.cues.zh} cues)`);
    broadcast('status', status());
    emitter.emit('recording', info);
    if (MP4_AUTO && info.durationMs > 1000 && (info.cues.zh || info.cues.yue)) { log('info', `queueing MP4 export for ${info.base}`); mp4.add(info.base); }
  });
  transcript.on('log', (t) => log('warn', t));
  if (stream) {
    stream.on('result', (r) => transcript.apply(r));
    stream.on('log', (t) => log(/^✖/.test(t) ? 'error' : 'info', t.replace(/^[✖✔]\s*/, '')));
    stream.on('status', () => broadcast('status', status()));
  }

  function status() {
    return {
      demo: DEMO,
      creds: !!creds,
      credsError,
      streaming: settings.streaming,
      stream: stream ? stream.status() : { state: DEMO ? 'demo' : 'no-credentials' },
      capture: capture ? capture.status() : { running: false, device: 'demo' },
      level,
      overlay,
      recorder: recorder.status(),
      mp4: mp4.status(),
      summary: summaries.status(),
      cloud: opts.cloudStatus ? opts.cloudStatus() : null,
      resubtitle: opts.resubtitle ? opts.resubtitle.status() : null,
      now: Date.now(),
    };
  }
  function startRecording() {
    if (!capture) throw new Error('no audio source in demo mode');
    return recorder.start({ rate: capture.rate, channels: 1 });
  }
  const statusTimer = setInterval(() => broadcast('status', status()), 250);

  function applySettings(patch, from) {
    const clean = schema.sanitize(patch);
    if (clean.window && settings.window) clean.window = { ...settings.window, ...clean.window };
    const changed = Object.keys(clean).filter((k) => JSON.stringify(clean[k]) !== JSON.stringify(settings[k]));
    if (!changed.length) return [];
    for (const k of changed) settings[k] = clean[k];
    saveSettings();
    if (changed.includes('audioDevice') && capture) {
      log('info', `switching microphone to "${settings.audioDevice}"`);
      capture.setDevice(settings.audioDevice);
    }
    if (stream) {
      const TUNING = ['source', 'target', 'transModel', 'hotwords', 'vadSilenceTime', 'maxSpeakTime', 'noiseThreshold', 'filterModal'];
      if (changed.some((k) => TUNING.includes(k))) {
        const patch = {};
        for (const k of TUNING) patch[k] = settings[k];
        stream.setOptions(patch); // graceful rotation to a connection with the new parameters
      }
      if (changed.includes('streaming')) {
        if (settings.streaming) { log('info', 'streaming resumed'); stream.start(); } else { log('info', 'streaming paused'); stream.stop(); }
      }
    }
    broadcast('settings', { settings, changed, from: from || null });
    return changed;
  }

  async function refreshDevices() {
    const r = await listDevices('ffmpeg', env.AUDIO_BACKEND || 'auto');
    if (r.error) log('error', r.error);
    devices = [{ id: 'default', name: 'System default input' }, ...r.devices.map((d) => ({ id: String(d.id), name: `${d.name}${d.default ? ' (system default)' : ''}` }))];
    if (r.backend === 'native' && /^\d+$/.test(settings.audioDevice) && !r.devices.some((d) => String(d.id) === settings.audioDevice)) {
      const legacy = await listDevicesFfmpeg();
      const match = legacy.devices.find((d) => String(d.index) === settings.audioDevice);
      if (match && r.devices.some((d) => d.name === match.name)) {
        log('info', `microphone setting "${settings.audioDevice}" migrated to "${match.name}"`);
        applySettings({ audioDevice: match.name }, null);
      }
    }
    broadcast('devices', devices);
    return devices;
  }

  function overlayRegister(body) {
    overlay = {
      present: body.present != null ? !!body.present : true,
      displays: Array.isArray(body.displays) ? body.displays : overlay.displays,
      bounds: body.bounds || overlay.bounds,
    };
    if (body.bounds) { settings.window = body.bounds; saveSettings(); }
    broadcast('overlay', overlay);
  }

  // ---------------------------------------------------------------- demo feed
  if (DEMO) {
    const script = [
      ['大家好，歡迎嚟到今日嘅活動。', '大家好，欢迎来到今天的活动。'],
      ['我哋今日會介紹三個新產品。', '我们今天会介绍三个新产品。'],
      ['第一個係我哋嘅智能家居系統。', '第一个是我们的智能家居系统。'],
      ['佢可以用手機遙控屋企所有電器。', '它可以用手机遥控家里所有电器。'],
      ['而且安裝好簡單，十五分鐘就搞掂。', '而且安装很简单，十五分钟就搞定。'],
      ['價錢方面，我哋做咗一個好有競爭力嘅定價。', '价格方面，我们做了一个很有竞争力的定价。'],
      ['宜家開放現場提問，有咩問題可以舉手。', '现在开放现场提问，有什么问题可以举手。'],
    ];
    let i = 0;
    let sid = 0;
    let stopped = false;
    const feed = () => {
      if (stopped) return;
      if (!settings.streaming) return setTimeout(feed, 500);
      const [src, tgt] = script[i++ % script.length];
      const sentenceId = `demo-${++sid}`;
      const wallStart = Date.now();
      let k = 0;
      const step = () => {
        if (stopped) return;
        k = Math.min(tgt.length, k + 2 + Math.floor(Math.random() * 3));
        transcript.apply({ voiceId: 'demo', sentenceId, sourceText: src.slice(0, Math.round((k / tgt.length) * src.length)), targetText: tgt.slice(0, k), sentenceEnd: k >= tgt.length, wallStart, wallEnd: Date.now() });
        if (k < tgt.length) setTimeout(step, 250 + Math.random() * 300);
        else setTimeout(feed, 1200 + Math.random() * 1500);
      };
      step();
    };
    setTimeout(feed, 1000);
    const lvlTimer = setInterval(() => { level = { dbfs: -40 + Math.random() * 25, rms: 0, peak: 0 }; }, 200);
    emitter.once('shutdown', () => { stopped = true; clearInterval(lvlTimer); });
    log('info', 'DEMO mode: scripted sentences, no microphone, no Tencent connection');
  }

  // ---------------------------------------------------------------- http
  const stateSnapshot = () => ({ serverId: SERVER_ID, settings, lines: transcript.recent(50), status: status(), devices, logs: logs.slice(-60), presets: presetsPayload() });

  function sse(req, res, url) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(':ok\n\n');
    const client = { res, role: url.searchParams.get('role') || 'page' };
    clients.add(client);
    res.write(`event: init\ndata: ${JSON.stringify(stateSnapshot())}\n\n`);
    const hb = setInterval(() => res.write(':hb\n\n'), 15_000);
    req.on('close', () => { clearInterval(hb); clients.delete(client); });
  }

  async function api(req, res, p) {
    if (req.method === 'GET') {
      if (p === '/api/state') return send(res, 200, stateSnapshot());
      if (p === '/api/devices') return send(res, 200, await refreshDevices());
      if (p === '/api/transcript') return send(res, 200, transcript.toText(), MIME['.txt']);
      if (p === '/api/recordings') return send(res, 200, recorder.list());
      if (p === '/api/presets') return send(res, 200, presetsPayload());
      return send(res, 404, { error: 'unknown endpoint' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const body = await readJson(req);
    switch (p) {
      case '/api/settings':
        return send(res, 200, { changed: applySettings(body.patch || body, body.from), settings });
      case '/api/clear':
        transcript.clear();
        broadcast('clear', {});
        log('info', 'display cleared');
        return send(res, 200, { ok: true });
      case '/api/reconnect':
        if (!stream) return send(res, 400, { error: credsError || 'no stream in demo mode' });
        stream.reconnect('requested from UI');
        return send(res, 200, { ok: true });
      case '/api/presets':
        try { return send(res, 200, presetAction(body)); } catch (err) { return send(res, 400, { error: err.message }); }
      case '/api/recordings/summary': {
        const base = String(body.base || '');
        if (!recorder.list(1000).some((r) => r.base === base)) return send(res, 404, { error: 'unknown recording' });
        if (!summaries.configured) return send(res, 400, { error: 'Add your Anthropic API key in Settings → AI summaries' });
        const queued = summaries.add(base);
        log('info', queued ? `AI summary requested for ${base}` : `AI summary for ${base} already in progress`);
        return send(res, 200, { ok: true, queued, summary: summaries.status() });
      }
      case '/api/recordings/summary-pdf': {
        const base = String(body.base || '');
        if (!recorder.list(1000).some((r) => r.base === base && r.summary)) return send(res, 404, { error: 'no summary for this recording yet' });
        summaries.makePdf(base).then(
          (pdf) => { log('info', `summary PDF made for ${base}`); broadcast('status', status()); },
          (err) => log('error', `summary PDF ${base}: ${err.message}`),
        );
        return send(res, 200, { ok: true });
      }
      case '/api/recordings/resubtitle': {
        const base = String(body.base || '');
        if (!recorder.list(1000).some((r) => r.base === base)) return send(res, 404, { error: 'unknown recording' });
        if (!opts.resubtitle) return send(res, 400, { error: 'cloud link not available' });
        const cloud = opts.cloudStatus ? opts.cloudStatus() : null;
        if (!cloud || !cloud.loggedIn) return send(res, 400, { error: 'Log in to the cloud server in Settings → Cloud first' });
        // live codes → the cloud's upload languages (ENGINES / TARGETS in server/lib/jobs.js)
        const SOURCE = { yue: 'yue', zh: 'zh', zh_en: 'mixed', en: 'en', ja: 'ja', ko: 'ko' };
        const TARGET = { zh: 'zh', en: 'en', ja: 'ja', ko: 'ko' };
        const sourceLang = SOURCE[settings.source];
        if (!sourceLang) return send(res, 400, { error: `the cloud does not transcribe "${settings.source}" uploads yet` });
        const targetLang = TARGET[settings.target] || 'none';
        const queued = opts.resubtitle.add({ base, dir: opts.recordingsDir, sourceLang, targetLang });
        log('info', queued ? `re-subtitle requested for ${base} (${sourceLang} → ${targetLang})` : `re-subtitle for ${base} already in progress`);
        return send(res, 200, { ok: true, queued, resubtitle: opts.resubtitle.status() });
      }
      case '/api/recordings/mp4': {
        const base = String(body.base || '');
        if (!recorder.list(1000).some((r) => r.base === base)) return send(res, 404, { error: 'unknown recording' });
        const queued = mp4.add(base);
        log('info', queued ? `MP4 export requested for ${base}` : `MP4 export for ${base} already in progress`);
        return send(res, 200, { ok: true, queued, mp4: mp4.status() });
      }
      case '/api/demo/line':
        if (!DEMO) return send(res, 403, { error: 'demo mode only' });
        transcript.apply({ voiceId: 'demo', sentenceId: String(body.id || 'x'), sourceText: body.sourceText || '', targetText: body.targetText || '', sentenceEnd: !!body.ended, wallStart: Date.now(), wallEnd: Date.now() });
        return send(res, 200, { ok: true });
      case '/api/record': {
        const action = body.action === 'toggle' ? (recorder.recording ? 'stop' : 'start') : body.action;
        if (action === 'start') { startRecording(); return send(res, 200, { ok: true, recorder: recorder.status() }); }
        if (action === 'stop') { const info = await recorder.stop(); return send(res, 200, { ok: true, saved: info, recorder: recorder.status() }); }
        return send(res, 400, { error: 'action must be start, stop or toggle' });
      }
      case '/api/overlay/close':
        if (opts.onCloseOverlay) await opts.onCloseOverlay();
        return send(res, 200, { ok: true });
      case '/api/overlay/open':
        if (!opts.onOpenOverlay) return send(res, 400, { error: 'overlay not available' });
        return send(res, 200, { result: await opts.onOpenOverlay() });
      case '/api/overlay/register':
        overlayRegister(body);
        return send(res, 200, { ok: true });
      case '/api/cloud':
        if (!opts.onCloud) return send(res, 400, { error: 'cloud link not available' });
        try { return send(res, 200, await opts.onCloud(body)); } catch (err) { return send(res, 400, { error: err.message }); }
      default:
        return send(res, 404, { error: 'unknown endpoint' });
    }
  }

  function serveRecording(req, res, name) {
    const file = path.join(opts.recordingsDir, name);
    if (!name || !fs.existsSync(file)) return send(res, 404, 'not found', MIME['.txt']);
    const size = fs.statSync(file).size;
    const ext = path.extname(file);
    const type = ext === '.mp3' ? 'audio/mpeg' : ext === '.mp4' ? 'video/mp4' : ext === '.md' ? 'text/markdown; charset=utf-8' : ext === '.pdf' ? 'application/pdf' : 'text/plain; charset=utf-8';
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      end = Math.min(end, size - 1);
      if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }

  const PAGES = { '/': 'index.html', '/control': 'control.html', '/playback': 'playback.html', '/summary': 'summary.html' };
  function authorised(req, url) {
    if (!opts.token) return true;
    if (url.searchParams.get('token') === opts.token) return true;
    const cookie = req.headers.cookie || '';
    return cookie.split(';').some((c) => c.trim() === `token=${opts.token}`);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    try {
      if (!authorised(req, url)) return send(res, 401, 'unauthorised', MIME['.txt']);
      if (p === '/events') return sse(req, res, url);
      if (p.startsWith('/api/')) return await api(req, res, p);
      if (p === '/schema.js') return send(res, 200, fs.readFileSync(opts.schemaFile), MIME['.js']);
      if (p.startsWith('/recordings/')) return serveRecording(req, res, path.basename(decodeURIComponent(p.slice('/recordings/'.length))));
      const rel = PAGES[p] || p.slice(1);
      const full = path.join(opts.webDir, path.normalize(rel));
      if (!full.startsWith(opts.webDir + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        return send(res, 404, 'not found', MIME['.txt']);
      }
      const extra = {};
      if (opts.token && PAGES[p]) extra['set-cookie'] = `token=${opts.token}; Path=/; SameSite=Strict`;
      return send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream', extra);
    } catch (err) {
      log('error', `${req.method} ${p}: ${err.message}`);
      if (!res.headersSent) send(res, 500, { error: err.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || 0, opts.host || '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  log('info', `local server on ${base}${DEMO ? ' (demo)' : ''}`);

  if (capture) capture.start();
  if (stream) stream.start();
  if (!DEMO) refreshDevices();

  let shuttingDown = null;
  function shutdown() {
    if (shuttingDown) return shuttingDown;
    shuttingDown = (async () => {
      log('info', 'shutting down local server');
      emitter.emit('shutdown');
      clearInterval(statusTimer);
      if (stream) stream.stop();
      if (recorder.recording) { try { await recorder.stop(); } catch (err) { log('error', `stopping recording: ${err.message}`); } }
      if (capture) capture.stop();
      for (const c of clients) c.res.end();
      clients.clear();
      await new Promise((r) => server.close(r));
    })();
    return shuttingDown;
  }

  return {
    port,
    base,
    token: opts.token || null,
    emitter,
    server,
    demo: DEMO,
    log,
    status,
    stateSnapshot,
    get settings() { return settings; },
    applySettings,
    overlayRegister,
    startRecording,
    stopRecording: () => recorder.stop(),
    get recording() { return recorder.recording; },
    recordingsDir: opts.recordingsDir,
    pageUrl: (page = '/', extra = '') => `${base}${page}${opts.token ? `${page.includes('?') ? '&' : '?'}token=${opts.token}` : ''}${extra}`,
    shutdown,
  };
}

module.exports = { createLocalServer };
