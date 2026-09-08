(function () {
  'use strict';
  function save(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function read(url) { const r = await fetch(url); if (!r.ok) throw new Error(`Download failed (${r.status})`); return r.text(); }
  window.CleanDownloads = {
    async recording(recording, language) {
      try { const name = recording[language]; save(PlainText.fromSrt(await read('/recordings/' + encodeURIComponent(name))), name.replace(/\.srt$/i, '.plain.txt')); }
      catch (err) { alert(err.message); }
    },
    async live(which) {
      try { save(PlainText.fromTsv(await read('/api/transcript'), which), `transcript-${which}.plain.txt`); }
      catch (err) { alert(err.message); }
    },
  };
})();
