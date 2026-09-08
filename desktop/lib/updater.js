'use strict';
// App updates from the hosted server. Two paths:
//  1. electron-updater against <server>/updates (latest-mac.yml + zip): downloads in the background and
//     installs on restart. Needs a code-signed app; the running app and the update must carry the same signature.
//  2. Fallback when that is not possible (unsigned build, dev copy): compare the server's latest version and
//     offer to open the DMG for a manual drag-to-Applications.
const { app, dialog, shell } = require('electron');

function compareVersions(a, b) {
  const pa = String(a || '0').split('-')[0].split('.').map((n) => Number(n) || 0);
  const pb = String(b || '0').split('-')[0].split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

class Updater {
  constructor({ cloud, log, packaged }) {
    this.cloud = cloud;
    this.log = log || (() => {});
    this.packaged = !!packaged;
    this.state = { checking: false, available: null, downloading: false, downloaded: false, error: null, lastCheck: null, current: app.getVersion() };
    this.au = null;
  }

  status() { return { ...this.state }; }

  _autoUpdater() {
    if (this.au) return this.au;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('download-progress', (p) => { this.state.downloading = true; this.state.percent = Math.round(p.percent || 0); });
    autoUpdater.on('update-downloaded', async (info) => {
      this.state.downloading = false;
      this.state.downloaded = true;
      this.log('info', `update ${info.version} downloaded`);
      const r = await dialog.showMessageBox({ type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1, message: `Subtitles ${info.version} is ready`, detail: 'Restart to finish the update. It will also install the next time you quit.' });
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.on('error', (err) => { this.state.downloading = false; this._fallback(err).catch(() => {}); });
    this.au = autoUpdater;
    return autoUpdater;
  }

  /** Check the server. interactive = the user asked (always show a dialog). */
  async check({ interactive = false } = {}) {
    if (this.state.checking) return this.state.available;
    this.state.checking = true;
    this.state.error = null;
    try {
      const info = await this.cloud.checkVersion();
      this.state.lastCheck = Date.now();
      const current = app.getVersion();
      if (!info || !info.version || compareVersions(info.version, current) <= 0) {
        this.state.available = null;
        if (interactive) await dialog.showMessageBox({ message: `Subtitles ${current} is up to date.`, detail: info && info.version ? `Latest on ${this.cloud.cfg.url}: ${info.version}` : 'No release has been published on the server yet.' });
        return null;
      }
      this.state.available = info;
      this.log('info', `update available: ${info.version} (running ${current})`);
      if (!this.packaged) {
        if (interactive) await dialog.showMessageBox({ message: `Version ${info.version} is available`, detail: 'This copy runs from source. Update it with "git pull" in the repo and restart, or install the packaged app from the DMG.' });
        return info;
      }
      try {
        const au = this._autoUpdater();
        au.setFeedURL({ provider: 'generic', url: `${this.cloud.cfg.url.replace(/\/$/, '')}/updates` });
        this.state.downloading = true;
        await au.checkForUpdates();
        if (interactive) await dialog.showMessageBox({ message: `Downloading Subtitles ${info.version}…`, detail: 'You will be asked to restart when it is ready.' });
      } catch (err) {
        await this._fallback(err);
      }
      return info;
    } catch (err) {
      this.state.error = err.message;
      if (interactive) await dialog.showMessageBox({ type: 'warning', message: 'Update check failed', detail: err.message });
      return null;
    } finally {
      this.state.checking = false;
    }
  }

  async _fallback(err) {
    const info = this.state.available;
    this.state.error = `automatic install unavailable: ${err.message}`;
    this.log('warn', this.state.error);
    if (!info || this._offered === info.version) return;
    this._offered = info.version;
    const r = await dialog.showMessageBox({ type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1, message: `Subtitles ${info.version} is available`, detail: 'This copy cannot update itself in place. Download the new version, open the DMG and drag Subtitles to Applications.' });
    if (r.response === 0 && (info.dmg || info.zip)) shell.openExternal(info.dmg || info.zip);
  }
}

module.exports = { Updater, compareVersions };
