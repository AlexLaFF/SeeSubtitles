'use strict';
// Subtitles desktop app (macOS). Owns the local pipeline server, the Control / Display / Overlay windows,
// the Settings window (Tencent keys in the Keychain via safeStorage) and the optional cloud mirror.
const { app, BrowserWindow, Menu, screen, ipcMain, dialog, safeStorage, systemPreferences, shell, Tray, nativeImage, nativeTheme, clipboard, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getCredentials } = require('@subs/core');
const { createLocalServer } = require('./local-server');
const i18n = require('./lib/i18n');
const { t } = i18n;
const { DEFAULT_URL: DEFAULT_CLOUD_URL } = require('./cloud');
const helpers = require('./lib/helpers');
const { CloudLink } = require('./cloud');

const PACKAGED = app.isPackaged;
const WEB_DIR = PACKAGED ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');
i18n.load(WEB_DIR);
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
  language: 'system', // system | en | zh — every window, menu and dialog
  summaryModel: 'deepseek-v4-flash', summaryLanguage: 'zh', summaryEffort: 'high', // Chinese models through TokenHub, reached through the account: no key on this Mac
  recordingsDir: path.join(app.getPath('videos'), 'See Subtitles'),
  demo: false, audioFile: '', edge: 'auto', bitrate: '128k', startPaused: true,
  mp4: { auto: true, size: '1080x1920', fontSize: 64, show: 'target', fps: 15, encoder: 'libx264' },
  cloud: { url: DEFAULT_CLOUD_URL, email: '', token: '', publish: false },
  glossary: [],        // [{term, weight, note}] → the pipeline's hotwords; synced with the account (Live › Glossary)
  firstRunDone: null,  // null = never decided (older configs): settled at start-up from what the config already holds
  lastRequestSeen: 0,  // id of the newest account request the administrator was notified about
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
/**
 * The user's own Tencent keys, entered in Settings to run without an account; null otherwise. Logged in, none
 * are needed and none are ever sent here: the subtitle server keeps its key and signs or carries every talk.
 */
function resolveKeys(cfg) {
  if (!cfg.secretKeyEnc) return null;
  return { source: 'manual', appid: cfg.appid, secretId: cfg.secretId, secretKey: decryptSecret(cfg.secretKeyEnc) };
}
/**
 * Summary generator settings. Logged in, the request goes through the hosted server, which adds its own
 * TokenHub key — so no summary key is kept on this Mac either. Logged out there is no key to use, and so no
 * summaries.
 */
