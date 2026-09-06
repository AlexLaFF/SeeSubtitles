'use strict';
// Use the app's bundled Chromium; no second Electron installation or helper process is needed.
const fs = require('node:fs/promises');
async function renderPdf({ url, out, timeoutMs = 120_000 }) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, width: 900, height: 1300,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const part = `${out}.part`;
  let timer;
  try {
    const task = async () => {
      await win.loadURL(url);
      for (;;) {
        const state = await win.webContents.executeJavaScript('({ready: window.__rendered === true, error: window.__renderError || null})');
        if (state.error) throw new Error(state.error);
        if (state.ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
      return win.webContents.printToPDF({
        pageSize: 'A4', printBackground: true,
        margins: { top: 0.6, bottom: 0.75, left: 0.65, right: 0.65 },
        displayHeaderFooter: true, headerTemplate: '<div></div>',
        footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#8a8a8a;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
    };
    const pdf = await Promise.race([task(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('PDF render timed out')), timeoutMs);
    })]);
    await fs.writeFile(part, pdf);
    await fs.rename(part, out);
    return { out, bytes: pdf.length };
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(part, { force: true });
  }
}
module.exports = { renderPdf };
