'use strict';
// App updates from the hosted server. Two paths:
//  1. electron-updater against <server>/updates (latest-mac.yml + zip): downloads in the background and
//     installs on restart. Needs a code-signed app; the running app and the update must carry the same signature.
//  2. Fallback when that is not possible (unsigned build, dev copy): compare the server's latest version and
//     offer to open the DMG for a manual drag-to-Applications.
const { app, dialog, shell } = require('electron');
const { t } = require('./i18n');
const { compareVersions } = require('@subs/core/versions');

class Updater {
  /** @param {function} [o.beforeInstall] async () => void — the app's own orderly shutdown, run before the updater is told to quit */
  constructor({ cloud, log, packaged, beforeInstall = null }) {
    this.cloud = cloud;
    this.log = log || (() => {});
    this.packaged = !!packaged;
    this.beforeInstall = beforeInstall;
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
      const r = await dialog.showMessageBox({ type: 'info', buttons: [t('upd.restart'), t('upd.later')], defaultId: 0, cancelId: 1, message: t('upd.ready', { version: info.version }), detail: t('upd.readyDetail') });
      if (r.response === 0) await this._restartToInstall(autoUpdater);
    });
    autoUpdater.on('error', (err) => { this.state.downloading = false; this._fallback(err).catch(() => {}); });
    this.au = autoUpdater;
    return autoUpdater;
  }

  /**
   * Restart into the update. The updater's helper (ShipIt) swaps the app only once this process is gone, and waits
   * for that for ever — on 2026-09-22 it waited, the app never went, and the Mac had to be force-quit. So nothing is
   * left to chance here: the app shuts its own things down first (with a deadline), the updater's quit is then let
   * through rather than cancelled and redone, and if the process is somehow still here ten seconds later it exits
   * outright — the helper installs and relaunches either way.
   */
  async _restartToInstall(autoUpdater) {
    this.log('info', 'restarting to install the update');
    try { if (this.beforeInstall) await Promise.race([this.beforeInstall(), new Promise((r) => setTimeout(r, 5000))]); } catch (err) { this.log('warn', `shutdown before the update: ${err.message}`); }
    setTimeout(() => app.exit(0), 10_000);
    autoUpdater.quitAndInstall(false, true);
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
        if (interactive) await dialog.showMessageBox({ message: t('upd.upToDate', { version: current }), detail: info && info.version ? t('upd.latest', { url: this.cloud.cfg.url, version: info.version }) : t('upd.none') });
        return null;
      }
      this.state.available = info;
      this.log('info', `update available: ${info.version} (running ${current})`);
      if (!this.packaged) {
        if (interactive) await dialog.showMessageBox({ message: t('upd.available', { version: info.version }), detail: t('upd.fromSource') });
        return info;
      }
      try {
        const au = this._autoUpdater();
        au.setFeedURL({ provider: 'generic', url: `${this.cloud.cfg.url.replace(/\/$/, '')}/updates` });
        this.state.downloading = true;
        await au.checkForUpdates();
        if (interactive) await dialog.showMessageBox({ message: t('upd.downloading', { version: info.version }), detail: t('upd.downloadingDetail') });
      } catch (err) {
        await this._fallback(err);
      }
      return info;
    } catch (err) {
      this.state.error = err.message;
      if (interactive) await dialog.showMessageBox({ type: 'warning', message: t('upd.failed'), detail: err.message });
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
    const r = await dialog.showMessageBox({ type: 'info', buttons: [t('upd.download'), t('upd.later')], defaultId: 0, cancelId: 1, message: t('upd.available', { version: info.version }), detail: t('upd.manual') });
    if (r.response === 0 && (info.dmg || info.zip)) shell.openExternal(info.dmg || info.zip);
  }
}

module.exports = { Updater };
