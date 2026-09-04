'use strict';
// Subtitles desktop app (macOS). Owns the local pipeline server, the Control / Display / Overlay windows,
// the Settings window (Tencent keys in the Keychain via safeStorage) and the optional cloud mirror.
const { app, BrowserWindow, Menu, screen, ipcMain, dialog, safeStorage, systemPreferences, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getCredentials } = require('@subs/core');
const { createLocalServer } = require('./local-server');
const helpers = require('./lib/helpers');
const { CloudLink } = require('./cloud');

const PACKAGED = app.isPackaged;
const WEB_DIR = PACKAGED ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');
const BIN_DIR = PACKAGED ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'resources', 'bin');
const SCHEMA_FILE = require.resolve('@subs/core/schema');
const USER_DATA = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DATA, 'config.json');
const TOKEN = crypto.randomBytes(16).toString('hex');

helpers.configure({ binDir: BIN_DIR, packaged: PACKAGED });
// bundled ffmpeg/ffprobe first; Homebrew paths as a fallback during development
process.env.PATH = [BIN_DIR, process.env.PATH || '', '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(':');

// ------------------------------------------------------------------ config
const DEFAULT_CONFIG = {
  appid: '', secretId: '', secretKeyEnc: '',
  recordingsDir: path.join(app.getPath('videos'), 'Subtitles'),
  demo: false, audioFile: '', edge: 'auto', bitrate: '128k',
  mp4: { auto: true, size: '1080x1920', fontSize: 64, show: 'target', fps: 15, encoder: 'libx264' },
  cloud: { url: '', email: '', token: '', publish: false },
};
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw, mp4: { ...DEFAULT_CONFIG.mp4, ...(raw.mp4 || {}) }, cloud: { ...DEFAULT_CONFIG.cloud, ...(raw.cloud || {}) } };
  } catch { return { ...DEFAULT_CONFIG, mp4: { ...DEFAULT_CONFIG.mp4 }, cloud: { ...DEFAULT_CONFIG.cloud } }; }
}
function saveConfig(cfg) {
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
function encryptSecret(plain) {
  if (!plain) return '';
  if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(plain).toString('base64')}`;
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`;
}
function decryptSecret(stored) {
  if (!stored) return '';
  if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  return stored;
}

// ------------------------------------------------------------------ core (local pipeline server)
let core = null;
let port = 0;
const cloud = new CloudLink({ log: (level, text) => core && core.log(level, `cloud: ${text}`) });

function consoleLog(level, text) {
  const ts = new Date().toTimeString().slice(0, 8);
  (level === 'error' ? console.error : console.log)(`${ts} ${level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·'} ${text}`);
}

async function startCore() {
  const cfg = loadConfig();
  let creds = null;
  let credsError = null;
  if (!cfg.demo) {
    try {
      creds = getCredentials({ TENCENT_APPID: cfg.appid, TENCENT_SECRET_ID: cfg.secretId, TENCENT_SECRET_KEY: decryptSecret(cfg.secretKeyEnc) });
    } catch (err) {
      credsError = err.message.replace(/ in \.env.*$/, ' — open Settings (⌘,) and enter the Tencent Cloud keys');
    }
  }
  core = await createLocalServer({
    webDir: WEB_DIR,
    schemaFile: SCHEMA_FILE,
    dataDir: USER_DATA,
    recordingsDir: cfg.recordingsDir,
    transcriptsDir: path.join(USER_DATA, 'transcripts'),
    creds,
    credsError,
    demo: cfg.demo,
    audioFile: cfg.audioFile || undefined,
    port,
    token: TOKEN,
    env: {
      TENCENT_EDGE: cfg.edge,
      RECORD_BITRATE: cfg.bitrate,
      MP4_AUTO: cfg.mp4.auto ? '1' : '0',
      MP4_SIZE: cfg.mp4.size,
      MP4_FONT_SIZE: String(cfg.mp4.fontSize),
      MP4_SHOW: cfg.mp4.show,
      MP4_FPS: String(cfg.mp4.fps),
      MP4_ENCODER: cfg.mp4.encoder,
    },
    onOpenOverlay: () => { openOverlay(); return 'opened'; },
    onCloud: (body) => cloudAction(body),
    cloudStatus: () => cloud.status(),
    consoleLog,
  });
  port = core.port;
  if (!PACKAGED) consoleLog('info', `dev: control page ${core.pageUrl('/control')}`);
  core.emitter.on('event', (ev, data) => {
    if (ev === 'settings' && data.changed && data.changed.includes('window')) applyOverlayBounds(data.settings.window);
    cloud.onEvent(ev, data);
  });
  cloud.attach(core, cfg.cloud);
  rebuildMenu();
}

