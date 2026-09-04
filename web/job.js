// Job page: progress, player with live cue preview, cue editor, exports, MP4 burn-in.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const id = location.pathname.split('/')[2];
  const api = (p, opts) => fetch(p, opts).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const alertBox = (msg) => { const a = $('alert'); a.textContent = msg; a.hidden = !msg; };
  const fmt = (ms) => { const s = Math.max(0, ms) / 1000; const m = Math.floor(s / 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };

  let job = null;
  let cues = [];
  let dirty = false;
  let hasTrans = false;
  let loadedCues = false;

  function renderJob(j) {
    job = j;
    $('title').textContent = j.filename;
    const pct = j.status === 'done' ? 100 : j.progress;
    $('bar').style.width = `${pct}%`;
    const stage = { uploading: 'waiting for upload', queued: 'queued', extracting: 'extracting audio', recognizing: 'recognising speech (Tencent)', segmenting: 'building cues', translating: 'translating', rendering: 'writing subtitle files', done: 'done', failed: 'failed' }[j.status] || j.status;
    $('statusText').textContent = `${stage}${j.status !== 'done' && j.status !== 'failed' ? ` · ${Math.round(pct)}%` : ''}${j.error ? ` — ${j.error}` : ''}${j.duration ? ` · ${(j.duration / 60).toFixed(1)} min` : ''} · ${j.engineLabel || j.source_lang} → ${j.targetLabel || j.target_lang}`;
    $('progressBox').className = `ui ${j.status === 'failed' ? 'bad' : ''}`;
    if (j.status === 'done') {
      $('work').hidden = false;
      if (!loadedCues) { loadedCues = true; loadCues(); }
      renderFiles();
    }
    if (j.render) { $('mp4Text').textContent = `rendering ${j.render.which}… ${j.render.percent}%`; $('btnMp4').disabled = true; } else { $('btnMp4').disabled = false; if (j.renderError) $('mp4Text').textContent = `⚠ ${j.renderError}`; else if (/rendering/.test($('mp4Text').textContent)) $('mp4Text').textContent = 'MP4 ready (see downloads)'; }
  }
  function renderFiles() {
    const box = $('files');
    box.innerHTML = '';
    for (const f of job.files || []) box.appendChild(el('a', { href: `/jobs/${id}/files/${encodeURIComponent(f)}?download` }, f));
    if (!(job.files || []).length) box.appendChild(el('span', { class: 'muted' }, 'none yet'));
  }

  async function loadCues() {
    const data = await api(`/api/jobs/${id}/cues`);
    cues = data.cues || [];
    hasTrans = cues.some((c) => c.trans);
    renderCues();
    const v = $('video');
    v.src = `/jobs/${id}/files/source`;
  }

  function renderCues() {
    const box = $('cues');
    box.innerHTML = '';
    cues.forEach((c, i) => {
      const row = el('div', { class: 'cue', 'data-i': i });
      const t = el('div', { class: 't' }, `${fmt(c.start)}\n${fmt(c.end)}`);
      t.style.whiteSpace = 'pre';
      t.title = 'click to seek';
      t.onclick = () => { $('video').currentTime = c.start / 1000; $('video').play().catch(() => {}); };
      row.appendChild(t);
      const texts = el('div');
      if (hasTrans) { const ta = el('textarea', { class: 'trans', rows: 1 }); ta.value = c.trans || ''; ta.oninput = () => { c.trans = ta.value; markDirty(); }; texts.appendChild(ta); }
      const orig = el('textarea', { class: hasTrans ? 'orig' : 'trans', rows: 1 }); orig.value = c.text || ''; orig.oninput = () => { c.text = orig.value; markDirty(); }; texts.appendChild(orig);
      row.appendChild(texts);
      const ops = el('div', { class: 'ops' });
      const mk = (label, title, fn) => { const b = el('button', { title }, label); b.onclick = fn; ops.appendChild(b); };
      mk('−.1', 'start 100 ms earlier', () => { c.start = Math.max(0, c.start - 100); if (i > 0) c.start = Math.max(c.start, cues[i - 1].end); markDirty(true); });
      mk('+.1', 'start 100 ms later', () => { c.start = Math.min(c.end - 200, c.start + 100); markDirty(true); });
      mk('⤵', 'merge with next cue', () => { const n = cues[i + 1]; if (!n) return; c.end = n.end; c.text = `${c.text} ${n.text}`.trim(); c.trans = `${c.trans || ''} ${n.trans || ''}`.trim(); cues.splice(i + 1, 1); markDirty(true); });
      mk('✕', 'delete cue', () => { cues.splice(i, 1); markDirty(true); });
      row.appendChild(ops);
      box.appendChild(row);
    });
  }
  function markDirty(rerender) {
    dirty = true;
    $('btnSave').disabled = false;
    $('saveText').textContent = 'unsaved changes';
    if (rerender) renderCues();
  }
  $('btnSave').onclick = async () => {
    $('btnSave').disabled = true;
    $('saveText').textContent = 'saving…';
    try {
      const data = await api(`/api/jobs/${id}/cues`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cues }) });
      cues = data.cues;
      dirty = false;
      $('saveText').textContent = 'saved — subtitle files regenerated';
      renderCues();
      renderJob(await api(`/api/jobs/${id}`));
    } catch (err) { $('saveText').textContent = ''; $('btnSave').disabled = false; alertBox(err.message); }
  };
  $('btnShift').onclick = () => {
    const v = prompt('Shift every cue by how many milliseconds? (negative = earlier)', '0');
    const ms = Number(v);
    if (!v || !Number.isFinite(ms) || !ms) return;
    for (const c of cues) { c.start = Math.max(0, c.start + ms); c.end = Math.max(c.start + 200, c.end + ms); }
    markDirty(true);
  };
  $('btnMp4').onclick = async () => {
    if (dirty && !confirm('You have unsaved cue edits; render with the last saved version?')) return;
    $('btnMp4').disabled = true;
    $('mp4Text').textContent = 'rendering… 0%';
    try { await api(`/api/jobs/${id}/mp4`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ which: $('mp4which').value }) }); } catch (err) { $('mp4Text').textContent = `⚠ ${err.message}`; $('btnMp4').disabled = false; }
  };

  // live preview under the player
  let activeIdx = -1;
  function tick() {
    const v = $('video');
    if (!v.src || !cues.length) return requestAnimationFrame(tick);
    const t = v.currentTime * 1000;
    let idx = cues.findIndex((c) => t >= c.start && t < c.end);
    if (idx !== activeIdx) {
      activeIdx = idx;
      const c = cues[idx];
      const box = $('subs');
      box.innerHTML = '';
      if (c) { box.appendChild(el('div', {}, hasTrans ? c.trans || c.text : c.text)); if (hasTrans) box.appendChild(el('div', { class: 's' }, c.text)); }
      for (const r of $('cues').children) r.classList.toggle('active', Number(r.dataset.i) === idx);
      const row = $('cues').querySelector(`.cue[data-i="${idx}"]`);
      if (row && !v.paused) row.scrollIntoView({ block: 'nearest' });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  (async () => {
    const me = await api('/api/me').catch(() => null);
    if (!me) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
    $('who').textContent = me.user.email;
    try { renderJob(await api(`/api/jobs/${id}`)); } catch (err) { alertBox(err.message); return; }
    const es = new EventSource(`/api/jobs/${id}/stream`);
    es.addEventListener('job', (e) => renderJob(JSON.parse(e.data)));
  })();
})();
