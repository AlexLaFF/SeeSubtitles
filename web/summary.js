// Renders <base>.summary.md; timestamps like [12:34] link to that moment in the playback page.
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const rec = params.get('rec');
  const doc = document.getElementById('doc');
  if (params.has('print')) document.body.classList.add('print');
  if (!rec) { doc.textContent = 'missing ?rec=<recording>'; return; }
  document.getElementById('playLink').href = `/playback?rec=${encodeURIComponent(rec)}`;

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const toSec = (v) => v.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (m, ts) => `<a class="ts" href="/playback?rec=${encodeURIComponent(rec)}&ts=${toSec(ts)}" target="playback">[${ts}]</a>`);
  }
  function render(md) {
    const lines = md.replace(/<!--[\s\S]*?-->/g, '').split('\n');
    let html = '';
    let list = null; // 'ul' | 'ol'
    let para = [];
    const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const h = /^(#{1,4})\s+(.*)/.exec(line);
      const ul = /^\s*[-*•]\s+(.*)/.exec(line);
      const ol = /^\s*\d+[.、)]\s+(.*)/.exec(line);
      const q = /^>\s?(.*)/.exec(line);
      if (h) { flushPara(); closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; }
      else if (ul || ol) { flushPara(); const kind = ul ? 'ul' : 'ol'; if (list !== kind) { closeList(); list = kind; html += `<${kind}>`; } html += `<li>${inline((ul || ol)[1])}</li>`; }
      else if (q) { flushPara(); closeList(); html += `<blockquote>${inline(q[1])}</blockquote>`; }
      else if (!line.trim()) { flushPara(); closeList(); }
      else para.push(line);
    }
    flushPara(); closeList();
    return html;
  }
  fetch('/api/recordings')
    .then((r) => r.json())
    .then((list) => {
      const entry = list.find((x) => x.base === rec);
      if (!entry || !entry.summary) throw new Error('No summary yet for this recording. Generate one from the control page.');
      document.getElementById('rawLink').href = `/recordings/${encodeURIComponent(entry.summary)}`;
      if (entry.summaryPdf) { const a = document.getElementById('pdfLink'); a.href = `/recordings/${encodeURIComponent(entry.summaryPdf)}`; a.hidden = false; }
      return fetch(`/recordings/${encodeURIComponent(entry.summary)}`);
    })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then((md) => {
      doc.innerHTML = render(md);
      const h1 = doc.querySelector('h1');
      if (h1) document.title = h1.textContent;
      const meta = /generated: (\S+)/.exec(md);
      const foot = document.createElement('div');
      foot.className = 'gen';
      foot.textContent = `录音 ${rec}${meta ? ` · 生成于 ${new Date(meta[1]).toLocaleString('zh-CN')}` : ''} · AI 生成，请结合录音核对`;
      doc.appendChild(foot);
      window.__rendered = true;
    })
    .catch((err) => { doc.innerHTML = `<div class="muted">${esc(err.message)}</div>`; window.__renderError = err.message; window.__rendered = true; });
})();