async function restartCore() {
  const old = core;
  core = null;
  cloud.detach();
  if (old) await old.shutdown();
  await startCore();
  for (const w of BrowserWindow.getAllWindows()) if (w !== wins.settings) w.reload();
}

async function cloudAction(body) {
  const cfg = loadConfig();
  switch (body.action) {
    case 'login': {
      const r = await cloud.login(body.url, body.email, body.password);
      cfg.cloud = { ...cfg.cloud, url: r.url, email: body.email, token: r.token };
      saveConfig(cfg);
      cloud.attach(core, cfg.cloud);
      return { ok: true, cloud: cloud.status() };
    }
    case 'logout':
      cfg.cloud = { ...cfg.cloud, token: '', publish: false };
      saveConfig(cfg);
      cloud.detach();
      return { ok: true, cloud: cloud.status() };
    case 'publish': {
      const on = !!body.on;
      cfg.cloud.publish = on;
      saveConfig(cfg);
      if (on) await cloud.startSession(body.name || '');
      else await cloud.stopSession();
      return { ok: true, cloud: cloud.status() };
    }
    default:
      throw new Error('unknown cloud action');
  }
}

// ------------------------------------------------------------------ windows
const wins = { control: null, display: null, overlay: null, settings: null };
const WEB_PREFS = { contextIsolation: true, sandbox: true };

function focusOr(name, create) {
  if (wins[name] && !wins[name].isDestroyed()) { wins[name].show(); wins[name].focus(); return wins[name]; }
  const w = create();
  wins[name] = w;
  w.on('closed', () => { if (wins[name] === w) wins[name] = null; });
  return w;
}

function openControl() {
  return focusOr('control', () => {
    const w = new BrowserWindow({ width: 1000, height: 780, minWidth: 720, minHeight: 500, title: 'Subtitles — Control', webPreferences: WEB_PREFS });
    w.loadURL(core.pageUrl('/control'));
    return w;
  });
}

function openDisplay() {
  return focusOr('display', () => {
    const w = new BrowserWindow({ width: 1280, height: 720, backgroundColor: '#000000', title: 'Subtitles — Display', webPreferences: WEB_PREFS });
    w.loadURL(core.pageUrl('/'));
    return w;
  });
}

function displays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label || `Display ${d.id}`, bounds: d.bounds, scaleFactor: d.scaleFactor, primary: d.id === primary }));
}
let overlayReportTimer = null;
function reportOverlay() {
  clearTimeout(overlayReportTimer);
  overlayReportTimer = setTimeout(() => {
    if (!core) return;
    const w = wins.overlay;
    if (!w || w.isDestroyed()) return core.overlayRegister({ present: false, displays: displays() });
    core.overlayRegister({ present: true, displays: displays(), bounds: w.getBounds() });
  }, 250);
}
function applyOverlayBounds(b) {
  const w = wins.overlay;
  if (!w || w.isDestroyed() || !b) return;
  const cur = w.getBounds();
  const next = { x: b.x ?? cur.x, y: b.y ?? cur.y, width: b.width ?? cur.width, height: b.height ?? cur.height };
  if (next.x === cur.x && next.y === cur.y && next.width === cur.width && next.height === cur.height) return;
  w.setBounds(next);
}

function openOverlay() {
  return focusOr('overlay', () => {
    const saved = core.settings.window || {};
    const opts = {
      width: saved.width || 900,
      height: saved.height || 360,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: true,
      movable: true,
      minimizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true, // portrait walls, BetterDisplay virtual screens
      backgroundColor: '#00000000',
      title: 'Subtitles — Overlay',
      webPreferences: WEB_PREFS,
    };
    if (Number.isFinite(saved.x)) opts.x = saved.x;
    if (Number.isFinite(saved.y)) opts.y = saved.y;
    const w = new BrowserWindow(opts);
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // stays over a full-screen slideshow
    w.loadURL(core.pageUrl('/?overlay=1'));
    w.on('move', reportOverlay);
    w.on('resize', reportOverlay);
    w.on('closed', reportOverlay);
    reportOverlay();
    return w;
  });
}
function toggleOverlay() {
  if (wins.overlay && !wins.overlay.isDestroyed()) wins.overlay.close();
  else openOverlay();
}

