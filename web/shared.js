// Shared browser client: SSE connection, settings sync, CSS application, keyboard shortcuts.
(function () {
  'use strict';
  const clientId = Math.random().toString(36).slice(2, 10);
  // Remote display mode: /d/<code> on the hosted server mirrors a desktop session. Settings changes made
  // on this page stay local (they are not sent anywhere) and win over mirrored values until reload.
  const remoteMatch = location.pathname.match(/^\/d\/([A-Za-z0-9_-]+)/);
  const Sub = {
    clientId, settings: {}, status: {}, _listeners: {}, _pending: {}, _timer: null,
    remote: !!remoteMatch,
    sessionCode: remoteMatch ? remoteMatch[1] : null,
    eventsUrl: remoteMatch ? `/api/d/${remoteMatch[1]}/stream` : '/events',
    _overrides: {},
  };
  // A phone remembers the text size and show mode its owner chose; the first visit fits the venue's px size to the
  // viewport (120 px on a 1920-wide screen becomes about 30 px on a phone), after which A− / A+ step from there.
  const REMOTE_KEYS = ['fontSize', 'showMode'];
  if (Sub.remote) { try { const saved = JSON.parse(localStorage.getItem('subs.remote') || '{}'); for (const k of REMOTE_KEYS) if (saved[k] != null) Sub._overrides[k] = saved[k]; } catch { /* no storage */ } }
  const fitRemote = (settings) => {
    if (Sub._overrides.fontSize != null) return;
    const scale = Math.min(1, window.innerWidth / 1600);
    Sub._overrides.fontSize = Math.max(18, Math.round((Number(settings.fontSize) || 100) * scale));
  };

  // Ask for one line of text. Browsers use the built-in dialog; Electron has none, so the desktop shell installs
  // its own sheet under the same name before any view runs. Resolves with the text, or null when cancelled.
  if (!window.askText) window.askText = (message, value = '') => { try { return Promise.resolve(window.prompt(message, value)); } catch { return Promise.resolve(null); } };
  Sub.on = (ev, fn) => { (Sub._listeners[ev] ||= []).push(fn); return Sub; };
  Sub.emit = (ev, data) => { for (const fn of Sub._listeners[ev] || []) fn(data); };

  Sub.connect = function (url) {
    const es = new EventSource(url || Sub.eventsUrl);
    const relay = (ev, pre) => es.addEventListener(ev, (e) => { const d = JSON.parse(e.data); if (pre) pre(d); Sub.emit(ev, d); });
    relay('init', (d) => {
      // the server was restarted (new code): reload so the page runs the matching front-end
      if (Sub.serverId && d.serverId && d.serverId !== Sub.serverId) { location.reload(); return; }
      Sub.serverId = d.serverId;
      d.status = d.status || {};
      d.lines = d.lines || [];
      d.devices = d.devices || [];
      d.presets = d.presets || { builtin: (window.SCHEMA && SCHEMA.PRESETS) || {}, user: {} };
      if (Sub.remote) { fitRemote(d.settings); Object.assign(d.settings, Sub._overrides); }
      Sub.settings = d.settings;
      Sub.status = d.status;
    });
    relay('settings', (d) => { if (Sub.remote) Object.assign(d.settings, Sub._overrides); Sub.settings = d.settings; });
    relay('status', (d) => { Sub.status = d; });
    for (const ev of ['line', 'clear', 'devices', 'overlay', 'log', 'presets']) relay(ev);
    es.onopen = () => Sub.emit('connected');
    es.onerror = () => Sub.emit('disconnected');
    Sub.es = es;
    return es;
  };

  Sub.post = (path, body) => (Sub.remote ? Promise.resolve(null) : fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then((r) => r.json())
    .catch((err) => { console.warn(path, err); return null; }));

  /** Apply a settings patch locally right away, and send it to the server (coalesced for slider drags). */
  Sub.update = function (patch) {
    Object.assign(Sub.settings, patch);
    Sub.emit('local', patch);
    if (Sub.remote) {
      Object.assign(Sub._overrides, patch);
      try { localStorage.setItem('subs.remote', JSON.stringify(Object.fromEntries(REMOTE_KEYS.filter((k) => Sub._overrides[k] != null).map((k) => [k, Sub._overrides[k]])))); } catch { /* private mode */ }
      return;
    }
    Object.assign(Sub._pending, patch);
    if (!Sub._timer) {
      Sub._timer = setTimeout(() => {
        const p = Sub._pending;
        Sub._pending = {};
        Sub._timer = null;
        Sub.post('/api/settings', { patch: p, from: clientId });
      }, 40);
    }
  };

  Sub.hexToRgba = (hex, a) => {
    const n = parseInt(String(hex || '#000000').slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  Sub.applyCss = function (s) {
    if (!s) return;
    const st = document.documentElement.style;
    st.setProperty('--font-size', `${s.fontSize}px`);
    st.setProperty('--font-weight', s.fontWeight);
    st.setProperty('--font-family', s.fontFamily || (window.SCHEMA && SCHEMA.DEFAULT_FONT) || 'sans-serif');
    st.setProperty('--font-color', s.fontColor);
    st.setProperty('--line-height', s.lineSpacing);
    st.setProperty('--line-gap', `${s.lineGap}em`);
    st.setProperty('--pad-x', `${s.paddingX}vw`);
    st.setProperty('--pad-y', `${s.paddingY}vh`);
    st.setProperty('--pad-top', `${s.paddingTop == null ? 2 : s.paddingTop}vh`);
    st.setProperty('--align', s.align);
    st.setProperty('--stage-bg', Sub.hexToRgba(s.bgColor, s.bgOpacity)); // the subtitle stage; --bg is the window (tokens.css)
    document.body.classList.toggle('shadow', !!s.textShadow);
    document.body.classList.toggle('fade', s.topFade !== false);
  };

  Sub.bumpFont = function (dir, big) {
    const f = big ? 1.15 : 1.05;
    const cur = Number(Sub.settings.fontSize) || 100;
    let v = dir > 0 ? Math.max(cur + 1, Math.round(cur * f)) : Math.min(cur - 1, Math.round(cur / f));
    v = Math.min(1200, Math.max(8, v));
    Sub.update({ fontSize: v });
  };

  Sub.isTyping = (e) => {
    const target = e.target;
    return !!(target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
  };

  /** Shared shortcuts. Returns true when the key was handled. */
  Sub.keyAction = function (e) {
    if (Sub.isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return false;
    const lines = Number(Sub.settings.visibleLines) || 3;
    switch (e.key) {
      case '=': case '+': case 'ArrowUp': Sub.bumpFont(1, e.shiftKey); return true;
      case '-': case '_': case 'ArrowDown': Sub.bumpFont(-1, e.shiftKey); return true;
      case ']': Sub.update({ visibleLines: Math.min(30, lines + 1) }); return true;
      case '[': Sub.update({ visibleLines: Math.max(1, lines - 1) }); return true;
      case 'S': { // Shift+S only, so a stray keypress cannot switch what the audience sees
        if (!e.shiftKey) return false;
        const modes = ['target', 'both', 'source'];
        Sub.update({ showMode: modes[(modes.indexOf(Sub.settings.showMode) + 1) % modes.length] });
        return true;
      }
      case 'p': case 'P': Sub.update({ streaming: !Sub.settings.streaming }); return true;
      case 'x': case 'X': Sub.post('/api/clear'); return true;
      case 'R': if (e.shiftKey) { Sub.post('/api/record', { action: 'toggle' }).then((r) => { if (r && r.error) alert(r.error); }); return true; } return false;
      default: return false;
    }
  };

  Sub.SHORTCUTS = [ // [keys, catalog key]
    ['+ / −  or  ↑ / ↓', 'sc.size'], ['[ / ]', 'sc.lines'], ['Shift+S', 'sc.cycle'], ['P', 'sc.pause'], ['X', 'sc.clear'],
    ['Shift+R', 'sc.record'], ['C', 'sc.panel'], ['F', 'sc.fullscreen'], ['Esc', 'sc.esc'],
  ];

  Sub.fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  Sub.fmtClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const p = (n) => String(n).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`; };
  Sub.fmtAgo = (ms) => {
    if (ms == null || ms < 0) return '–';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  window.Sub = Sub;
})();