function summaryConfig(cfg) {
  const model = cfg.summaryModel && /^(deepseek|kimi|minimax|hy)/.test(cfg.summaryModel) ? cfg.summaryModel : 'deepseek-v4-flash';
  const cloudCfg = cloudConfig(cfg);
  if (cloudCfg.token) {
    const base = String(cloudCfg.url || DEFAULT_CLOUD_URL).replace(/\/$/, '');
    // the SDK insists on an apiKey and sends it as x-api-key; the server reads the bearer header instead
    return { apiKey: 'sent-as-bearer', baseURL: `${base}/api/desktop/tokenhub`, headers: { authorization: `Bearer ${cloudCfg.token}` }, model };
  }
  return { apiKey: '', baseURL: 'https://tokenhub.tencentmaas.com', model };
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
const { JobImporter } = require('./lib/import-job');
// A finished cloud job is copied into the recordings folder so an added file behaves like any recording.
const jobImporter = new JobImporter({
  cloud,
  dir: () => loadConfig().recordingsDir,
  getMap: () => loadConfig().importedJobs || {},
  setMap: (map) => { const c = loadConfig(); c.importedJobs = map; saveConfig(c); },
  log: (level, text) => (core ? core.log(level, text) : consoleLog(level, text)),
});
const updater = new Updater({ cloud, log: (level, text) => (core ? core.log(level, `updates: ${text}`) : consoleLog(level, `updates: ${text}`)), packaged: PACKAGED });

function consoleLog(level, text) {
  const ts = new Date().toTimeString().slice(0, 8);
  (level === 'error' ? console.error : console.log)(`${ts} ${level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·'} ${text}`);
}

function applyLanguage(cfg) { return i18n.setLanguage(i18n.resolve(cfg.language, app.getLocale())); }

/**
 * Whether the server trusts this account to send its audio straight to Tencent (server/lib/plans.js, directLive):
 * the plan if it has arrived, otherwise what it said last time — so a restart does not open a talk on the wrong
 * route while /api/me is on its way. null when neither is known, and the talk then goes through the server. Only
 * a hint: the server refuses to sign for an account it does not trust, whatever this says.
 */
function routeTrust() {
  const p = cloud.plan;
  if (p && p.limits) return !!p.limits.directLive;
  const last = loadConfig().cloud.directLive;
  return typeof last === 'boolean' ? last : null;
}

async function startCore() {
  const cfg = loadConfig();
  applyLanguage(cfg);
  let creds = null;
  let cloudLive = null;
  let liveUrls = null;
  let credsError = null;
  if (!cfg.demo) {
    const keys = resolveKeys(cfg);
    if (keys && keys.source === 'manual') {
      // The user's own Tencent key, entered in Settings: theirs to spend, so it signs here as it always did.
      try {
        creds = getCredentials({ TENCENT_APPID: keys.appid, TENCENT_SECRET_ID: keys.secretId, TENCENT_SECRET_KEY: keys.secretKey });
      } catch (err) {
        credsError = err.message.replace(/ in \.env.*$/, ' — open Settings (⌘,) and check the Tencent Cloud keys');
      }
    } else if (cfg.cloud.token) {
      // Logged in: this Mac holds no Tencent key. The audio goes through the hosted server, which counts it —
      // or, for an account the server trusts, straight to Tencent on connections the server signs.
      const cc = cloudConfig(cfg);
      cloudLive = { url: cc.url || DEFAULT_CLOUD_URL, token: cc.token };
      liveUrls = (req) => cloud.liveUrls(req); // only ever reached for an account the server trusts
    } else {
      credsError = 'not logged in — open Settings (⌘,) and log in to seesubtitles.com, or enter your own Tencent keys';
    }
  }
  core = await createLocalServer({
    webDir: WEB_DIR,
    schemaFile: SCHEMA_FILE,
    dataDir: USER_DATA,
    recordingsDir: cfg.recordingsDir,
    transcriptsDir: path.join(USER_DATA, 'transcripts'),
    creds,
    cloudLive,
    liveUrls,
    // whether the server trusts this account to send its audio straight to Tencent (core/route-stream.js)
    trusted: routeTrust,
    credsError,
    summary: summaryConfig(cfg),
    demo: cfg.demo,
    audioFile: cfg.audioFile || undefined,
    port,
    token: TOKEN,
    env: {
      TENCENT_EDGE: cfg.edge,
      START_PAUSED: cfg.startPaused === false ? '0' : '1',
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
    onLiveUsage: (seconds) => (cloud.status().loggedIn ? cloud.reportLive(seconds) : null),
    resubtitle,
    uploads,
    cloudJobs: async () => (cloud.status().loggedIn ? jobImporter.annotate(await cloud._fetch('/api/jobs', null, { method: 'GET' })) : []),
    onOpenDisplay: ({ fullscreen } = {}) => { const w = openDisplay(); if (fullscreen) w.setFullScreen(true); },
    displayStatus: () => ({ open: !!(wins.display && !wins.display.isDestroyed()), fullscreen: !!(wins.display && !wins.display.isDestroyed() && wins.display.isFullScreen()) }),
    onOpenExternal: (url) => shell.openExternal(url),
    onOpenFolder: () => shell.openPath(loadConfig().recordingsDir),
    onTrash: async (paths) => { for (const f of paths) await shell.trashItem(f); },
    language: i18n.lang,
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
      let r;
      try {
        r = body.action === 'signup' ? await cloud.signup(body.url, body.email, body.password, body.invite) : await cloud.login(body.url, body.email, body.password, body.code);
      } catch (err) {
        // the login card asks for the code and calls again; Error.code does not survive IPC, so answer with a value
        if (err && (err.code === 'totp_required' || err.code === 'totp_bad')) return { ok: false, totp: err.code };
        throw err;
      }
      cfg.cloud = { ...cfg.cloud, url: r.url, email: body.email, token: encryptSecret(r.token) };
      saveConfig(cfg);
      cloud.attach(core, cloudConfig(cfg));
      await cloud.refreshPlan();
      // logged in, the live pipeline runs through the account: start it again on that footing
      restartCore().catch(() => {});
      return { ok: true, cloud: cloud.status() };
    }
    case 'logout':
      cfg.cloud = { ...cfg.cloud, token: '', publish: false, directLive: undefined };
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
    // Account management inside the app (the same routes the hosted Account page uses)
    case 'password':
      await cloud._fetch('/api/account/password', { current: body.current, next: body.next });
      return { ok: true };
    case 'devices':
      return { ok: true, devices: await cloud._fetch('/api/account/tokens', null, { method: 'GET' }) };
    case 'revoke':
      return { ok: true, ...(await cloud._fetch('/api/account/tokens/revoke', body.all ? { all: true } : { id: body.id })) };
    case 'glossary': {
      // { items } stores the list on the account; without items it fetches the account's list
      if (Array.isArray(body.items)) return { ok: true, ...(await cloud._fetch('/api/glossary', { items: body.items }, { method: 'PUT' })) };
      return { ok: true, ...(await cloud._fetch('/api/glossary', null, { method: 'GET' })) };
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
    const w = new BrowserWindow({ width: 1320, height: 860, minWidth: 980, minHeight: 600, title: 'See Subtitles', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, backgroundColor: nativeTheme.shouldUseDarkColors ? '#191816' : '#f5f2eb', webPreferences: SHELL_PREFS }); // Marquee window colours (web/tokens.css)
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
      roundedCorners: false, // macOS rounds frameless windows by default; the corners show on a square screen
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
    dialog.showErrorBox(t('dlg.recording'), err.message);
  }
}

// Always reachable while presenting on another screen.
let tray = null;
function rebuildTray() {
  if (!tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png')); // the stack mark; macOS tints template images itself
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setTitle('字幕');
    tray.setToolTip('See Subtitles');
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.open'), click: openControl },
    { label: t('tray.overlay'), click: openOverlay },
    ...displays().map((d) => ({ label: `${t('tray.fill', { label: d.label })}${d.primary ? t('ctl.main') : ''} — ${d.bounds.width}×${d.bounds.height}`,
      click: () => { openOverlay(); core.applySettings({ window: d.bounds }, null); applyOverlayBounds(d.bounds); reportOverlay(); } })),
    { label: t('tray.reload'), click: () => { if (wins.overlay) wins.overlay.reload(); } },
    { label: t('tray.close'), click: closeOverlay },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => app.quit() },
  ]));
}

