(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlainText = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  function clean(text) {
    return String(text || '').replace(/<\/?(?:b|i|u|font)(?:\s[^>]*)?>/gi, '').replace(/\{\\[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
  }
  function fromTexts(texts) {
    const lines = texts.map(clean).filter(Boolean);
    return lines.length ? lines.join('\n') + '\n' : '';
  }
  function fromSrt(srt) {
    const texts = [];
    for (const block of String(srt).replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const at = lines.findIndex(l => /^\s*\d+:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d+:\d{2}:\d{2}[,.]\d{3}/.test(l));
      if (at >= 0) texts.push(lines.slice(at + 1).join(' '));
    }
    return fromTexts(texts);
  }
  function fromTsv(text, which = 'source') {
    return fromTexts(String(text).split('\n').filter(Boolean).map(row => row.split('\t')[which === 'target' ? 2 : 1] || ''));
  }
  return { clean, fromTexts, fromSrt, fromTsv };
});
