// Operator control page: status, mic level, device/language switching, look & feel, transcript, log.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = Controls.el;
  const preview = [];
  const previewById = new Map();
  const logEl = $('log');

  Controls.render($('controlsIO'), { groups: ['input', 'output'] });
  Controls.render($('controlsLook'), { groups: ['text', 'layout', 'background'] });
  Controls.renderShortcuts($('kbd'));

  $('btnPause').addEventListener('click', () => Sub.update({ streaming: !Sub.settings.streaming }));
  $('btnClear').addEventListener('click', () => Sub.post('/api/clear'));
  $('btnReconnect').addEventListener('click', () => Sub.post('/api/reconnect').then((r) => { if (r && r.error) alert(r.error); }));
  $('btnDisplay').addEventListener('click', () => window.open('/', '_blank'));
  $('btnTranscript').addEventListener('click', () => window.open('/api/transcript', '_blank'));
  $('btnPlainSource').addEventListener('click', () => CleanDownloads.live('source'));
  $('btnPlainTarget').addEventListener('click', () => CleanDownloads.live('target'));
  $('btnPlayback').addEventListener('click', () => window.open('/playback', '_blank'));
  document.addEventListener('keydown', (e) => { if (Sub.keyAction(e)) e.preventDefault(); });

  // ---- recording
  let recWasOn = null;
  $('btnRec').addEventListener('click', () => {
    const on = Sub.status.recorder && Sub.status.recorder.recording;
    if (on && !confirm('Stop the recording?')) return;
    Sub.post('/api/record', { action: on ? 'stop' : 'start' }).then((r) => { if (r && r.error) alert(r.error); loadRecordings(); });
  });
  function renderRecorder() {
    const rc = (Sub.status && Sub.status.recorder) || {};
    const on = !!rc.recording;
    const btn = $('btnRec');
    btn.textContent = on ? '■ Stop recording' : '● Start recording';
    btn.className = on ? 'primary' : 'danger';
    const kv = $('recKv');
    kv.innerHTML = '';
    const rows = [];
    if (on && rc.current) {
      const c = rc.current;
      rows.push(['Status', c.encoderAlive ? 'RECORDING' : 'RECORDING (encoder restarting…)'], ['File', c.file], ['Elapsed', Sub.fmtClock(c.elapsedMs)], ['Size', Sub.fmtBytes(c.bytes)],
        ['Subtitle cues', `${c.cues.zh} zh · ${c.cues.yue} yue`], ['Padded silence', `${(c.paddedMs / 1000).toFixed(1)} s`], ['Encoder restarts', c.encoderRestarts]);
      if (c.error) rows.push(['Last encoder message', c.error]);
    } else if (rc.last) {
      const l = rc.last;
      rows.push(['Status', 'idle'], ['Last saved', `${l.file} · ${Sub.fmtClock(l.durationMs)} · ${Sub.fmtBytes(l.bytes)} · ${l.cues.zh} cues`]);
    } else rows.push(['Status', 'idle']);
    for (const [k, v] of rows) { kv.appendChild(el('dt', {}, k)); kv.appendChild(el('dd', {}, String(v))); }
    if (recWasOn !== on) { recWasOn = on; loadRecordings(); }
    const mp4Key = JSON.stringify([Sub.status.mp4, Sub.status.summary]);
    if (mp4Key !== renderRecorder.mp4Key) { renderRecorder.mp4Key = mp4Key; loadRecordings(); }
  }
  function loadRecordings() {
    fetch('/api/recordings').then((r) => r.json()).then((list) => {
      const box = $('recList');
      box.innerHTML = '';
      if (!list.length) return box.appendChild(el('div', { class: 'muted' }, 'none yet'));
      for (const r of list) {
        const p = el('div', { class: 'p' });
        p.appendChild(el('div', {}, `${r.base} · ${Sub.fmtBytes(r.bytes)}`));
        const links = el('div', { class: 's' });
        const a = (name, label) => { const x = el('a', { href: `/recordings/${encodeURIComponent(name)}`, download: name }, label); links.appendChild(x); links.appendChild(document.createTextNode('  ')); };
        const play = el('a', { href: `/playback?rec=${encodeURIComponent(r.base)}`, target: '_blank' }, '▶ play with subtitles');
        links.appendChild(play); links.appendChild(document.createTextNode('   '));
        a(r.mp3, 'mp3');
        if (r.zh) a(r.zh, 'zh.srt');
        if (r.yue) a(r.yue, 'yue.srt');
        for (const [lang, label] of [['yue', 'Plain text · original'], ['zh', 'Plain text · translation']]) {
          if (!r[lang]) continue;
          const b = el('button', {}, label);
          b.addEventListener('click', () => CleanDownloads.recording(r, lang));
          links.appendChild(b);
        }
        const mp4st = (Sub.status && Sub.status.mp4) || {};
        if (r.mp4) a(r.mp4, `mp4 (${Sub.fmtBytes(r.mp4Bytes)})`);
        else if (mp4st.current && mp4st.current.base === r.base) links.appendChild(el('span', { class: 'muted' }, `mp4: ${mp4st.current.stage} ${mp4st.current.percent}%`));
        else if ((mp4st.queue || []).includes(r.base)) links.appendChild(el('span', { class: 'muted' }, 'mp4: queued'));
        else if (r.zh || r.yue) { const b = el('button', {}, 'Make MP4'); b.addEventListener('click', () => Sub.post('/api/recordings/mp4', { base: r.base }).then((x) => { if (x && x.error) alert(x.error); })); links.appendChild(b); }
        // AI learning summary (manual)
        const sm = (Sub.status && Sub.status.summary) || {};
        links.appendChild(document.createTextNode('  '));
        if (sm.current && sm.current.base === r.base) links.appendChild(el('span', { class: 'muted' }, `AI summary: ${sm.current.stage}${sm.current.chars ? ` — ${sm.current.chars} chars written so far` : ''}…`));
        else if ((sm.queue || []).includes(r.base)) links.appendChild(el('span', { class: 'muted' }, 'AI summary: queued'));
        else {
          if (r.summary) { const a2 = el('a', { href: `/summary?rec=${encodeURIComponent(r.base)}`, target: '_blank' }, '📘 AI summary'); links.appendChild(a2); links.appendChild(document.createTextNode('  ')); }
          if (r.summaryPdf) a(r.summaryPdf, 'summary PDF');
          else if (r.summary) { const bp = el('button', {}, 'Make PDF'); bp.addEventListener('click', () => Sub.post('/api/recordings/summary-pdf', { base: r.base }).then((x) => { if (x && x.error) alert(x.error); })); links.appendChild(bp); links.appendChild(document.createTextNode('  ')); }
          if (r.zh || r.yue) {
            const b = el('button', { title: sm.configured ? `Generate a learning summary with ${sm.model}` : 'Add your Anthropic API key in Settings → AI summaries' }, r.summary ? 'Regenerate summary' : 'Generate AI summary');
            b.addEventListener('click', () => { if (r.summary && !confirm('Regenerate the AI summary? The current one will be replaced.')) return; Sub.post('/api/recordings/summary', { base: r.base }).then((x) => { if (x && x.error) alert(x.error); }); });
            links.appendChild(b);
          }
        }
        p.appendChild(links);
        box.appendChild(p);
      }
    }).catch(() => {});
  }

  const BILLING = { 6003: 'the 实时语音翻译 service is not enabled on the account', 6004: 'quota exhausted — the 大模型实时语音翻译 resource pack is used up and post-paid billing is off', 6005: 'account in arrears (欠费)' };
  function renderAlert(st, s) {
    const box = $('alert');
    const code = st.lastError && st.lastError.code;
    let text = '';
    if (s.creds && st.state === 'reconnecting' && BILLING[code]) text = `Tencent refused the connection (${code}): ${BILLING[code]}. Subtitles are paused; recording continues. Fix it in the Tencent console (语音识别设置 → 后付费, or buy a 大模型实时语音翻译 pack) — the app retries every 30 s.`;
    else if (s.creds && st.state === 'reconnecting' && st.reconnects >= 3 && st.lastError) text = `Connection keeps failing: ${st.lastError.message}`;
    box.textContent = text;
    box.hidden = !text;
  }
  function renderStatus() {
    const s = Sub.status || {};
    const st = s.stream || {};
    renderAlert(st, s);
    const cap = s.capture || {};
    const badge = $('badge');
    let cls = 'warn';
    let label = st.state || '…';
    let detail = '';
    if (s.demo) { cls = 'demo'; label = 'DEMO'; detail = 'scripted sentences, no mic, no Tencent'; }
    else if (!s.creds) { cls = 'bad'; label = 'NO CREDENTIALS'; detail = s.credsError || ''; }
    else if (!s.streaming) { cls = 'warn'; label = 'PAUSED'; detail = 'press P or Resume'; }
    else if (st.state === 'ready') { cls = 'ready'; label = 'LIVE'; detail = st.rotating ? 'rotating to a fresh connection…' : ''; }
    else if (st.state === 'open') { label = 'AUTHENTICATING'; }
    else if (st.state === 'connecting') { label = 'CONNECTING'; }
    else if (st.state === 'reconnecting') { cls = 'bad'; label = 'RECONNECTING'; detail = st.retryAt ? `retry in ${Math.max(0, Math.ceil((st.retryAt - (s.now || Date.now())) / 1000))}s` : ''; }
    else { label = String(st.state || '').toUpperCase(); }
    badge.className = `badge ${cls}`;
    badge.textContent = label;
    $('stateText').textContent = detail;
    $('btnPause').textContent = s.streaming === false ? 'Resume' : 'Pause';

    const db = s.level ? s.level.dbfs : null;
    const pct = db == null ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    $('meter').style.width = `${pct}%`;
    $('levelText').textContent = db == null ? 'mic level: no audio yet' : `mic level ${db.toFixed(1)} dBFS${db < -50 ? ' (very quiet — check the mic)' : ''}`;

    const now = s.now || Date.now();
    const rows = [
      ['Connected for', st.connectedAt ? Sub.fmtAgo(now - st.connectedAt) : '–'],
      ['Next rotation', st.rotateAt ? `in ${Sub.fmtAgo(st.rotateAt - now)}` : '–'],
      ['Reconnects', st.reconnects ?? 0],
      ['Queue / dropped', `${st.queue ?? 0} / ${st.dropped ?? 0} chunks`],
      ['Languages', st.source ? `${st.source} → ${st.target} · ${st.transModel}` : '–'],
      ['voice_id', st.voiceId || '–'],
      ['Gateway', st.edge || '–'],
      ['Mic', `${cap.device || '–'}${cap.alive === false && cap.running ? ' (ffmpeg restarting…)' : ''}${cap.restarts ? ` · ${cap.restarts} restarts` : ''}`],
      ['Overlay', s.overlay && s.overlay.present ? `open at ${s.overlay.bounds ? `${s.overlay.bounds.width}×${s.overlay.bounds.height} @ ${s.overlay.bounds.x},${s.overlay.bounds.y}` : '?'}` : 'closed'],
      ['Last error', st.lastError ? `${st.lastError.code ? `${st.lastError.code} ` : ''}${st.lastError.message}` : (cap.lastError || '–')],
    ];
    const kv = $('kv');
    kv.innerHTML = '';
    for (const [k, v] of rows) { kv.appendChild(el('dt', {}, k)); kv.appendChild(el('dd', {}, String(v))); }
  }

  let cloudBusy = false;
  function renderCloud(c) {
    const panel = $('cloudPanel');
    if (!panel) return;
    if (c === undefined) { panel.hidden = true; return; } // not the desktop app
    panel.hidden = false;
    const text = $('cloudText');
    const pub = $('btnPublish');
    const copy = $('btnCopyShare');
    const link = $('shareLink');
    if (!c || !c.loggedIn) {
      text.textContent = 'Not logged in. Open Settings (⌘,) → Cloud to log in to the hosted server.';
      pub.hidden = copy.hidden = link.hidden = true;
      return;
    }
    pub.hidden = false;
    if (c.session) {
      text.textContent = `Publishing as ${c.email} · ${c.sent} events sent${c.queued ? `, ${c.queued} queued` : ''}${c.error ? ` · ⚠ ${c.error}` : ''}`;
      pub.textContent = 'Stop publishing';
      pub.className = 'danger';
      link.hidden = copy.hidden = false;
      link.href = c.shareUrl;
      link.textContent = c.shareUrl;
    } else {
      text.textContent = `Logged in as ${c.email} @ ${c.url}. Not publishing.${c.error ? ` ⚠ ${c.error}` : ''}`;
      pub.textContent = 'Publish to cloud';
      pub.className = 'primary';
      link.hidden = copy.hidden = true;
    }
  }
  $('btnPublish').addEventListener('click', () => {
    if (cloudBusy) return;
    cloudBusy = true;
    const on = !(Sub.status.cloud && Sub.status.cloud.session);
    Sub.post('/api/cloud', { action: 'publish', on }).then((r) => { cloudBusy = false; if (r && r.error) alert(r.error); });
  });
  $('btnCopyShare').addEventListener('click', () => { navigator.clipboard.writeText($('shareLink').href).catch(() => {}); });

  function ingest(line) {
    const cur = previewById.get(line.id);
    if (cur) Object.assign(cur, line);
    else {
      previewById.set(line.id, line);
      preview.push(line);
      if (preview.length > 12) previewById.delete(preview.shift().id);
    }
    renderPreview();
  }
  function renderPreview() {
    const box = $('preview');
    box.innerHTML = '';
    for (const l of preview) {
      const p = el('div', { class: `p${l.ended ? '' : ' partial'}` });
      p.appendChild(el('div', {}, l.targetText || '…'));
      p.appendChild(el('div', { class: 's' }, l.sourceText || ''));
      box.appendChild(p);
    }
    box.scrollTop = box.scrollHeight;
  }
  function addLog(entry) {
    const line = el('div', { class: entry.level }, `${new Date(entry.t).toTimeString().slice(0, 8)}  ${entry.text}`);
    logEl.appendChild(line);
    while (logEl.children.length > 200) logEl.firstChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  Sub.on('init', (d) => {
    preview.length = 0;
    previewById.clear();
    for (const l of d.lines) ingest(l);
    Controls.setDevices(d.devices);
    Controls.setPresets(d.presets);
    Controls.setOverlay(d.status.overlay);
    Controls.sync(d.settings, true);
    logEl.innerHTML = '';
    for (const e of d.logs || []) addLog(e);
    renderStatus();
    renderRecorder();
  });
  Sub.on('line', ingest);
  Sub.on('clear', () => { preview.length = 0; previewById.clear(); renderPreview(); });
  Sub.on('settings', (d) => { if (d.from !== Sub.clientId) Controls.sync(d.settings); renderStatus(); });
  Sub.on('local', renderStatus);
  Sub.on('status', (s) => { renderStatus(); renderRecorder(); Controls.setOverlay(s.overlay); renderCloud(s.cloud); });
  Sub.on('devices', Controls.setDevices);
  Sub.on('presets', Controls.setPresets);
  Sub.on('overlay', Controls.setOverlay);
  Sub.on('log', addLog);
  Sub.on('disconnected', () => { $('badge').className = 'badge bad'; $('badge').textContent = 'SERVER OFFLINE'; });
  Sub.connect();
})();
