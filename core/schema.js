// Settings schema shared by the Node server (validation/defaults) and the browser (control UI).
// Plain UMD so the same file is served to the page as /schema.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SCHEMA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_FONT = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

  // Languages of 实时语音翻译. LIVE_PAIRS is not the documentation's list: it is what the API answered when
  // every combination was actually opened against this account (server/probe-languages.js --live --pairs,
  // last run 2026-09-10). Anything missing here is refused at the handshake with
  // `6001 参数不合法(not support this lang pair: X to Y)`, so offering it would only produce a dead stream.
  const LANG_NAMES = {
    yue: '粤语 Cantonese',
    zh: '普通话 Mandarin',
    zh_en: '中英混合 Mandarin + English',
    en: 'English',
    ja: '日本語 Japanese',
    ko: '한국어 Korean',
    id: 'Bahasa Indonesia',
    th: 'ไทย Thai',
    ru: 'Русский Russian',
  };
  const LIVE_PAIRS = {
    yue: ['zh', 'en', 'ja', 'ko', 'yue'],
    zh: ['zh', 'en', 'ja', 'ko', 'yue', 'id', 'th'],
    zh_en: ['zh_en', 'zh', 'en', 'ja', 'ko', 'yue', 'id', 'th'],
    en: ['zh', 'en', 'ja', 'ko', 'yue', 'id', 'th'],
    ja: ['zh', 'en', 'ja', 'ko', 'yue'],
    ko: ['zh', 'en', 'ja', 'ko', 'yue'],
    id: ['zh', 'en', 'id'],
    th: ['zh', 'en', 'th'],
    ru: ['zh', 'en', 'ru'],
  };
  const SOURCES = Object.keys(LIVE_PAIRS).map((k) => [k, LANG_NAMES[k]]);
  const TARGETS = [...new Set(Object.values(LIVE_PAIRS).flat())].map((k) => [k, LANG_NAMES[k]]);
  /** Subtitle languages this spoken language can be translated into. Never empty; source === target transcribes. */
  const targetsFor = (source) => LIVE_PAIRS[source] || LIVE_PAIRS.yue;
  /** `target` when the API accepts the pair, else the first target it does accept for `source`. */
  const coerceTarget = (source, target) => (targetsFor(source).includes(target) ? target : targetsFor(source)[0]);

  const FIELDS = [
    // input
    { key: 'audioDevice', group: 'input', label: 'Microphone', type: 'device', default: 'default' },
    { key: 'source', group: 'input', label: 'Spoken language', type: 'select', options: SOURCES, default: 'yue' },
    { key: 'target', group: 'input', label: 'Subtitle language', type: 'select', options: TARGETS, default: 'zh',
      optionsFor: (s) => targetsFor(s.source) },
    { key: 'transModel', group: 'input', label: 'Model', type: 'select', default: 'hunyuan-translation-lite',
      options: [['hunyuan-translation-lite', 'hunyuan-translation-lite (fast)'], ['hunyuan-translation', 'hunyuan-translation (quality)']] },
    { key: 'streaming', group: 'input', label: 'Streaming on', type: 'bool', default: true, persist: false },
    // recognition tuning (Tencent request parameters; applied at the next connection)
    { key: 'hotwords', group: 'input', label: 'Hotwords', type: 'textarea', default: '', placeholder: '每行一个：词|权重（1–11，或 100 强制）\n张培光|10\n安利|8',
      hint: 'Names, brands and terms the recognizer should prefer. One per line as 词|权重. Up to 128.' },
    { key: 'vadSilenceTime', group: 'input', label: 'Pause that ends a sentence', type: 'range', min: 500, max: 2000, step: 50, unit: 'ms', default: 1000,
      hint: 'Shorter = sentences finalize sooner after the speaker pauses; longer = fewer, longer sentences.' },
    { key: 'maxSpeakTime', group: 'input', label: 'Force a split after', type: 'range', min: 5, max: 90, step: 1, unit: 's', default: 10,
      hint: 'Continuous speech is cut into a sentence after this long.' },
    { key: 'filterModal', group: 'input', label: 'Filter filler words', type: 'select', default: '0',
      options: [['0', 'Keep 啊/啦/呢 (default)'], ['1', 'Filter some'], ['2', 'Filter strictly']],
      hint: 'Drops 语气词 from the recognized text before translation. Cleaner subtitles, slightly less of the speaker\'s tone.' },
    { key: 'noiseThreshold', group: 'input', label: 'Noise threshold', type: 'range', min: -2, max: 2, step: 0.1, unit: '', default: 0,
      hint: 'Raise in noisy rooms to ignore more background sound; lower if quiet speech is being dropped.' },
    // output
    { key: 'showMode', group: 'output', label: 'Show', type: 'select', default: 'target',
      options: [['target', 'Translation only'], ['both', 'Translation + original'], ['source', 'Original only']] },
    { key: 'showStatus', group: 'output', label: 'Status dot when offline', type: 'bool', default: true },
    { key: 'window', group: 'output', label: 'Overlay window', type: 'bounds', default: null },
    // text
    { key: 'fontSize', group: 'text', label: 'Text size', type: 'range', min: 8, max: 1200, step: 1, unit: 'px', default: 120, scale: 'log' },
    { key: 'fontWeight', group: 'text', label: 'Weight', type: 'select', default: '700',
      options: [['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['900', 'Black']] },
    { key: 'fontColor', group: 'text', label: 'Text color', type: 'color', default: '#ffffff' },
    { key: 'textShadow', group: 'text', label: 'Dark outline', type: 'bool', default: true },
    { key: 'fontFamily', group: 'text', label: 'Font', type: 'text', default: DEFAULT_FONT },
    // layout
    { key: 'visibleLines', group: 'layout', label: 'Max sentences kept', type: 'range', min: 1, max: 30, step: 1, default: 20 },
    { key: 'topFade', group: 'layout', label: 'Fade out at top edge', type: 'bool', default: true },
    { key: 'lineSpacing', group: 'layout', label: 'Line spacing', type: 'range', min: 0.8, max: 3, step: 0.01, unit: '×', default: 1.25 },
    { key: 'lineGap', group: 'layout', label: 'Gap between lines', type: 'range', min: 0, max: 2, step: 0.05, unit: 'em', default: 0.3 },
    { key: 'paddingX', group: 'layout', label: 'Side padding', type: 'range', min: 0, max: 45, step: 0.5, unit: '%', default: 4 },
    { key: 'paddingY', group: 'layout', label: 'Bottom padding', type: 'range', min: 0, max: 60, step: 0.5, unit: '%', default: 3 },
    { key: 'paddingTop', group: 'layout', label: 'Top padding', type: 'range', min: 0, max: 60, step: 0.5, unit: '%', default: 2 },
    { key: 'align', group: 'layout', label: 'Alignment', type: 'select', default: 'center',
      options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
    // background
    { key: 'bgColor', group: 'background', label: 'Background', type: 'color', default: '#000000' },
    { key: 'bgOpacity', group: 'background', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.01, unit: '', default: 1 },
  ];

  const GROUPS = [
    ['input', 'Input'], ['output', 'Output'], ['text', 'Text'], ['layout', 'Layout'], ['background', 'Background'],
  ];

  const PRESETS = {
    portrait: { label: 'Portrait strip', patch: { align: 'center', visibleLines: 20, fontSize: 110, lineSpacing: 1.2, paddingX: 3, paddingY: 3 } },
    landscape: { label: 'Landscape bar', patch: { align: 'center', visibleLines: 20, fontSize: 140, lineSpacing: 1.2, paddingX: 6, paddingY: 4 } },
    overlayBar: { label: 'Overlay on slides', patch: { bgOpacity: 0, textShadow: true, visibleLines: 3, align: 'center' } },
  };

  const byKey = {};
  for (const f of FIELDS) byKey[f.key] = f;

  function defaults() {
    const o = {};
    for (const f of FIELDS) o[f.key] = f.default;
    return o;
  }

  /** Validate/coerce a partial settings object. Unknown keys and invalid values are dropped. */
  function sanitize(patch) {
    const out = {};
    if (!patch || typeof patch !== 'object') return out;
    for (const key of Object.keys(patch)) {
      const f = byKey[key];
      if (!f) continue;
      let v = patch[key];
      switch (f.type) {
        case 'range':
          v = Number(v);
          if (!Number.isFinite(v)) continue;
          v = Math.min(f.max, Math.max(f.min, v));
          v = f.step >= 1 ? Math.round(v) : Math.round(v * 1000) / 1000;
          break;
        case 'select':
          if (v === undefined || v === null) continue;
          v = String(v);
          if (!f.options.some((o) => o[0] === v)) continue;
          break;
        case 'color':
          v = String(v).toLowerCase();
          if (!/^#[0-9a-f]{6}$/.test(v)) continue;
          break;
        case 'bool':
          v = v === true || v === 'true' || v === 1 || v === '1';
          break;
        case 'text':
          v = String(v).slice(0, 300);
          break;
        case 'textarea':
          v = String(v).replace(/\r/g, '').slice(0, 6000);
          break;
        case 'device':
          if (v === undefined || v === null || v === '') continue;
          v = String(v).slice(0, 200);
          break;
        case 'bounds': {
          if (v === null) break;
          if (typeof v !== 'object') continue;
          const b = {};
          for (const k of ['x', 'y', 'width', 'height']) {
            const n = Math.round(Number(v[k]));
            if (Number.isFinite(n)) b[k] = k === 'width' || k === 'height' ? Math.max(50, n) : n;
          }
          if (!Object.keys(b).length) continue;
          v = b;
          break;
        }
        default:
          continue;
      }
      out[key] = v;
    }
    return out;
  }

  return { FIELDS, GROUPS, PRESETS, byKey, defaults, sanitize, DEFAULT_FONT, LANG_NAMES, LIVE_PAIRS, targetsFor, coerceTarget };
});
