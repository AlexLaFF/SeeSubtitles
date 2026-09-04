// Dashboard: upload jobs, job list, live sessions.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = (p, opts) => fetch(p, opts).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  const fmtDate = (t) => new Date(t).toLocaleString();
  const alertBox = (msg) => { const a = $('alert'); a.textContent = msg; a.hidden = !msg; };

  $('logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/logout', { method: 'POST' }); location.href = '/login'; });

  let file = null;
  const drop = $('drop');
  drop.addEventListener('click', () => $('file').click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
  $('file').addEventListener('change', () => { if ($('file').files[0]) pick($('file').files[0]); });
  function pick(f) { file = f; drop.textContent = `${f.name} (${fmtBytes(f.size)})`; $('btnUpload').disabled = false; }

  $('btnUpload').addEventListener('click', async () => {
    if (!file) return;
    $('btnUpload').disabled = true;
    alertBox('');
    try {
      const job = await api('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size, sourceLang: $('sourceLang').value, targetLang: $('targetLang').value }) });
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `/api/jobs/${job.id}/upload`);
        $('uploadBar').hidden = false;
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const p = (e.loaded / e.total) * 100; $('uploadBar').firstElementChild.style.width = `${p}%`; $('uploadText').textContent = `uploading ${fmtBytes(e.loaded)} / ${fmtBytes(e.total)}`; } };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`upload failed: ${xhr.status} ${xhr.responseText.slice(0, 200)}`)));
        xhr.onerror = () => reject(new Error('upload failed (network)'));
        xhr.send(file);
      });
      $('uploadText').textContent = 'uploaded — transcription queued';
      $('uploadBar').hidden = true;
      file = null;
      drop.textContent = 'Drop a file here or click to choose';
      loadJobs();
      location.href = `/jobs/${job.id}`;
    } catch (err) {
      alertBox(err.message);
      $('btnUpload').disabled = false;
    }
  });

  async function loadJobs() {
    const jobs = await api('/api/jobs').catch(() => []);
    const tb = $('jobs').querySelector('tbody');
    tb.innerHTML = '';
    if (!jobs.length) tb.appendChild(el('tr', {}, '')).appendChild(el('td', { colspan: 7, class: 'muted' }, 'no jobs yet'));
    for (const j of jobs) {
      const tr = el('tr');
      tr.appendChild(el('td')).appendChild(el('a', { href: `/jobs/${j.id}` }, j.filename));
      tr.appendChild(el('td', {}, `${j.engineLabel || j.source_lang} → ${j.targetLabel || j.target_lang}`));
      const st = el('td');
      st.appendChild(el('span', { class: `pill ${j.status}` }, j.status));
      if (j.error) st.appendChild(el('div', { class: 'muted' }, j.error));
      tr.appendChild(st);
      const bar = el('div', { class: 'bar' });
      bar.appendChild(el('i')).style.width = `${j.status === 'done' ? 100 : j.progress}%`;
      tr.appendChild(el('td')).appendChild(bar);
      tr.appendChild(el('td', {}, j.cues || ''));
      tr.appendChild(el('td', { class: 'muted' }, fmtDate(j.created_at)));
      const ops = el('td');
      if (j.status === 'failed') { const b = el('button', {}, 'Retry'); b.onclick = () => api(`/api/jobs/${j.id}/retry`, { method: 'POST' }).then(loadJobs).catch((e) => alertBox(e.message)); ops.appendChild(b); }
      const d = el('button', { class: 'danger' }, 'Delete');
      d.onclick = () => { if (confirm(`Delete "${j.filename}" and its subtitles?`)) api(`/api/jobs/${j.id}`, { method: 'DELETE' }).then(loadJobs).catch((e) => alertBox(e.message)); };
      ops.appendChild(d);
      tr.appendChild(ops);
      tb.appendChild(tr);
    }
  }

  async function loadSessions() {
    const list = await api('/api/sessions').catch(() => []);
    const tb = $('sessions').querySelector('tbody');
    tb.innerHTML = '';
    if (!list.length) tb.appendChild(el('tr')).appendChild(el('td', { colspan: 5, class: 'muted' }, 'none yet'));
    for (const s of list) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, s.name || s.id));
      tr.appendChild(el('td')).appendChild(el('a', { href: `/d/${s.code}`, target: '_blank' }, `/d/${s.code}`));
      tr.appendChild(el('td', {}, s.lines));
      tr.appendChild(el('td')).appendChild(el('span', { class: `pill ${s.ended_at ? '' : 'live'}` }, s.ended_at ? 'ended' : `live · ${s.viewers} viewer${s.viewers === 1 ? '' : 's'}`));
      tr.appendChild(el('td')).appendChild(el('a', { href: `/api/sessions/${s.id}/transcript` }, 'transcript'));
      tb.appendChild(tr);
    }
  }

  (async () => {
    const me = await api('/api/me').catch(() => null);
    if (!me) { location.href = '/login'; return; }
    $('who').textContent = me.user.email;
    if (!me.creds) alertBox('The server has no Tencent credentials: uploads will fail until TENCENT_* are set in its environment.');
    const langs = await api('/api/languages');
    for (const [k, v] of Object.entries(langs.sources)) $('sourceLang').appendChild(el('option', { value: k }, v));
    for (const [k, v] of Object.entries(langs.targets)) $('targetLang').appendChild(el('option', { value: k }, v));
    $('sourceLang').value = 'yue';
    $('targetLang').value = 'zh';
    loadJobs();
    loadSessions();
    setInterval(() => { loadJobs(); loadSessions(); }, 5000);
  })();
})();
