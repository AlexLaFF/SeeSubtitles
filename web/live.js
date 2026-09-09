// Live view: a talk happening now. Source → subtitle look → where it shows → recording, with the live preview,
// transcript and activity log beside the controls. All text comes from the catalog (web/locales.js).
(function () {
  'use strict';
  const el = Controls.el;
  const $ = (id) => document.getElementById(id);
  const preview = [];
  const previewById = new Map();
  let logs = [];
  let mounted = false;
  const view = { get title() { return t('live.title'); } };

  function ingest(line) {
    const cur = previewById.get(line.id);
    if (cur) Object.assign(cur, line);
    else { previewById.set(line.id, line); preview.push(line); if (preview.length > 40) previewById.delete(preview.shift().id); }
    if (mounted) renderPreview();
  }
  function renderPreview() {
    const box = $('preview');
    if (!box) return;
    box.innerHTML = '';
    if (!preview.length) { box.appendChild(el('div', { class: 'muted' }, t('live.transcriptEmpty'))); return; }
    for (const l of preview) {
      const p = el('div', { class: `p${l.ended ? '' : ' partial'}` });
      if (l.wallStart) p.appendChild(el('div', { class: 's' }, new Date(l.wallStart).toTimeString().slice(0, 8)));
      p.appendChild(el('div', {}, l.targetText || '…'));
      p.appendChild(el('div', { class: 's' }, l.sourceText || ''));
      box.appendChild(p);
    }
    box.scrollTop = box.scrollHeight;
  }
  const logLine = (e) => `${new Date(e.t).toTimeString().slice(0, 8)}  ${e.text}`;
  function addLog(entry) {
    logs.push(entry);
    if (logs.length > 200) logs.shift();
    const box = $('log');
    if (!box) return;
    box.appendChild(el('div', { class: entry.level }, logLine(entry)));
    while (box.children.length > 200) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
    const last = $('logLast');
    if (last) last.textContent = t('live.last', { text: logLine(entry) });
  }
  Sub.on('line', ingest);
  Sub.on('clear', () => { preview.length = 0; previewById.clear(); if (mounted) renderPreview(); });
  Sub.on('log', addLog);

  view.init = (d) => {
    preview.length = 0; previewById.clear();
    for (const l of d.lines || []) ingest(l);
    logs = (d.logs || []).slice(-200);
    if (mounted) { const box = $('log'); if (box) { box.innerHTML = ''; for (const e of logs) box.appendChild(el('div', { class: e.level }, logLine(e))); } renderPreview(); }
  };

  const fold = (label, open) => { const d = el('details', { class: 'fold' }); if (open) d.open = true; d.appendChild(el('summary', {}, label)); const inner = el('div', { class: 'inner' }); d.appendChild(inner); return { d, inner }; };
  const svg = (paths) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = paths; return s; };

  view.render = function (root) {
    Controls.reset();
    mounted = true;
    root.innerHTML = `
      <div id="alert" class="alert" hidden></div>
      <div class="top"><h1>${t('live.title')}</h1><div class="chips" id="chips"></div><div class="grow"></div>
        <button class="ghost" id="btnDisplayWin"></button><button class="ghost" id="btnOverlayWin"></button></div>
      <div class="toolbar">
        <button id="btnRec" class="danger">${t('live.startRecording')}</button>
        <button id="btnShare" class="primary">${t('live.shareLink')}</button>
        <button id="btnPause">${t('live.startSubtitles')}</button>
        <button id="btnClear">${t('live.clearScreen')}</button>
        <span class="muted">${t('live.shortcutsHint')}</span>
      </div>
      <div class="body">
        <div class="col scroll" style="width:600px;flex:none">
          <div class="ui"><h3><span class="n">1</span>${t('live.source')}</h3><div id="srcFields"></div><div id="srcFolds"></div></div>
          <div class="ui"><h3><span class="n">2</span>${t('live.look')}</h3><div id="lookFields"></div><div id="lookFolds"></div></div>
          <div class="ui"><h3><span class="n">3</span>${t('live.where')}</h3>
            <div class="row wide"><label>${t('live.displayWindow')}</label><div id="displayRow"></div></div>
            <div id="overlayFields"></div>
            <div class="row wide"><label>${t('live.shareLink')}</label><div id="shareRow"></div></div>
            <div class="hint" style="margin-left:138px">${t('live.shareHint')}</div>
          </div>
          <div class="ui"><h3><span class="n">4</span>${t('live.recording')}</h3>
            <div class="row wide"><label>${t('live.thisTalk')}</label><div id="recRow"></div></div>
            <div class="row wide"><label>${t('live.savesTo')}</label><div id="recDir" class="muted"></div></div>
            <div class="hint" style="margin-left:138px">${t('live.recHint')}</div>
          </div>
        </div>
        <div class="col" style="flex:1">
          <div class="ui" style="padding:10px"><h3>${t('live.nowShowing')}</h3><div class="stagebox" id="stagebox"><iframe id="stageFrame" src="/?preview=1" title="preview"></iframe></div></div>
          <div class="ui" style="flex:1;display:flex;flex-direction:column;min-height:0"><h3>${t('live.transcript')}</h3>
            <div class="hint" style="margin:-4px 0 8px">${t('live.transcriptHint')}</div>
            <div class="preview" id="preview" style="flex:1;max-height:none"></div></div>
          <div class="ui" style="padding:8px 14px" id="logPanel"></div>
        </div>
      </div>`;
    $('btnDisplayWin').append(svg('<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8"></path>'), t('live.displayWindow'));
    $('btnOverlayWin').append(svg('<rect x="3" y="3" width="18" height="18" rx="2"></rect><rect x="8" y="8" width="13" height="13" rx="2"></rect>'), t('live.overlayWindow'));
    $('btnDisplayWin').addEventListener('click', () => Sub.post('/api/display/open'));
    $('btnOverlayWin').addEventListener('click', () => Sub.post('/api/overlay/open').then((r) => { if (r && r.error) alert(I18n.err(r)); }));
    $('btnRec').addEventListener('click', toggleRecording);
    $('btnShare').addEventListener('click', toggleShare);
    $('btnPause').addEventListener('click', () => Sub.update({ streaming: !Sub.settings.streaming }));
    $('btnClear').addEventListener('click', () => Sub.post('/api/clear'));
    // 1 Source
    Controls.renderFields($('srcFields'), ['audioDevice', 'source', 'target', 'transModel']);
    const tune = fold(t('live.tuning'));
    Controls.renderFields(tune.inner, ['hotwords', 'vadSilenceTime', 'maxSpeakTime', 'filterModal', 'noiseThreshold']);
    const reh = fold(t('live.rehearse'));
    reh.inner.id = 'rehearse';
    const conn = fold(t('live.connection'));
    conn.inner.innerHTML = '<dl class="kv" id="kv"></dl><div class="btns"><button id="btnReconnect"></button></div>';
    $('srcFolds').append(tune.d, reh.d, conn.d);
    $('btnReconnect').textContent = t('live.reconnect');
    $('btnReconnect').addEventListener('click', () => Sub.post('/api/reconnect').then((r) => { if (r && r.error) alert(I18n.err(r)); }));
    renderRehearse();
    // 2 Look
    $('lookFields').appendChild(Controls.presetRow());
    Controls.renderFields($('lookFields'), ['showMode', 'fontSize']);
    const more = fold(t('live.lookMore'));
    Controls.renderFields(more.inner, ['fontWeight', 'fontColor', 'textShadow', 'fontFamily', 'visibleLines', 'topFade', 'lineSpacing', 'lineGap', 'paddingX', 'paddingY', 'paddingTop', 'align', 'bgColor', 'bgOpacity']);
    $('lookFolds').appendChild(more.d);
    // 3 Where it shows
    Controls.renderFields($('overlayFields'), ['window', 'showStatus']);
    // log
    const lg = fold(t('live.activityLog'));
    lg.d.querySelector('summary').appendChild(el('span', { id: 'logLast', class: 'muted', style: 'margin-left:6px' }, logs.length ? t('live.last', { text: logLine(logs[logs.length - 1]) }) : ''));
    lg.inner.innerHTML = '<div class="log" id="log"></div>';
    $('logPanel').appendChild(lg.d);
    for (const e of logs) $('log').appendChild(el('div', { class: e.level }, logLine(e)));
    fitStage();
    window.addEventListener('resize', fitStage);
    renderPreview();
    view.update();
  };
  view.leave = () => { mounted = false; window.removeEventListener('resize', fitStage); };

  function fitStage() {
    const box = $('stagebox'); const f = $('stageFrame');
    if (!box || !f) return;
    const w = box.clientWidth || 600;
    const scale = w / 1920;
    f.width = 1920; f.height = 1080;
    f.style.width = '1920px'; f.style.height = '1080px'; f.style.transform = `scale(${scale})`;
    box.style.height = `${Math.round(1080 * scale)}px`;
  }

  async function renderRehearse() {
    const box = $('rehearse'); if (!box) return;
    const d = App.desktop();
    box.innerHTML = '';
    if (!d) { box.appendChild(el('div', { class: 'hint' }, t('live.rehearseAppOnly'))); return; }
    const cfg = await d.getConfig();
    const row = el('div', { class: 'row wide' });
    row.appendChild(el('label', {}, t('live.audioFile')));
    const wrap = el('div', { style: 'display:flex;gap:6px;align-items:center' });
    const val = el('span', { class: cfg.audioFile ? '' : 'muted', style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, cfg.audioFile || t('live.micNoFile'));
    const pick = el('button', { class: 'small' }, t('live.chooseWav'));
    pick.addEventListener('click', async () => { const p = await d.chooseAudioFile(); if (p) { await d.saveConfig({ audioFile: p }); renderRehearse(); } });
    const clear = el('button', { class: 'small' }, t('live.useMic'));
    clear.disabled = !cfg.audioFile;
    clear.addEventListener('click', async () => { await d.saveConfig({ audioFile: '' }); renderRehearse(); });
    wrap.append(val, pick, clear);
    row.appendChild(wrap);
    box.appendChild(row);
    box.appendChild(el('div', { class: 'hint' }, t('live.rehearseHint')));
  }

  /** SVG markup of a QR code for `text` (error correction M, so a projected code still scans from a phone). */
  function qrSvg(text, cellSize) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize, margin: 2, scalable: true }); } catch (err) { return `<span class="muted">${t('live.share.qrUnavailable', { message: err.message })}</span>`; }
  }
  /** A shareable picture: white card with the QR code, the address and a caption. Returns a data URL. */
  function qrImage(url, format = 'png') {
    return new Promise((resolve, reject) => {
      const W = 1080; const H = 1320; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      const img = new Image();
      img.onload = () => {
        const size = 820; g.drawImage(img, (W - size) / 2, 110, size, size);
        g.fillStyle = '#111'; g.textAlign = 'center';
        g.font = '600 56px -apple-system, "PingFang SC", system-ui, sans-serif'; g.fillText(url.replace(/^https?:\/\//, ''), W / 2, 1030);
        g.fillStyle = '#555'; g.font = '38px -apple-system, "PingFang SC", system-ui, sans-serif';
        g.fillText(t('live.share.caption'), W / 2, 1120);
        g.fillStyle = '#999'; g.font = '30px -apple-system, "PingFang SC", system-ui, sans-serif'; g.fillText(t('brand'), W / 2, 1230);
        resolve(format === 'jpg' ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('could not render the QR code'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(url, 10))}`;
    });
  }
  async function copyQr(url, btn) {
    try {
      const dataUrl = await qrImage(url, 'png');
      const d = App.desktop();
      if (d && d.copyImage) await d.copyImage(dataUrl);
      else { const blob = await (await fetch(dataUrl)).blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); }
      if (btn) { const old = btn.textContent; btn.textContent = t('common.copied'); setTimeout(() => { btn.textContent = old; }, 1200); }
    } catch (err) { alert(t('live.share.copyFail', { message: err.message })); }
  }
  async function saveQr(url, format) {
    try {
      const dataUrl = await qrImage(url, format);
      const name = `see-subtitles-${url.replace(/^.*\//, '')}.${format}`;
      const d = App.desktop();
      if (d && d.saveImage) return d.saveImage(dataUrl, name);
      const a = el('a', { href: dataUrl, download: name }); document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { alert(t('live.share.saveFail', { message: err.message })); }
    return null;
  }
  function shareButtons(url) {
    const box = el('div', { class: 'btns', style: 'margin:0' });
    const cp = el('button', { class: 'small' }, t('live.share.copyLink')); cp.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard.writeText(url).then(() => { cp.textContent = t('common.copied'); setTimeout(() => { cp.textContent = t('live.share.copyLink'); }, 1200); }).catch(() => {}); });
    const ci = el('button', { class: 'small' }, t('live.share.copyImage')); ci.addEventListener('click', (e) => { e.stopPropagation(); copyQr(url, ci); });
    const sp = el('button', { class: 'small' }, t('live.share.savePng')); sp.addEventListener('click', (e) => { e.stopPropagation(); saveQr(url, 'png'); });
    const sj = el('button', { class: 'small' }, t('live.share.saveJpg')); sj.addEventListener('click', (e) => { e.stopPropagation(); saveQr(url, 'jpg'); });
    box.append(cp, ci, sp, sj);
    return box;
  }
  function showQr(url) {
    const ov = el('div', { class: 'qr-overlay' });
    const card = el('div', { class: 'qr-card' });
    const q = el('div', { class: 'qr-big' }); q.innerHTML = qrSvg(url, 8);
    card.append(q, el('div', { class: 'qr-url' }, url.replace(/^https?:\/\//, '')), el('div', { class: 'muted' }, t('live.share.overlayHint')), shareButtons(url));
    card.addEventListener('click', (e) => { if (e.target.closest('button')) e.stopPropagation(); });
    ov.appendChild(card);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
  }

  function toggleRecording() {
    const on = Sub.status.recorder && Sub.status.recorder.recording;
    if (on && !confirm(t('live.confirmStop'))) return;
    Sub.post('/api/record', { action: on ? 'stop' : 'start' }).then((r) => { if (r && r.error) alert(I18n.err(r)); });
  }
  let shareBusy = false;
  function toggleShare() {
    const c = Sub.status.cloud;
    if (!c || !c.loggedIn) { App.go('settings'); return; }
    if (shareBusy) return;
    shareBusy = true;
    Sub.post('/api/cloud', { action: 'publish', on: !c.session }).then((r) => { shareBusy = false; if (r && r.error) alert(I18n.err(r)); });
  }

  view.update = function () {
    if (!mounted || !$('chips')) return;
    const s = Sub.status || {};
    const st = s.stream || {};
    const cap = s.capture || {};
    const alert = $('alert');
    const code = st.lastError && st.lastError.code;
    let text = '';
    if (App.offline) text = t('live.alert.offline');
    else if (s.creds && st.state === 'reconnecting' && I18n.has(`billing.${code}`)) text = t('live.alert.billing', { code, reason: t(`billing.${code}`) });
    else if (s.creds && st.state === 'reconnecting' && st.reconnects >= 3 && st.lastError) text = t('live.alert.failing', { message: st.lastError.message });
    alert.textContent = text; alert.hidden = !text;
    // chips
    const chips = $('chips'); chips.innerHTML = '';
    let cls = 'warn'; let label = st.state || '…';
    if (s.demo) { cls = 'demo'; label = t('live.chip.demo'); }
    else if (!s.creds) { cls = 'bad'; label = s.credsError && /log in|not logged|登录/i.test(s.credsError) ? t('live.chip.notLoggedIn') : t('live.chip.noKeys'); }
    else if (!s.streaming) { cls = 'warn'; label = t('live.chip.paused'); }
    else if (st.state === 'ready') { cls = 'ok'; label = t('live.chip.connected') + (st.edge ? ` · ${t('live.chip.edge', { edge: st.edge.replace(/ .*/, '') })}` : ''); }
    else if (st.state === 'reconnecting') { cls = 'bad'; label = st.retryAt ? t('live.chip.reconnectingIn', { s: Math.max(0, Math.ceil((st.retryAt - (s.now || Date.now())) / 1000)) }) : t('live.chip.reconnecting'); }
    else label = t('live.chip.connecting');
    const c1 = el('span', { class: `chip ${cls}` }); c1.append(el('span', { class: 'dot', style: cls === 'ok' ? '' : 'background:#fff' }), label); chips.appendChild(c1);
    const db = s.level ? s.level.dbfs : null;
    const pct = db == null ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    const c2 = el('span', { class: 'chip', title: cap.device || '' }); const bar = el('span', { class: 'bar' }); bar.appendChild(el('i', { style: `width:${pct}%` })); c2.append(`${t('live.chip.mic')} `, bar, db == null ? ` ${t('live.chip.noAudio')}` : ` ${db.toFixed(0)} dB${db < -50 ? ` · ${t('live.chip.veryQuiet')}` : ''}`); chips.appendChild(c2);
    const rc = s.recorder || {};
    if (rc.recording && rc.current) { const c3 = el('span', { class: 'chip rec' }); c3.append(el('span', { class: 'dot', style: 'background:#fff' }), t('live.chip.recording', { time: Sub.fmtClock(rc.current.elapsedMs) })); chips.appendChild(c3); }
    // toolbar
    $('btnRec').textContent = rc.recording ? t('live.stopRecording') : t('live.startRecording');
    $('btnRec').className = rc.recording ? 'primary' : 'danger';
    $('btnPause').textContent = s.streaming === false ? t('live.startSubtitles') : t('live.pauseSubtitles');
    $('btnPause').className = s.streaming === false && s.creds ? 'primary' : '';
    const cloud = s.cloud;
    $('btnShare').textContent = cloud && cloud.session ? t('live.stopSharing') : t('live.shareLink');
    $('btnShare').className = cloud && cloud.session ? '' : 'primary';
    // connection details
    const now = s.now || Date.now();
    const rows = [[t('live.kv.state'), st.state || '–'], [t('live.kv.connectedFor'), st.connectedAt ? Sub.fmtAgo(now - st.connectedAt) : '–'], [t('live.kv.nextRotation'), st.rotateAt ? t('live.kv.in', { time: Sub.fmtAgo(st.rotateAt - now) }) : '–'], [t('live.kv.reconnects'), st.reconnects ?? 0], [t('live.kv.queue'), t('live.kv.chunks', { queue: st.queue ?? 0, dropped: st.dropped ?? 0 })], [t('live.kv.languages'), st.source ? `${st.source} → ${st.target} · ${st.transModel}` : '–'], [t('live.kv.gateway'), st.edge || '–'], [t('live.kv.mic'), `${cap.device || '–'}${cap.restarts ? t('live.kv.restarts', { n: cap.restarts }) : ''}`], [t('live.kv.lastError'), st.lastError ? `${st.lastError.code ? `${st.lastError.code} ` : ''}${st.lastError.message}` : (cap.lastError || s.credsError || '–')]];
    const kv = $('kv'); if (kv) { kv.innerHTML = ''; for (const [k, v] of rows) { kv.appendChild(el('dt', {}, k)); kv.appendChild(el('dd', {}, String(v))); } }
    // display window
    const dr = $('displayRow'); dr.innerHTML = '';
    const disp = s.display || {};
    const wrap = el('div', { style: 'display:flex;gap:6px;align-items:center' });
    wrap.appendChild(el('span', { class: `tag ${disp.open ? 'done' : ''}` }, disp.open ? (disp.fullscreen ? t('live.display.fullscreen') : t('live.display.open')) : t('live.display.closed')));
    const bo = el('button', { class: 'small' }, disp.open ? t('live.display.show') : t('live.display.openBtn')); bo.addEventListener('click', () => Sub.post('/api/display/open')); wrap.appendChild(bo);
    const bf = el('button', { class: 'small' }, t('live.display.fullscreenBtn')); bf.addEventListener('click', () => Sub.post('/api/display/open', { fullscreen: true })); wrap.appendChild(bf);
    dr.appendChild(wrap);
    // share link
    const sr = $('shareRow'); sr.innerHTML = '';
    if (!cloud || !cloud.loggedIn) { const b = el('button', { class: 'small' }, t('live.share.login')); b.addEventListener('click', () => App.go('settings')); sr.appendChild(b); }
    else if (cloud.session) {
      const w2 = el('div', { style: 'display:flex;gap:10px;align-items:flex-start' });
      const qrBox = el('div', { class: 'qr', title: t('live.share.qrTitle') }); qrBox.innerHTML = qrSvg(cloud.shareUrl, 3); qrBox.addEventListener('click', () => showQr(cloud.shareUrl));
      const right = el('div', { style: 'flex:1;display:flex;flex-direction:column;gap:6px;min-width:0' });
      const line = el('div', { style: 'display:flex;gap:6px;align-items:center' });
      line.appendChild(el('input', { type: 'text', readonly: 'readonly', value: cloud.shareUrl, style: 'flex:1' }));
      const big = el('button', { class: 'small' }, t('live.share.showQr')); big.addEventListener('click', () => showQr(cloud.shareUrl)); line.appendChild(big);
      const stop = el('button', { class: 'small' }, t('live.share.stop')); stop.addEventListener('click', toggleShare); line.appendChild(stop);
      right.appendChild(line);
      right.appendChild(shareButtons(cloud.shareUrl));
      right.appendChild(el('div', { class: 'hint' }, `${t('live.share.sent', { sent: cloud.sent })}${cloud.queued ? t('live.share.queued', { n: cloud.queued }) : ''}${cloud.error ? ` · ⚠ ${cloud.error}` : ''}${t('live.share.scanHint')}`));
      w2.append(qrBox, right);
      sr.appendChild(w2);
    } else { const b = el('button', { class: 'small primary' }, t('live.share.start')); b.addEventListener('click', toggleShare); sr.appendChild(b); sr.appendChild(el('span', { class: 'muted', style: 'margin-left:8px' }, t('live.share.as', { email: cloud.email }))); }
    // recording
    const rr = $('recRow'); rr.innerHTML = '';
    const rb = el('button', { class: `small ${rc.recording ? '' : 'danger'}` }, rc.recording ? t('live.rec.stop') : t('live.rec.start')); rb.addEventListener('click', toggleRecording);
    const rwrap = el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }); rwrap.appendChild(rb);
    if (rc.recording && rc.current) { const c = rc.current; rwrap.appendChild(el('span', {}, t('live.rec.status', { time: Sub.fmtClock(c.elapsedMs), size: Sub.fmtBytes(c.bytes), cues: c.cues.zh }) + (c.paddedMs > 500 ? t('live.rec.padded', { s: (c.paddedMs / 1000).toFixed(1) }) : '') + (c.encoderAlive ? '' : t('live.rec.encoder')))); }
    else if (rc.last) rwrap.appendChild(el('span', { class: 'muted' }, t('live.rec.last', { file: rc.last.file, time: Sub.fmtClock(rc.last.durationMs), cues: rc.last.cues.zh })));
    else rwrap.appendChild(el('span', { class: 'muted' }, t('live.rec.idle')));
    rr.appendChild(rwrap);
    $('recDir').textContent = `${s.recordingsDir || (rc.dir || '')} · ${t('live.rec.mp4', { onoff: s.mp4Auto === false ? t('common.off') : t('common.on') })}`;
  };

  App.register('live', view);
})();