function openSettings() {
  return focusOr('settings', () => {
    const w = new BrowserWindow({
      width: 640, height: 760, minWidth: 520, title: 'Subtitles — Settings', resizable: true,
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
    });
    w.loadFile(path.join(__dirname, 'settings.html'));
    return w;
  });
}

async function toggleRecording() {
  if (!core) return;
  try {
    if (core.recording) await core.stopRecording();
    else core.startRecording();
  } catch (err) {
    dialog.showErrorBox('Recording', err.message);
  }
}

// ------------------------------------------------------------------ menu
function rebuildMenu() {
  const cfg = loadConfig();
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: openSettings },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Subtitles',
      submenu: [
        { label: 'Control Window', accelerator: 'Cmd+1', click: openControl },
        { label: 'Display Window', accelerator: 'Cmd+2', click: openDisplay },
        { label: 'Overlay Window (transparent, always on top)', accelerator: 'Cmd+3', click: toggleOverlay },
        { type: 'separator' },
        { label: 'Start / Stop Recording', accelerator: 'Shift+Cmd+R', click: toggleRecording },
        { label: 'Open Recordings Folder', click: () => shell.openPath(cfg.recordingsDir) },
        { label: 'Open Playback Page', click: () => shell.openExternal(core.pageUrl('/playback')) },
        { type: 'separator' },
        { label: 'Demo Mode (scripted sentences, no microphone)', type: 'checkbox', checked: !!cfg.demo, click: (item) => { const c = loadConfig(); c.demo = item.checked; saveConfig(c); restartCore(); } },
        { label: 'Restart Pipeline', click: () => restartCore() },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ IPC (settings window)
ipcMain.handle('config:get', () => {
  const cfg = loadConfig();
  return { ...cfg, secretKeyEnc: undefined, secretKeySet: !!cfg.secretKeyEnc, cloud: { ...cfg.cloud, token: undefined, loggedIn: !!cfg.cloud.token } };
});
ipcMain.handle('config:save', async (_e, patch) => {
  const cfg = loadConfig();
  const next = { ...cfg, ...patch, mp4: { ...cfg.mp4, ...(patch.mp4 || {}) }, cloud: cfg.cloud };
  delete next.secretKey;
  delete next.secretKeySet;
  if (patch.secretKey) next.secretKeyEnc = encryptSecret(String(patch.secretKey).trim());
  next.appid = String(next.appid || '').trim();
  next.secretId = String(next.secretId || '').trim();
  saveConfig(next);
  if (patch.restart !== false) await restartCore();
  return { ok: true };
});
ipcMain.handle('config:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(wins.settings, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('config:chooseAudioFile', async () => {
  const r = await dialog.showOpenDialog(wins.settings, { properties: ['openFile'], filters: [{ name: 'WAV (16 kHz mono)', extensions: ['wav', 'pcm'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('core:status', () => (core ? { base: core.base, demo: core.demo, status: core.status() } : null));
ipcMain.handle('core:openControl', () => { openControl(); });
ipcMain.handle('cloud:action', (_e, body) => cloudAction(body));

// ------------------------------------------------------------------ lifecycle
app.setName('Subtitles');
app.whenReady().then(async () => {
  const cfg = loadConfig();
  if (!cfg.demo && process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch { /* prompt not available */ }
  }
  await startCore();
  openControl();
  if (!cfg.demo && !cfg.secretKeyEnc) openSettings();
  screen.on('display-added', reportOverlay);
  screen.on('display-removed', reportOverlay);
  screen.on('display-metrics-changed', reportOverlay);
});

app.on('activate', () => { if (core) openControl(); });
app.on('window-all-closed', () => { /* keep the pipeline running in the dock */ });

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  const done = () => app.exit(0);
  setTimeout(done, 6000).unref();
  cloud.detach();
  (core ? core.shutdown() : Promise.resolve()).then(done, done);
});
process.on('uncaughtException', (err) => { consoleLog('error', `uncaught: ${err.stack || err.message}`); });
process.on('unhandledRejection', (err) => { consoleLog('error', `unhandled rejection: ${err && err.stack ? err.stack : err}`); });
