'use strict';
// Strings for the Electron main process (menus, dialogs, tray), from the same catalog as the pages.
const path = require('node:path');
let LOCALES = null;
let lang = 'en';
function load(webDir) { LOCALES = require(path.join(webDir, 'locales.js')); return LOCALES; }
/** 'en' | 'zh' from the config preference ('system' → the OS language, via app.getLocale()). */
function resolve(pref, systemLocale) {
  if (pref === 'en' || pref === 'zh') return pref;
  return String(systemLocale || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
function setLanguage(l) { lang = l === 'zh' ? 'zh' : 'en'; return lang; }
function t(key, vars) {
  const c = LOCALES || { en: {}, zh: {} };
  let s = (c[lang] || {})[key];
  if (s == null) s = (c.en || {})[key];
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}
module.exports = { load, resolve, setLanguage, t, get lang() { return lang; } };
