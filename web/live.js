// Live view: a talk happening now. Source → subtitle look → where it shows → recording, with the live preview,
// transcript and activity log beside the controls.
(function () {
  'use strict';
  const el = Controls.el;
  const $ = (id) => document.getElementById(id);
  const preview = [];
  const previewById = new Map();
  let logs = [];
  let mounted = false;
  const view = { title: 'Live' };

  const BILLING = { 6003: 'the 实时语音翻译 service is not enabled on the account', 6004: 'quota exhausted — the 大模型实时语音翻译 resource pack is used up and post-paid billing is off', 6005: 'account in arrears (欠费)' };

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
    if (!preview.length) { box.appendChild(el('div', { class: 'muted' }, 'Sentences appear here as they are recognised.')); return; }
    for (const l of preview) {
      const p = el('div', { class: `p${l.ended ? '' : ' partial'}` });
      if (l.wallStart) p.appendChild(el('div', { class: 's' }, new Date(l.wallStart).toTimeString().slice(0, 8)));
      p.appendChild(el('div', {}, l.targetText || '…'));
      p.appendChild(el('div', { class: 's' }, l.sourceText || ''));
      box.appendChild(p);
    }
    box.scrollTop = box.scrollHeight;
  }
  function addLog(entry) {
    logs.push(entry);
    if (logs.length > 200) logs.shift();
    const box = $('log');
    if (!box) return;
    box.appendChild(el('div', { class: entry.level }, `${new Date(entry.t).toTimeString().slice(0, 8)}  ${entry.text}`));
    while (box.children.length > 200) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
    const last = $('logLast');
    if (last) last.textContent = `last: ${new Date(entry.t).toTimeString().slice(0, 8)} ${entry.text}`;
  }
  Sub.on('line', ingest);
  Sub.on('clear', () => { preview.length = 0; previewById.clear(); if (mounted) renderPreview(); });
  Sub.on('log', addLog);

  view.init = (d) => {
    preview.length = 0; previewById.clear();
    for (const l of d.lines || []) ingest(l);
    logs = (d.logs || []).slice(-200);
    if (mounted) { const box = $('log'); if (box) { box.innerHTML = ''; for (const e of logs) box.appendChild(el('div', { class: e.level }, `${new Date(e.t).toTimeString().slice(0, 8)}  ${e.text}`)); } renderPreview(); }
  };

  const fold = (label, open) => { const d = el('details', { class: 'fold' }); if (open) d.open = true; d.appendChild(el('summary', {}, label)); const inner = el('div', { class: 'inner' }); d.appendChild(inner); return { d, inner }; };
  const svg = (paths) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = paths; return s; };

  view.render = function (root) {
    Controls.reset();
    mounted = true;
    root.innerHTML = `
      <div id="alert" class="alert" hidden></div>
      <div class="top"><h1>Live</h1><div class="chips" id="chips"></div><div class="grow"></div>
        <button class="ghost" id="btnDisplayWin"></button><button class="ghost" id="btnOverlayWin"></button></div>
      <div class="toolbar">
        <button id="btnRec" class="danger">● Start recording</button>
        <button id="btnShare">Share link</button>
        <button id="btnPause">Pause subtitles</button>
        <button id="btnClear">Clear screen</button>
      </div>
      <div class="body">
        <div class="col scroll" style="width:600px;flex:none">
          <div class="ui logincard" id="loginCard" hidden><b>Log in to start</b><p>Your Tencent keys, the share link and cloud re-subtitling come with the account. Recording works without it.</p><button class="primary small" id="btnLoginCard">Log in under Settings</button></div>
          <div class="ui"><h3><span class="n">1</span>Source</h3><div id="srcFields"></div><div class="row wide" id="glossRowWrap"><label>Glossary</label><div id="glossRow"></div></div><div id="srcFolds"></div></div>
          <div class="ui"><h3><span class="n">2</span>Subtitle look</h3><div id="lookFields"></div><div id="lookFolds"></div></div>
          <div class="ui"><h3><span class="n">3</span>Where it shows</h3>
            <div class="row wide"><label>Display window</label><div id="displayRow"></div></div>
            <div id="overlayFields"></div>
            <div class="row wide" style="align-items:start"><label style="padding-top:5px">Share link</label><div id="shareRow"></div></div>
          </div>
          <div class="ui"><h3><span class="n">4</span>Recording</h3>
            <div class="row wide"><label>This talk</label><div id="recRow"></div></div>
            <div class="row wide"><label>Saves to</label><div id="recDir" class="hint" style="margin:0"></div></div>
          </div>
        </div>
        <div class="col" style="flex:1">
          <div class="ui" style="padding:10px"><h3 style="margin:2px 0 8px 6px">Now showing</h3><div class="stagebox" id="stagebox"><iframe id="stageFrame" src="/?preview=1" title="preview"></iframe></div></div>
          <div class="ui" style="flex:1;display:flex;flex-direction:column;min-height:0"><h3>Transcript</h3>
            <div class="preview" id="preview" style="flex:1;max-height:none"></div></div>
          <div class="ui" style="padding:8px 16px" id="logPanel"></div>
        </div>
      </div>
      <div class="foot"><span><kbd>⇧⌘R</kbd> record</span><span><kbd>P</kbd> pause</span><span><kbd>X</kbd> clear</span><span><kbd>+</kbd><kbd>−</kbd> text size</span><span class="grow"></span><span id="footRight"></span></div>`;
    // buttons
    $('btnDisplayWin').append(svg('<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8"></path>'), 'Display window');
    $('btnOverlayWin').append(svg('<rect x="3" y="3" width="18" height="18" rx="2"></rect><rect x="8" y="8" width="13" height="13" rx="2"></rect>'), 'Overlay window');
    $('btnDisplayWin').addEventListener('click', () => Sub.post('/api/display/open'));
    $('btnOverlayWin').addEventListener('click', () => Sub.post('/api/overlay/open').then((r) => { if (r && r.error) alert(r.error); }));
    $('btnRec').addEventListener('click', toggleRecording);
    $('btnShare').addEventListener('click', toggleShare);
    $('btnPause').addEventListener('click', () => Sub.update({ streaming: !Sub.settings.streaming }));
    $('btnClear').addEventListener('click', () => Sub.post('/api/clear'));
    $('btnLoginCard').addEventListener('click', () => App.go('settings'));
    // 1 Source
    Controls.renderFields($('srcFields'), ['audioDevice', 'source', 'target', 'transModel']);
    renderGlossaryRow();
    const tune = fold('Recognition tuning: pause length, forced split, filler words, noise');
    Controls.renderFields(tune.inner, App.desktop() ? ['vadSilenceTime', 'maxSpeakTime', 'filterModal', 'noiseThreshold'] : ['hotwords', 'vadSilenceTime', 'maxSpeakTime', 'filterModal', 'noiseThreshold']);
    const reh = fold('Rehearse with an audio file instead of the microphone');
    reh.inner.id = 'rehearse';
    const conn = fold('Connection details');
    conn.inner.innerHTML = '<dl class="kv" id="kv"></dl><div class="btns"><button id="btnReconnect">Reconnect</button></div>';
    $('srcFolds').append(tune.d, reh.d, conn.d);
    $('btnReconnect').addEventListener('click', () => Sub.post('/api/reconnect').then((r) => { if (r && r.error) alert(r.error); }));
    renderRehearse();
    // 2 Look
    $('lookFields').appendChild(Controls.presetRow());
    Controls.renderFields($('lookFields'), ['showMode', 'fontSize']);
    const more = fold('Text, layout and background');
    Controls.renderFields(more.inner, ['fontWeight', 'fontColor', 'textShadow', 'fontFamily', 'visibleLines', 'topFade', 'lineSpacing', 'lineGap', 'paddingX', 'paddingY', 'paddingTop', 'align', 'bgColor', 'bgOpacity']);
    $('lookFolds').appendChild(more.d);
    // 3 Where it shows
    Controls.renderFields($('overlayFields'), ['window', 'showStatus']);
    // log
    const lg = fold('Activity log');
    lg.d.querySelector('summary').appendChild(el('span', { id: 'logLast', class: 'muted', style: 'margin-left:6px' }, logs.length ? `last: ${new Date(logs[logs.length - 1].t).toTimeString().slice(0, 8)} ${logs[logs.length - 1].text}` : ''));
    lg.inner.innerHTML = '<div class="log" id="log"></div>';
    $('logPanel').appendChild(lg.d);
    for (const e of logs) $('log').appendChild(el('div', { class: e.level }, `${new Date(e.t).toTimeString().slice(0, 8)}  ${e.text}`));
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

  /** The glossary lives in the app's config (and on the account); in a plain browser the hotwords textarea stays. */
  async function renderGlossaryRow() {
    const box = $('glossRow'); if (!box) return;
    if (!App.desktop() || !window.Glossary) { $('glossRowWrap').hidden = true; return; }
    if (!Glossary.loaded) await Glossary.load();
    if (!$('glossRow')) return;
    box.innerHTML = '';
    const n = Glossary.items.length;
    const b = el('button', { class: 'small' }, n ? `Glossary… · ${n} term${n === 1 ? '' : 's'}` : 'Glossary…');
    b.addEventListener('click', () => Glossary.open());
    box.appendChild(b);
    box.appendChild(el('span', { class: 'hint', style: 'margin:0 0 0 8px' }, n ? 'names and terms the recogniser favours' : 'names, places and terms the recogniser should favour'));
  }
  view.glossaryChanged = renderGlossaryRow;

  async function renderRehearse() {
    const box = $('rehearse'); if (!box) return;
    const d = App.desktop();
    box.innerHTML = '';
    if (!d) { box.appendChild(el('div', { class: 'hint' }, 'Available in the desktop app window.')); return; }
    const cfg = await d.getConfig();
    const row = el('div', { class: 'row wide' });
    row.appendChild(el('label', {}, 'Audio file'));
    const wrap = el('div', { style: 'display:flex;gap:6px;align-items:center' });
    const val = el('span', { class: cfg.audioFile ? '' : 'muted', style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, cfg.audioFile || 'microphone (no file)');
    const pick = el('button', { class: 'small' }, 'Choose WAV…');
    pick.addEventListener('click', async () => { const p = await d.chooseAudioFile(); if (p) { await d.saveConfig({ audioFile: p }); renderRehearse(); } });
    const clear = el('button', { class: 'small' }, 'Use microphone');
    clear.disabled = !cfg.audioFile;
    clear.addEventListener('click', async () => { await d.saveConfig({ audioFile: '' }); renderRehearse(); });
    wrap.append(val, pick, clear);
    row.appendChild(wrap);
    box.appendChild(row);
    box.appendChild(el('div', { class: 'hint' }, 'A 16 kHz mono WAV is looped through Tencent exactly like the microphone. Demo mode (no Tencent at all) is under Settings → Advanced.'));
  }

  /** SVG markup of a QR code for `text` (error correction M, so a projected code still scans from a phone). */
  function qrSvg(text, cellSize) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize, margin: 2, scalable: true }); } catch (err) { return `<span class="muted">QR unavailable: ${err.message}</span>`; }
  }
  /** Full-window QR + link, for holding the laptop up or mirroring to the venue screen. Click or Esc closes. */
  function showQr(url) {
    const ov = el('div', { class: 'qr-overlay' });
    const card = el('div', { class: 'qr-card' });
    const q = el('div', { class: 'qr-big' }); q.innerHTML = qrSvg(url, 8);
    card.append(q, el('div', { class: 'qr-url' }, url.replace(/^https?:\/\//, '')), el('div', { class: 'muted' }, 'Scan to follow the subtitles on a phone · click anywhere to close'));
    ov.appendChild(card);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
  }

  function toggleRecording() {
    const on = Sub.status.recorder && Sub.status.recorder.recording;
    if (on && !confirm('Stop the recording?')) return;
    Sub.post('/api/record', { action: on ? 'stop' : 'start' }).then((r) => { if (r && r.error) alert(r.error); });
  }
  let shareBusy = false;
  function toggleShare() {
    const c = Sub.status.cloud;
    if (!c || !c.loggedIn) { App.go('settings'); return; }
    if (shareBusy) return;
    shareBusy = true;
    Sub.post('/api/cloud', { action: 'publish', on: !c.session }).then((r) => { shareBusy = false; if (r && r.error) alert(r.error); });
  }

  view.update = function () {
    if (!mounted || !$('chips')) return;
    const s = Sub.status || {};
    const st = s.stream || {};
    const cap = s.capture || {};
    // alert
    const alert = $('alert');
    const code = st.lastError && st.lastError.code;
    let text = '';
    if (App.offline) text = 'The app’s local server is not responding.';
    else if (s.creds && st.state === 'reconnecting' && BILLING[code]) text = `Tencent refused the connection (${code}): ${BILLING[code]}. Subtitles are paused; recording continues. The app retries every 30 s.`;
    else if (s.creds && st.state === 'reconnecting' && st.reconnects >= 3 && st.lastError) text = `Connection keeps failing: ${st.lastError.message}`;
    alert.textContent = text; alert.hidden = !text;
    $('loginCard').hidden = !!(s.creds || s.demo || App.offline);
    // chips
    const chips = $('chips'); chips.innerHTML = '';
    let cls = 'warn'; let label = st.state || '…';
    if (s.demo) { cls = 'demo'; label = 'Demo mode'; }
    else if (!s.creds) { cls = 'bad'; label = s.credsError && /log in|not logged/i.test(s.credsError) ? 'Not logged in' : 'No Tencent keys'; }
    else if (!s.streaming) { cls = 'warn'; label = 'Subtitles paused'; }
    else if (st.state === 'ready') { cls = 'ok'; const edge = st.edge ? st.edge.replace(/ .*/, '').replace(/^ap-/, '').replace(/^\w/, (c) => c.toUpperCase()) : ''; label = `Connected${edge ? ` · ${edge} edge` : ''}`; }
    else if (st.state === 'reconnecting') { cls = 'bad'; label = `Reconnecting${st.retryAt ? ` in ${Math.max(0, Math.ceil((st.retryAt - (s.now || Date.now())) / 1000))}s` : ''}`; }
    else label = String(st.state || 'connecting').replace(/^\w/, (c) => c.toUpperCase());
    const c1 = el('span', { class: `chip ${cls}` }); c1.append(el('span', { class: 'dot' }), label); chips.appendChild(c1);
    const db = s.level ? s.level.dbfs : null;
    const pct = db == null ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    const c2 = el('span', { class: 'chip', title: cap.device || '' }); const bar = el('span', { class: 'bar' }); bar.appendChild(el('i', { style: `width:${pct}%` })); c2.append(bar, db == null ? 'Mic · no audio' : `Mic ${db.toFixed(0)} dB${db < -50 ? ' · very quiet' : ''}`); chips.appendChild(c2);
    const rc = s.recorder || {};
    if (rc.recording && rc.current) { const c3 = el('span', { class: 'chip rec' }); c3.append(el('span', { class: 'dot' }), `Recording ${Sub.fmtClock(rc.current.elapsedMs)}`); chips.appendChild(c3); }
    // toolbar
    $('btnRec').textContent = rc.recording ? '■ Stop recording' : '● Start recording';
    $('btnRec').className = 'danger';
    $('btnPause').textContent = s.streaming === false ? 'Resume subtitles' : 'Pause subtitles';
    const cloud = s.cloud;
    $('btnShare').textContent = cloud && cloud.session ? 'Stop sharing' : 'Share link';
    $('btnShare').className = '';
    // connection details
    const now = s.now || Date.now();
    const rows = [['State', st.state || '–'], ['Connected for', st.connectedAt ? Sub.fmtAgo(now - st.connectedAt) : '–'], ['Next rotation', st.rotateAt ? `in ${Sub.fmtAgo(st.rotateAt - now)}` : '–'], ['Reconnects', st.reconnects ?? 0], ['Queue / dropped', `${st.queue ?? 0} / ${st.dropped ?? 0} chunks`], ['Languages', st.source ? `${st.source} → ${st.target} · ${st.transModel}` : '–'], ['Gateway', st.edge || '–'], ['Mic', `${cap.device || '–'}${cap.restarts ? ` · ${cap.restarts} restarts` : ''}`], ['Last error', st.lastError ? `${st.lastError.code ? `${st.lastError.code} ` : ''}${st.lastError.message}` : (cap.lastError || s.credsError || '–')]];
    const kv = $('kv'); if (kv) { kv.innerHTML = ''; for (const [k, v] of rows) { kv.appendChild(el('dt', {}, k)); kv.appendChild(el('dd', {}, String(v))); } }
    // display window
    const dr = $('displayRow'); dr.innerHTML = '';
    const disp = s.display || {};
    const wrap = el('div', { style: 'display:flex;gap:6px;align-items:center' });
    wrap.appendChild(el('span', { class: `tag ${disp.open ? 'done' : ''}` }, disp.open ? (disp.fullscreen ? 'open · full screen' : 'open') : 'closed'));
    const bo = el('button', { class: 'small' }, disp.open ? 'Show' : 'Open'); bo.addEventListener('click', () => Sub.post('/api/display/open')); wrap.appendChild(bo);
    const bf = el('button', { class: 'small' }, 'Full screen'); bf.addEventListener('click', () => Sub.post('/api/display/open', { fullscreen: true })); wrap.appendChild(bf);
    dr.appendChild(wrap);
    // share link
    const sr = $('shareRow'); sr.innerHTML = '';
    if (!cloud || !cloud.loggedIn) { const b = el('button', { class: 'small' }, 'Log in to share'); b.addEventListener('click', () => App.go('settings')); sr.appendChild(b); }
    else if (cloud.session) {
      const w2 = el('div', { style: 'display:flex;gap:12px;align-items:flex-start' });
      const qrBox = el('div', { class: 'qr', title: 'Scan to open the share link' }); qrBox.innerHTML = qrSvg(cloud.shareUrl, 3); qrBox.addEventListener('click', () => showQr(cloud.shareUrl));
      const right = el('div', { style: 'flex:1;display:flex;flex-direction:column;gap:6px;min-width:0' });
      const line = el('div', { style: 'display:flex;gap:8px;align-items:center' });
      line.appendChild(el('input', { type: 'text', readonly: 'readonly', value: cloud.shareUrl.replace(/^https?:\/\//, ''), style: 'flex:1;min-width:0' }));
      const cp = el('button', { class: 'small' }, 'Copy'); cp.addEventListener('click', () => navigator.clipboard.writeText(cloud.shareUrl).then(() => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy'; }, 1200); }).catch(() => {})); line.appendChild(cp);
      right.appendChild(line);
      const line2 = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' });
      const big = el('button', { class: 'small' }, 'Show QR large'); big.addEventListener('click', () => showQr(cloud.shareUrl)); line2.appendChild(big);
      const poster = el('button', { class: 'small' }, 'Print QR poster'); poster.addEventListener('click', () => window.open(`/poster?url=${encodeURIComponent(cloud.shareUrl)}&name=${encodeURIComponent(cloud.sessionName || '')}`)); line2.appendChild(poster);
      const stop = el('button', { class: 'small' }, 'Stop sharing'); stop.addEventListener('click', toggleShare); line2.appendChild(stop);
      line2.appendChild(el('span', { class: 'hint', style: 'margin:0' }, `${cloud.sent} events sent${cloud.queued ? `, ${cloud.queued} queued` : ''}${cloud.error ? ` · ⚠ ${cloud.error}` : ''} · audio stays on this Mac`));
      right.appendChild(line2);
      w2.append(qrBox, right);
      sr.appendChild(w2);
    } else { const b = el('button', { class: 'small primary' }, 'Start sharing'); b.addEventListener('click', toggleShare); sr.appendChild(b); sr.appendChild(el('span', { class: 'muted', style: 'margin-left:8px' }, `as ${cloud.email}`)); }
    // recording
    const rr = $('recRow'); rr.innerHTML = '';
    const rb = el('button', { class: `small ${rc.recording ? '' : 'danger'}` }, rc.recording ? '■ Stop' : '● Start'); rb.addEventListener('click', toggleRecording);
    const rwrap = el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }); rwrap.appendChild(rb);
    if (rc.recording && rc.current) { const c = rc.current; rwrap.appendChild(el('span', {}, `${Sub.fmtClock(c.elapsedMs)} · ${Sub.fmtBytes(c.bytes)} · ${c.cues.zh} cues${c.paddedMs > 500 ? ` · ${(c.paddedMs / 1000).toFixed(1)} s padded` : ''}${c.encoderAlive ? '' : ' · encoder restarting…'}`)); }
    else if (rc.last) rwrap.appendChild(el('span', { class: 'muted' }, `last: ${rc.last.file} · ${Sub.fmtClock(rc.last.durationMs)} · ${rc.last.cues.zh} cues`));
    else rwrap.appendChild(el('span', { class: 'muted' }, 'not recording'));
    rr.appendChild(rwrap);
    $('recDir').textContent = `${s.recordingsDir || (rc.dir || '')} · MP4 with burned-in subtitles after recording: ${s.mp4Auto === false ? 'off' : 'on'}`;
    const fr = $('footRight'); if (fr) fr.textContent = s.demo ? 'Demo mode · scripted sentences' : st.state === 'ready' ? `Tencent 實時語音翻譯${st.rotateAt ? ` · rotation in ${Sub.fmtAgo(st.rotateAt - now)}` : ''}` : '';
    const gb = $('glossRow') && $('glossRow').querySelector('button');
    if (gb && window.Glossary && Glossary.loaded) { const n = Glossary.items.length; gb.textContent = n ? `Glossary… · ${n} term${n === 1 ? '' : 's'}` : 'Glossary…'; }
  };

  App.register('live', view);
})();
