// Runtime for the bilingual catalog (web/locales.js): pick a language, look strings up, re-render on change.
(function (root) {
  'use strict';
  const I18n = { lang: 'en', listeners: [] };
  I18n.catalogs = () => root.LOCALES || { en: {}, zh: {} };
  I18n.available = ['en', 'zh'];
  /** 'en' | 'zh' from a preference ('system' or unset → the browser / OS language). */
  I18n.resolve = (pref) => {
    if (pref === 'en' || pref === 'zh') return pref;
    const n = String((root.navigator && navigator.language) || 'en').toLowerCase();
    return n.startsWith('zh') ? 'zh' : 'en';
  };
  I18n.setLanguage = (pref) => {
    const l = I18n.resolve(pref);
    const changed = l !== I18n.lang;
    I18n.lang = l;
    if (root.document) document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    if (changed) for (const fn of I18n.listeners) fn(l);
    return l;
  };
  I18n.onChange = (fn) => { I18n.listeners.push(fn); };
  I18n.has = (key) => key in (I18n.catalogs()[I18n.lang] || {}) || key in (I18n.catalogs().en || {});
  I18n.t = (key, vars) => {
    const c = I18n.catalogs();
    let s = (c[I18n.lang] || {})[key];
    if (s == null) s = (c.en || {})[key];
    if (s == null) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
  };
  /** Fill elements carrying data-i18n (text), data-i18n-placeholder, data-i18n-title. */
  I18n.apply = (scope) => {
    const rootEl = scope || document;
    for (const e of rootEl.querySelectorAll('[data-i18n]')) e.textContent = I18n.t(e.dataset.i18n);
    for (const e of rootEl.querySelectorAll('[data-i18n-placeholder]')) e.setAttribute('placeholder', I18n.t(e.dataset.i18nPlaceholder));
    for (const e of rootEl.querySelectorAll('[data-i18n-title]')) e.setAttribute('title', I18n.t(e.dataset.i18nTitle));
    if (rootEl === document) { const tt = document.querySelector('title[data-i18n]'); if (tt) document.title = I18n.t(tt.dataset.i18n); }
  };
  /** Text for a server error: {code} → catalog, else the message as sent. */
  I18n.err = (r) => (r && r.code && I18n.has(`err.${r.code}`) ? I18n.t(`err.${r.code}`, r) : (r && (r.error || r.message)) || String(r));
  // pages outside the desktop app remember the choice in localStorage; the desktop app sends it in `init`
  let stored = null;
  try { stored = root.localStorage && localStorage.getItem('lang'); } catch { /* private mode */ }
  I18n.setLanguage(stored || 'system');
  I18n.remember = (pref) => { try { if (pref === 'system') localStorage.removeItem('lang'); else localStorage.setItem('lang', pref); } catch { /* ignore */ } I18n.setLanguage(pref); };
  root.I18n = I18n;
  root.t = I18n.t;
})(window);
