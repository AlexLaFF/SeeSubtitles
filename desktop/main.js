'use strict';
// Subtitles desktop app (macOS). Owns the local pipeline server, the Control / Display / Overlay windows,
// the Settings window (Tencent keys in the Keychain via safeStorage) and the optional cloud mirror.
const { app, BrowserWindow, Menu, screen, ipcMain, dialog, safeStorage, systemPreferences, shell, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getCredentials } = require('@subs/core');
const { createLocalServer } = require('./local-server');
const { DEFAULT_URL: DEFAULT_CLOUD_URL } = require('./cloud');
const helpers = require('./lib/helpers');
const { CloudLink } = require('./cloud');

const PACKAGED = app.isPackaged;
const WEB_DIR = PACKAGED ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');
const BIN_DIR = PACKAGED ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'resources', 'bin');
const SCHEMA_FILE = require.resolve('@subs/core/schema');
app.setName('See Subtitles');
if (process.env.SUBTITLES_USER_DATA) app.setPath('userData', path.resolve(process.env.SUBTITLES_USER_DATA));
else {
  // the data folder is named after the app; carry the files over from the old name ("Subtitles") once
  const cur = app.getPath('userData');
  const old = path.join(path.dirname(cur), 'Subtitles');
  if (!fs.existsSync(path.join(cur, 'config.json')) && fs.existsSync(path.join(old, 'config.json'))) {
    try {
      fs.mkdirSync(cur, { recursive: true });
      for (const f of ['config.json', 'settings.json', 'presets.json', 'transcripts']) if (fs.existsSync(path.join(old, f))) fs.cpSync(path.join(old, f), path.join(cur, f), { recursive: true });
    } catch { /* keep going with a fresh folder */ }
  }
}
const USER_DATA = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DATA, 'config.json');
const TOKEN = crypto.randomBytes(16).toString('hex');