// ------------------------------------------------------------------ menu
function rebuildMenu() {
  const cfg = loadConfig();
  const template = [
    { label: app.name, submenu: [
      { role: 'about' },
      { label: t('menu.checkUpdates'), click: () => updater.check({ interactive: true }) },
      { type: 'separator' },
      { label: t('menu.settings'), accelerator: 'Cmd+,', click: openSettings },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    { label: t('menu.file'), submenu: [
      { label: t('menu.addFile'), accelerator: 'Cmd+O', click: async () => { const p = await chooseMediaFile(); if (p && core) navigate('files'); if (p && core) core.addFile(p); } },
      { label: core && core.recording ? t('menu.stopRecording') : t('menu.startRecording'), accelerator: 'Shift+Cmd+R', click: toggleRecording },
      { type: 'separator' },
      { label: t('menu.openFolder'), click: () => shell.openPath(cfg.recordingsDir) },
    ] },
    { role: 'editMenu' },
    { label: t('menu.view'), submenu: [
      { label: t('menu.live'), accelerator: 'Cmd+1', click: () => navigate('live') },
      { label: t('menu.files'), accelerator: 'Cmd+2', click: () => navigate('files') },
      { type: 'separator' },
      { label: t('menu.displayWindow'), accelerator: 'Cmd+3', click: openDisplay },
      { label: t('menu.overlayWindow'), accelerator: 'Cmd+4', click: toggleOverlay },
      { label: t('menu.fullscreenDisplay'), accelerator: 'Ctrl+Cmd+F', click: () => { const w = openDisplay(); w.setFullScreen(!w.isFullScreen()); } },
      { type: 'separator' },
      { label: t('menu.pause'), click: () => core && core.applySettings({ streaming: !core.settings.streaming }, null) },
      { label: t('menu.clear'), click: () => core && core.clear() },
      { type: 'separator' },
      { label: t('menu.demo'), type: 'checkbox', checked: !!cfg.demo, click: (item) => { const c = loadConfig(); c.demo = item.checked; saveConfig(c); restartCore(); } },
      { label: t('menu.restart'), click: () => restartCore() },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' },
    ] },
    { role: 'windowMenu' },
    { label: t('menu.help'), submenu: [
      { label: t('menu.shortcuts'), click: () => dialog.showMessageBox({ message: t('dlg.shortcutsTitle'), detail: t('dlg.shortcutsBody') }) },
      { label: t('menu.openSite'), click: () => shell.openExternal('https://seesubtitles.com') },
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
    ...cfg, summaryKeyEnc: undefined, secretKeyEnc: undefined, secretKeySet: !!cfg.secretKeyEnc,
    cloudKeysEnc: undefined, keysSource: keys ? keys.source : null,
    cloud: { ...cfg.cloud, token: undefined, loggedIn: !!cfg.cloud.token },
    version: app.getVersion(), packaged: PACKAGED, defaultCloudUrl: DEFAULT_CLOUD_URL, language: cfg.language || 'system',
  };
});
ipcMain.handle('config:save', async (_e, patch) => {
  const cfg = loadConfig();
  const next = { ...cfg, ...patch, mp4: { ...cfg.mp4, ...(patch.mp4 || {}) }, cloud: cfg.cloud };
  delete next.secretKey;
  delete next.summaryKey; delete next.summaryKeySet; delete next.summaryKeyEnc; delete next.summaryProvider; delete next.summaryKeyFromCloud;
  delete next.secretKeySet;
  delete next.keysSource; delete next.cloudKeysAt; delete next.cloudKeysEnc; delete next.version; delete next.packaged; delete next.defaultCloudUrl; delete next.clearOwnKeys; delete next.restart;
  if (patch.secretKey) next.secretKeyEnc = encryptSecret(String(patch.secretKey).trim());
  if (patch.clearOwnKeys) { next.secretKeyEnc = ''; next.appid = ''; next.secretId = ''; } // back to the account, which needs no key here
  next.appid = String(next.appid || '').trim();
  next.secretId = String(next.secretId || '').trim();
  saveConfig(next);
  if (patch.language !== undefined && patch.language !== cfg.language) {
    const l = applyLanguage(next);
    if (core) core.setLanguage(l);
    rebuildMenu();
    rebuildTray();
  }
  if (patch.restart !== false) await restartCore();
  return { ok: true };
});
ipcMain.handle('config:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(wins.settings, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('files:choose', () => chooseMediaFile());
ipcMain.handle('clipboard:image', (_e, dataUrl) => { clipboard.writeImage(nativeImage.createFromDataURL(String(dataUrl))); return { ok: true }; });
ipcMain.handle('files:saveImage', async (_e, dataUrl, name) => {
  const ext = /^data:image\/jpeg/.test(String(dataUrl)) ? 'jpg' : 'png';
  const r = await dialog.showSaveDialog(wins.control || undefined, { defaultPath: path.join(app.getPath('downloads'), String(name || `share.${ext}`)), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return { ok: true, path: r.filePath };
});
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
// Administrators hear about new account requests from the website: a macOS notification (click opens the Account
// page on the web) and a badge on the Dock icon while requests are waiting.
function notifyRequests(r) {
  const cfg = loadConfig();
  if (app.dock) app.dock.setBadge(r && r.count ? String(r.count) : '');
  const fresh = ((r && r.latest) || []).filter((x) => x.id > Number(cfg.lastRequestSeen || 0));
  if (!fresh.length) return;
  const top = fresh[0];
  if (Notification.isSupported()) {
    const n = new Notification({ title: t('notify.requestTitle', { n: fresh.length }), body: t('notify.requestBody', { who: top.name || top.email, org: top.org || '', note: (top.note || '').slice(0, 120) }) });
    n.on('click', () => shell.openExternal(`${cfg.cloud.url || DEFAULT_CLOUD_URL}/account`));
    n.show();
  }
  cfg.lastRequestSeen = Math.max(...fresh.map((x) => Number(x.id) || 0));
  saveConfig(cfg);
}
cloud.onPending = notifyRequests;
// Which way the live audio goes depends on who the account is, and that arrives with its plan: remember the answer,
// and let the pipeline move a talk in progress if it changed.
cloud.onPlan = (plan) => {
  const trusted = !!(plan && plan.limits && plan.limits.directLive);
  const cfg = loadConfig();
  if (cfg.cloud.directLive !== trusted) { cfg.cloud = { ...cfg.cloud, directLive: trusted }; saveConfig(cfg); }
  if (core && core.recheckRoute) core.recheckRoute();
};

app.whenReady().then(async () => {
  const cfg = loadConfig();
  // Versions up to 0.6.9 downloaded the server's Tencent key and kept it here. Nothing reads it any more.
  if (cfg.cloudKeysEnc) { delete cfg.cloudKeysEnc; saveConfig(cfg); consoleLog('info', 'removed the Tencent key an older version had saved on this Mac'); }
  // an install that already has an account or keys never sees the first-run cards
  if (cfg.firstRunDone == null) { cfg.firstRunDone = !!(cfg.cloud.token || resolveKeys(cfg) || cfg.demo); saveConfig(cfg); }
  if (!cfg.demo && process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch { /* prompt not available */ }
  }
  await startCore();
  openControl();
  // updates: check shortly after launch and every 6 h
  setTimeout(() => updater.check().catch(() => {}), 15_000);
  setInterval(() => updater.check().catch(() => {}), 6 * 3600_000).unref();
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); // packaged builds get it from the icns
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
