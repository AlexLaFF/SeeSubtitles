// Display page: bottom-anchored subtitle lines, in-place partial updates, upward FLIP scroll.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const isOverlay = params.has('overlay');
  if (isOverlay) document.body.classList.add('overlay');
  if (Sub.remote) document.body.classList.add('remote');

  const linesEl = $('lines');
  const panel = $('panel');
  const statusEl = $('status');
  const hint = $('hint');

  const lines = [];
  const byId = new Map();
  let renderQueued = false;

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  function ingest(line) {
    const cur = byId.get(line.id);
    if (cur) Object.assign(cur, line);
    else {
      byId.set(line.id, line);
      lines.push(line);
      if (lines.length > 200) byId.delete(lines.shift().id);
    }
    queueRender();
  }

  function textFor(line) {
    const m = Sub.settings.showMode || 'target';
    if (m === 'source') return { main: line.sourceText || '', sub: '' };
    if (m === 'both') return { main: line.targetText || '', sub: line.sourceText || '' };
    return { main: line.targetText || '', sub: '' };
  }

  // Candidates: the newest sentences with text, up to the cap. Sentences stay on screen until they are
  // physically pushed past the top edge, where they fade; the count is only a cap.
  function visible() {
    const n = Number(Sub.settings.visibleLines) || 20;
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      const t = textFor(lines[i]);
      if (t.main || t.sub) out.unshift(lines[i]);
    }
    return out;
  }

  function render() {
    const want = visible();
    const before = new Map();
    const existing = new Map();
    for (const el of linesEl.children) {
      before.set(el.dataset.id, el.getBoundingClientRect().top);
      existing.set(el.dataset.id, el);
    }
    const wantIds = new Set(want.map((l) => l.id));
    for (const [id, el] of existing) if (!wantIds.has(id)) el.remove();
    for (const line of want) {
      let el = existing.get(line.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'line enter';
        el.dataset.id = line.id;
        el.appendChild(document.createElement('span')).className = 'main';
        el.appendChild(document.createElement('span')).className = 'sub';
      }
      const t = textFor(line);
      const [main, sub] = el.children;
      if (main.textContent !== t.main) main.textContent = t.main;
      if (sub.textContent !== t.sub) sub.textContent = t.sub;
      sub.hidden = !t.sub;
      el.classList.toggle('partial', !line.ended);
      linesEl.appendChild(el); // re-appending existing nodes keeps them in order
    }
    // FLIP: existing lines glide from their old position to the new one; new lines rise with them
    // (starting from where the stack was) so nothing overlaps mid-animation.
    let shift = 0;
    for (const el of linesEl.children) {
      const b = before.get(el.dataset.id);
      if (b === undefined) continue;
      const dy = b - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 0.5) continue;
      shift = Math.max(shift, dy);
      slide(el, dy, false);
    }
    for (const el of linesEl.children) {
      if (!el.classList.contains('enter')) continue;
      el.classList.remove('enter');
      slide(el, shift, true);
    }
  }

  // Scroll duration grows with the distance (about a third of a second per row, capped), so a
  // multi-row push scrolls visibly row by row instead of snapping. An interrupted scroll continues
  // from wherever it was, because FLIP measures the current (transformed) positions.
  function slide(el, dy, fadeIn) {
    const row = (Number(Sub.settings.fontSize) || 100) * (Number(Sub.settings.lineSpacing) || 1.25);
    const dur = Math.min(2000, Math.max(260, Math.round(260 + (Math.abs(dy) / row) * 340)));
    for (const a of el.getAnimations()) a.cancel(); // `before` already captured the in-flight position
    const frames = fadeIn
      ? [{ transform: `translateY(${dy}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }]
      : [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }];
    el.animate(frames, { duration: dur, easing: 'cubic-bezier(.25,.6,.3,1)', fill: 'none' });
  }

  function renderStatus() {
    const s = Sub.status || {};
    const st = s.stream || {};
    let text = '';
    if (s.demo) text = '';
    else if (s.remote) text = s.live === false ? 'session ended' : '';
    else if (!s.creds) text = 'no credentials — open Settings';
    else if (!s.streaming) text = 'paused';
    else if (st.state === 'reconnecting') text = `reconnecting${st.retryAt ? ` in ${Math.max(0, Math.ceil((st.retryAt - (s.now || Date.now())) / 1000))}s` : ''}`;
    else if (st.state === 'connecting') text = 'connecting';
    else if (st.state === 'ready' || st.state === 'open') text = '';
    else text = st.state || 'starting';
    if (text && st.lastError) text += ` · ${st.lastError.code ? `${st.lastError.code} ` : ''}${st.lastError.message}`.slice(0, 90);
    statusEl.textContent = text ? `● ${text}` : '';
    statusEl.hidden = !text || Sub.settings.showStatus === false;
    $('btnPause').textContent = Sub.settings.streaming === false ? 'Resume' : 'Pause';
    const rc = s.recorder || {};
    $('btnRec').textContent = rc.recording ? `■ Rec ${Sub.fmtClock(rc.current ? rc.current.elapsedMs : 0)}` : '● Rec';
    $('btnRec').className = rc.recording ? 'primary' : '';
  }

  function togglePanel(force) {
    panel.hidden = force === undefined ? !panel.hidden : !force;
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // ---- wiring
  Controls.render($('panelControls'));
  Controls.renderShortcuts($('kbd'));
  if (Sub.remote) for (const id of ['btnClear', 'btnPause', 'btnReconnect', 'btnRec', 'btnControl']) $(id).hidden = true;
  $('btnClear').addEventListener('click', () => Sub.post('/api/clear'));
  $('btnPause').addEventListener('click', () => Sub.update({ streaming: !Sub.settings.streaming }));
  $('btnReconnect').addEventListener('click', () => Sub.post('/api/reconnect'));
  $('btnRec').addEventListener('click', () => {
    const on = Sub.status.recorder && Sub.status.recorder.recording;
    if (on && !confirm('Stop the recording?')) return;
    Sub.post('/api/record', { action: on ? 'stop' : 'start' }).then((r) => { if (r && r.error) alert(r.error); });
  });
  $('btnFs').addEventListener('click', toggleFullscreen);
  $('btnControl').addEventListener('click', () => window.open('/control', '_blank'));
  $('btnHide').addEventListener('click', () => togglePanel(false));
  if (isOverlay) {
    const closeBtn = $('btnCloseOverlay');
    closeBtn.hidden = false;
    closeBtn.addEventListener('click', () => Sub.post('/api/overlay/close'));
  }
  $('stage').addEventListener('dblclick', () => togglePanel());
  if (isOverlay) hint.hidden = true; // nothing but subtitles on the venue screen
  else setTimeout(() => hint.classList.add('fade'), 6000);

  document.addEventListener('keydown', (e) => {
    if (Sub.isTyping(e)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C') { togglePanel(); e.preventDefault(); return; }
    if (e.key === 'Escape') { togglePanel(false); return; }
    if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); e.preventDefault(); return; }
    if (Sub.keyAction(e)) e.preventDefault();
  });

  Sub.on('init', (d) => {
    lines.length = 0;
    byId.clear();
    for (const l of d.lines) ingest(l);
    Sub.applyCss(d.settings);
    Controls.setDevices(d.devices);
    Controls.setPresets(d.presets);
    Controls.setOverlay(d.status.overlay);
    Controls.sync(d.settings, true);
    renderStatus();
    queueRender();
  });
  Sub.on('line', ingest);
  Sub.on('clear', () => { lines.length = 0; byId.clear(); queueRender(); });
  Sub.on('settings', (d) => {
    Sub.applyCss(d.settings);
    if (d.from !== Sub.clientId) Controls.sync(d.settings);
    renderStatus();
    queueRender();
  });
  Sub.on('local', () => { Sub.applyCss(Sub.settings); renderStatus(); queueRender(); });
  Sub.on('status', (s) => { renderStatus(); Controls.setOverlay(s.overlay); });
  Sub.on('devices', Controls.setDevices);
  Sub.on('presets', Controls.setPresets);
  Sub.on('overlay', Controls.setOverlay);
  Sub.on('disconnected', () => { statusEl.textContent = '● server offline'; statusEl.hidden = Sub.settings.showStatus === false; });
  window.__display = { lines, byId, render };
  Sub.connect();
})();
