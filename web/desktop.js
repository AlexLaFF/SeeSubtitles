// Desktop app shell: sidebar, view routing (Live / Files / Settings), status feed shared by the views.
(function () {
  'use strict';
  const el = Controls.el;
  const App = { views: {}, current: null, main: null, params: {} };

  App.register = (name, view) => { App.views[name] = view; };

  /** path → { view, params } : /control → live, /files → files, /files/<base> → files detail, /settings */
  App.route = function (pathname) {
    if (pathname.startsWith('/files/')) return { view: 'files', params: { base: decodeURIComponent(pathname.slice('/files/'.length)) } };
    if (pathname === '/files') return { view: 'files', params: {} };
    if (pathname === '/settings') return { view: 'settings', params: {} };
    return { view: 'live', params: {} };
  };
  App.pathFor = (view, params = {}) => (view === 'files' ? (params.base ? `/files/${encodeURIComponent(params.base)}` : '/files') : view === 'settings' ? '/settings' : '/control');

  App.go = function (view, params = {}, { replace = false } = {}) {
    const path = App.pathFor(view, params);
    if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({ view, params }, '', path);
    App.show(view, params);
  };

  App.show = function (view, params) {
    const v = App.views[view];
    if (!v) return;
    if (App.current && App.current !== v && App.current.leave) App.current.leave();
    App.current = v;
    App.params = params || {};
    for (const n of document.querySelectorAll('.side .nav')) n.classList.toggle('active', n.dataset.view === view);
    App.main.innerHTML = '';
    v.render(App.main, App.params);
    document.title = t('app.title', { view: v.title });
  };

  App.refresh = () => { if (App.current && App.current.update) App.current.update(); };

  App.desktop = () => window.desktop || null; // preload bridge (Electron); null in a plain browser

  App.openExternal = (url) => Sub.post('/api/open', { url });

  /** Small dropdown menu anchored below a button. items: [{label, href?, download?, onClick?}] */
  App.menu = function (anchor, items) {
    document.querySelectorAll('.shell .menu').forEach((m) => m.remove());
    const m = el('div', { class: 'menu' });
    for (const it of items) {
      const a = it.href ? el('a', { href: it.href, download: it.download || null, target: it.target || null }, it.label) : el('button', {}, it.label);
      if (it.onClick) a.addEventListener('click', (e) => { e.preventDefault(); it.onClick(); });
      a.addEventListener('click', () => m.remove());
      m.appendChild(a);
    }
    const r = anchor.getBoundingClientRect();
    m.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
    m.style.top = `${r.bottom + 4}px`;
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
  };

  function renderAccount() {
    const c = Sub.status && Sub.status.cloud;
    const box = document.getElementById('account');
    box.innerHTML = '';
    box.appendChild(el('b', {}, c && c.loggedIn ? c.email : t('account.notLoggedIn')));
    box.appendChild(el('span', {}, c && c.loggedIn ? `${c.url.replace(/^https?:\/\//, '')} · ${c.session ? t('account.sharing') : t('account.connected')}` : t('account.hint')));
  }

  App.start = function () {
    App.main = document.getElementById('main');
    // language: the app's setting arrives in `init`; ?lang= overrides for this page load (testing)
    const qlang = new URLSearchParams(location.search).get('lang');
    if (qlang) I18n.setLanguage(qlang);
    I18n.apply();
    I18n.onChange(() => { I18n.apply(); renderAccount(); if (App.current) App.show(Object.keys(App.views).find((k) => App.views[k] === App.current), App.params); });
    Sub.on('language', (d) => { if (!qlang) I18n.setLanguage(d.language); });
    for (const n of document.querySelectorAll('.side .nav')) n.addEventListener('click', () => App.go(n.dataset.view));
    window.addEventListener('popstate', () => { const r = App.route(location.pathname); App.show(r.view, r.params); });
    const r = App.route(location.pathname);
    App.show(r.view, r.params);
    if (window.desktop && window.desktop.onNavigate) window.desktop.onNavigate((view, params) => App.go(view, params || {}));
    document.addEventListener('keydown', (e) => { if (Sub.keyAction(e)) e.preventDefault(); });
    Sub.on('init', (d) => { if (d.language && !qlang) I18n.setLanguage(d.language); Controls.setDevices(d.devices); Controls.setPresets(d.presets); Controls.setOverlay(d.status.overlay); Controls.sync(d.settings, true); renderAccount(); for (const v of Object.values(App.views)) if (v.init) v.init(d); App.refresh(); });
    Sub.on('status', (s) => { Controls.setOverlay(s.overlay); renderAccount(); App.refresh(); });
    Sub.on('settings', (d) => { if (d.from !== Sub.clientId) Controls.sync(d.settings); App.refresh(); });
    Sub.on('local', App.refresh);
    Sub.on('devices', Controls.setDevices);
    Sub.on('presets', Controls.setPresets);
    Sub.on('overlay', Controls.setOverlay);
    Sub.on('disconnected', () => { App.offline = true; App.refresh(); });
    Sub.on('connected', () => { App.offline = false; App.refresh(); });
    Sub.connect();
  };

  window.App = App;
})();