helpers.configure({ binDir: BIN_DIR, packaged: PACKAGED });
// bundled ffmpeg/ffprobe first; Homebrew paths as a fallback during development
process.env.PATH = [BIN_DIR, process.env.PATH || '', '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(':');

// ------------------------------------------------------------------ config
const DEFAULT_CONFIG = {
  appid: '', secretId: '', secretKeyEnc: '',
  cloudKeysEnc: '', // Tencent keys handed out by the server after login (encrypted JSON), used when no manual keys are set
  summaryKeyEnc: '', summaryModel: 'claude-opus-5', summaryLanguage: 'zh', summaryEffort: 'high',
  recordingsDir: path.join(app.getPath('videos'), 'See Subtitles'),
  demo: false, audioFile: '', edge: 'auto', bitrate: '128k', startPaused: true,
  mp4: { auto: true, size: '1080x1920', fontSize: 64, show: 'target', fps: 15, encoder: 'libx264' },
  cloud: { url: DEFAULT_CLOUD_URL, email: '', token: '', publish: false },
};
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const cfg = { ...DEFAULT_CONFIG, ...raw, mp4: { ...DEFAULT_CONFIG.mp4, ...(raw.mp4 || {}) }, cloud: { ...DEFAULT_CONFIG.cloud, ...(raw.cloud || {}) } };
    if (!cfg.cloud.url) cfg.cloud.url = DEFAULT_CLOUD_URL;
    return cfg;
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
  // the Keychain item is tied to the app name; after a rename older secrets cannot be read — treat them as unset
  if (stored.startsWith('enc:')) { try { return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')); } catch { return ''; } }
  if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  return stored;
}
// The cloud login token is stored encrypted like the API keys (older configs hold it in clear; decryptSecret accepts both).
const cloudConfig = (cfg) => ({ ...cfg.cloud, token: decryptSecret(cfg.cloud.token) });
/** Which Tencent keys the pipeline uses: the user's own (Settings) win over the ones the server handed out. */
function resolveKeys(cfg) {
  if (cfg.secretKeyEnc) return { source: 'manual', appid: cfg.appid, secretId: cfg.secretId, secretKey: decryptSecret(cfg.secretKeyEnc) };
  if (cfg.cloudKeysEnc) {
    try { const k = JSON.parse(decryptSecret(cfg.cloudKeysEnc)); return { source: 'cloud', ...k }; } catch { /* corrupt; ignore */ }
  }
  return null;
}
/** Ask the server for the Tencent keys (after login, and once a day). Returns true when they changed. */
async function refreshCloudKeys(cfg) {
  const r = await cloud.fetchCredentials();
  if (!r || !r.tencent || !r.tencent.secretKey) throw new Error('the server did not return keys');
  const next = encryptSecret(JSON.stringify({ ...r.tencent, fetchedAt: Date.now() }));
  const before = cfg.cloudKeysEnc ? decryptSecret(cfg.cloudKeysEnc) : '';
  const changed = !before || JSON.parse(before).secretKey !== r.tencent.secretKey || JSON.parse(before).appid !== r.tencent.appid;
  cfg.cloudKeysEnc = next;
  saveConfig(cfg);
  return changed;
}

// ------------------------------------------------------------------ core (local pipeline server)
let core = null;
let port = 0;
const cloud = new CloudLink({ log: (level, text) => core && core.log(level, `cloud: ${text}`) });
const { ResubtitleQueue } = require('./lib/resubtitle');
const resubtitle = new ResubtitleQueue({ cloud, log: (level, text) => core && core.log(level, text) });
const { Updater } = require('./lib/updater');
const { UploadQueue } = require('./lib/uploads');
const uploads = new UploadQueue({ cloud, log: (level, text) => core && core.log(level, text) });
const updater = new Updater({ cloud, log: (level, text) => (core ? core.log(level, `updates: ${text}`) : consoleLog(level, `updates: ${text}`)), packaged: PACKAGED });

function consoleLog(level, text) {
  const ts = new Date().toTimeString().slice(0, 8);
  (level === 'error' ? console.error : console.log)(`${ts} ${level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·'} ${text}`);
}

async function startCore() {
  const cfg = loadConfig();
  let creds = null;
  let credsError = null;
  if (!cfg.demo) {
    const keys = resolveKeys(cfg);
    if (!keys) credsError = cfg.cloud.token ? 'no Tencent keys yet — the server should provide them after login; open Settings (⌘,) and log in again' : 'not logged in — open Settings (⌘,) and log in to seesubtitles.com (the keys come from the server), or enter Tencent keys';
    else {
      try {
        creds = getCredentials({ TENCENT_APPID: keys.appid, TENCENT_SECRET_ID: keys.secretId, TENCENT_SECRET_KEY: keys.secretKey });
      } catch (err) {
        credsError = err.message.replace(/ in \.env.*$/, keys.source === 'cloud' ? ' — the keys from the server look invalid' : ' — open Settings (⌘,) and check the Tencent Cloud keys');
      }
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
    summaryApiKey: decryptSecret(cfg.summaryKeyEnc),
    demo: cfg.demo,
    audioFile: cfg.audioFile || undefined,
    port,
    token: TOKEN,
    env: {
      TENCENT_EDGE: cfg.edge,
      START_PAUSED: cfg.startPaused === false ? '0' : '1',
      SUMMARY_MODEL: cfg.summaryModel,
      SUMMARY_LANGUAGE: cfg.summaryLanguage,
      SUMMARY_EFFORT: cfg.summaryEffort,
      RECORD_BITRATE: cfg.bitrate,
      MP4_AUTO: cfg.mp4.auto ? '1' : '0',
      MP4_SIZE: cfg.mp4.size,
      MP4_FONT_SIZE: String(cfg.mp4.fontSize),
      MP4_SHOW: cfg.mp4.show,
      MP4_FPS: String(cfg.mp4.fps),
      MP4_ENCODER: cfg.mp4.encoder,
    },
    onOpenOverlay: () => { openOverlay(); return 'opened'; },
    onCloseOverlay: closeOverlay,
    onCloud: (body) => cloudAction(body),
    cloudStatus: () => cloud.status(),
    resubtitle,
    uploads,
    cloudJobs: async () => (cloud.status().loggedIn ? cloud._fetch('/api/jobs', null, { method: 'GET' }) : []),
    onOpenDisplay: ({ fullscreen } = {}) => { const w = openDisplay(); if (fullscreen) w.setFullScreen(true); },
    displayStatus: () => ({ open: !!(wins.display && !wins.display.isDestroyed()), fullscreen: !!(wins.display && !wins.display.isDestroyed() && wins.display.isFullScreen()) }),
    onOpenExternal: (url) => shell.openExternal(url),
    onOpenFolder: () => shell.openPath(loadConfig().recordingsDir),
    consoleLog,
  });
  port = core.port;
  if (!PACKAGED) consoleLog('info', `dev: control page ${core.pageUrl('/control')}`);
  core.emitter.on('event', (ev, data) => {
    if (ev === 'settings' && data.changed && data.changed.includes('window')) applyOverlayBounds(data.settings.window);
    cloud.onEvent(ev, data);
  });
  cloud.attach(core, cloudConfig(cfg));
  rebuildMenu();
  reportOverlay();
}

async function restartCore() {
  const old = core;
  core = null;
  cloud.detach();
  if (old) await old.shutdown();
  await startCore();
  for (const name of ['control', 'display', 'overlay']) {
    const w = wins[name];
    if (w && !w.isDestroyed()) w.reload();
  }
  reportOverlay();
}

async function cloudAction(body) {
  const cfg = loadConfig();
  switch (body.action) {
    case 'login':
    case 'signup': {
      const r = body.action === 'signup' ? await cloud.signup(body.url, body.email, body.password, body.invite) : await cloud.login(body.url, body.email, body.password);
      cfg.cloud = { ...cfg.cloud, url: r.url, email: body.email, token: encryptSecret(r.token) };
      saveConfig(cfg);
      cloud.attach(core, cloudConfig(cfg));
      // keys come from the server; start the pipeline with them unless the user entered their own
      let keys = 'unchanged';
      try { keys = (await refreshCloudKeys(cfg)) ? 'updated' : 'unchanged'; } catch (err) { keys = `unavailable: ${err.message}`; }
      if (!cfg.secretKeyEnc && keys === 'updated') restartCore().catch(() => {});
      return { ok: true, cloud: cloud.status(), keys };
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
const SHELL_PREFS = { ...WEB_PREFS, preload: path.join(__dirname, 'preload.js') }; // the main window talks to this process (settings, file pickers)

function focusOr(name, create) {
  if (wins[name] && !wins[name].isDestroyed()) { wins[name].show(); wins[name].focus(); return wins[name]; }
  const w = create();
  wins[name] = w;
  w.on('closed', () => { if (wins[name] === w) wins[name] = null; });
  return w;
}

function openControl() {
  return focusOr('control', () => {
    const w = new BrowserWindow({ width: 1320, height: 860, minWidth: 980, minHeight: 600, title: 'See Subtitles', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, backgroundColor: '#111111', webPreferences: SHELL_PREFS });
    w.loadURL(core.pageUrl('/control'));
    w.on('enter-full-screen', reportDisplay); w.on('leave-full-screen', reportDisplay);
    return w;
  });
}

function openDisplay() {
  return focusOr('display', () => {
    const w = new BrowserWindow({ width: 1280, height: 720, backgroundColor: '#000000', title: 'See Subtitles — Display', webPreferences: WEB_PREFS });
    w.loadURL(core.pageUrl('/'));
    for (const ev of ['enter-full-screen', 'leave-full-screen', 'closed', 'show']) w.on(ev, reportDisplay);
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
      title: 'See Subtitles — Overlay',
      focusable: false, // keep PowerPoint and the audience menu bar active
      skipTaskbar: true,
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
function closeOverlay() {
  if (wins.overlay && !wins.overlay.isDestroyed()) wins.overlay.close();
  reportOverlay();
}
function toggleOverlay() {
  if (wins.overlay && !wins.overlay.isDestroyed()) wins.overlay.close();
  else openOverlay();
}

/** Show a view of the main window (Live / Files / Settings). */
function navigate(view, params) {
  const w = openControl();
  if (w.webContents.getURL().includes('/control') || w.webContents.getURL().includes('/files') || w.webContents.getURL().includes('/settings')) w.webContents.send('app:navigate', view, params || {});
  else w.loadURL(core.pageUrl(view === 'files' ? '/files' : view === 'settings' ? '/settings' : '/control'));
}
function openSettings() { navigate('settings'); }
function reportDisplay() { if (core) core.emitter.emit('display'); }

async function toggleRecording() {
  if (!core) return;
  try {
    if (core.recording) await core.stopRecording();
    else core.startRecording();
  } catch (err) {
    dialog.showErrorBox('Recording', err.message);
  }
}

// Always reachable while presenting on another screen.
let tray = null;
function rebuildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('字幕');
    tray.setToolTip('See Subtitles');
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open See Subtitles', click: openControl },
    { label: 'Open overlay', click: openOverlay },
    ...displays().map((d) => ({ label: `Fill: ${d.label}${d.primary ? ' (main)' : ''} — ${d.bounds.width}×${d.bounds.height}`,
      click: () => { openOverlay(); core.applySettings({ window: d.bounds }, null); applyOverlayBounds(d.bounds); reportOverlay(); } })),
    { label: 'Reload overlay', click: () => { if (wins.overlay) wins.overlay.reload(); } },
    { label: 'Close overlay', click: closeOverlay },
    { type: 'separator' },
    { label: 'Quit See Subtitles', click: () => app.quit() },
  ]));
}

// ------------------------------------------------------------------ menu
function rebuildMenu() {
  const cfg = loadConfig();
  const template = [
    { label: app.name, submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => updater.check({ interactive: true }) },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'Cmd+,', click: openSettings },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { label: 'Add File…', accelerator: 'Cmd+O', click: async () => { const p = await chooseMediaFile(); if (p && core) navigate('files'); if (p && core) core.addFile(p); } },
      { label: core && core.recording ? 'Stop Recording' : 'Start Recording', accelerator: 'Shift+Cmd+R', click: toggleRecording },
      { type: 'separator' },
      { label: 'Open Recordings Folder', click: () => shell.openPath(cfg.recordingsDir) },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Live', accelerator: 'Cmd+1', click: () => navigate('live') },
      { label: 'Files', accelerator: 'Cmd+2', click: () => navigate('files') },
      { type: 'separator' },
      { label: 'Display Window', accelerator: 'Cmd+3', click: openDisplay },
      { label: 'Overlay Window', accelerator: 'Cmd+4', click: toggleOverlay },
      { label: 'Full Screen Display', accelerator: 'Ctrl+Cmd+F', click: () => { const w = openDisplay(); w.setFullScreen(!w.isFullScreen()); } },
      { type: 'separator' },
      { label: 'Pause Subtitles', click: () => core && core.applySettings({ streaming: !core.settings.streaming }, null) },
      { label: 'Clear Screen', click: () => core && core.clear() },
      { type: 'separator' },
      { label: 'Demo Mode', type: 'checkbox', checked: !!cfg.demo, click: (item) => { const c = loadConfig(); c.demo = item.checked; saveConfig(c); restartCore(); } },
      { label: 'Restart Pipeline', click: () => restartCore() },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' },
    ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [
      { label: 'Keyboard Shortcuts', click: () => dialog.showMessageBox({ message: 'Keyboard shortcuts', detail: '⇧⌘R  start / stop recording\n⌘1 / ⌘2  Live / Files\n⌘3 / ⌘4  Display / Overlay window\n⌃⌘F  full-screen display\n\nOn the Live and Display pages:\n+ / −  text size (Shift = bigger steps)\n[ / ]  fewer / more sentences kept\nShift+S  translation → both → original\nP  pause / resume subtitles\nX  clear the screen\nC  show / hide the panel (display page)\nF  full screen (display page)' }) },
      { label: 'Open seesubtitles.com', click: () => shell.openExternal('https://seesubtitles.com') },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
async function chooseMediaFile() {
  const r = await dialog.showOpenDialog(wins.control || undefined, { properties: ['openFile'], filters: [{ name: 'Video or audio', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'] }] });
  return r.canceled ? null : r.filePaths[0];
}

// ------------------------------------------------------------------ IPC (settings window)
ipcMain.handle('config:get', () => {
  const cfg = loadConfig();
  const keys = resolveKeys(cfg);
  return {
    ...cfg, summaryKeyEnc: undefined, summaryKeySet: !!cfg.summaryKeyEnc, secretKeyEnc: undefined, secretKeySet: !!cfg.secretKeyEnc,
    cloudKeysEnc: undefined, keysSource: keys ? keys.source : null, cloudKeysAt: keys && keys.source === 'cloud' ? keys.fetchedAt : null,
    cloud: { ...cfg.cloud, token: undefined, loggedIn: !!cfg.cloud.token },
    version: app.getVersion(), packaged: PACKAGED, defaultCloudUrl: DEFAULT_CLOUD_URL,
  };
});
ipcMain.handle('config:save', async (_e, patch) => {
  const cfg = loadConfig();
  const next = { ...cfg, ...patch, mp4: { ...cfg.mp4, ...(patch.mp4 || {}) }, cloud: cfg.cloud };
  delete next.secretKey;
  delete next.summaryKey;
  delete next.summaryKeySet;
  if (patch.summaryKey) next.summaryKeyEnc = encryptSecret(String(patch.summaryKey).trim());
  delete next.secretKeySet;
  delete next.keysSource; delete next.cloudKeysAt; delete next.version; delete next.packaged; delete next.defaultCloudUrl; delete next.useCloudKeys;
  if (patch.secretKey) next.secretKeyEnc = encryptSecret(String(patch.secretKey).trim());
  if (patch.useCloudKeys) { next.secretKeyEnc = ''; next.appid = ''; next.secretId = ''; } // back to the server-provided keys
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
ipcMain.handle('files:choose', () => chooseMediaFile());
ipcMain.handle('config:chooseAudioFile', async () => {
  const r = await dialog.showOpenDialog(wins.settings, { properties: ['openFile'], filters: [{ name: 'WAV (16 kHz mono)', extensions: ['wav', 'pcm'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('core:status', () => (core ? { base: core.base, demo: core.demo, status: core.status() } : null));
ipcMain.handle('core:openControl', () => { openControl(); });
ipcMain.handle('cloud:action', (_e, body) => cloudAction(body));
ipcMain.handle('updates:check', () => updater.check({ interactive: true }));
ipcMain.handle('updates:status', () => updater.status());

// ------------------------------------------------------------------ lifecycle
app.whenReady().then(async () => {
  const cfg = loadConfig();
  if (!cfg.demo && process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch { /* prompt not available */ }
  }
  await startCore();
  openControl();
  if (!cfg.demo && !resolveKeys(cfg)) openSettings();
  // keys from the server: refresh once a day; updates: check shortly after launch and every 6 h
  const keys = resolveKeys(cfg);
  if (cfg.cloud.token && (!keys || (keys.source === 'cloud' && Date.now() - (keys.fetchedAt || 0) > 24 * 3600_000))) {
    setTimeout(() => refreshCloudKeys(loadConfig()).then((changed) => { if (changed && !loadConfig().secretKeyEnc) restartCore(); }).catch((err) => consoleLog('warn', `keys from the server: ${err.message}`)), 3000);
  }
  setTimeout(() => updater.check().catch(() => {}), 15_000);
  setInterval(() => updater.check().catch(() => {}), 6 * 3600_000).unref();
  rebuildTray();
  screen.on('display-added', rebuildTray);
  screen.on('display-removed', rebuildTray);
  screen.on('display-metrics-changed', rebuildTray);
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
