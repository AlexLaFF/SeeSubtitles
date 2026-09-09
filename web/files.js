// Files view: recordings from Live and files added for subtitling, in one list; each opens to a page with
// playback, editable subtitles, the files, and the actions (re-subtitle, MP4, AI summary, download).
(function () {
  'use strict';
  const el = Controls.el;
  const $ = (id) => document.getElementById(id);
  const view = { get title() { return t('files.title'); } };
  let mounted = null; // 'list' | 'detail'
  let filter = 'all';
  let search = '';
  let recordings = [];
  let jobs = [];
  let pollTimer = null;
  let listKey = '';
  const selected = new Set(); // recording bases ticked in the list

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const fmtDate = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  async function loadRecordings() { recordings = await fetch('/api/recordings').then((r) => r.json()).catch(() => []); }
  async function loadJobs() { jobs = await fetch('/api/cloud/jobs').then((r) => r.json()).then((j) => (Array.isArray(j) ? j : [])).catch(() => []); }

  view.render = function (root, params) {
    Controls.reset();
    if (params && params.base) return renderDetail(root, params.base);
    return renderList(root);
  };
  view.leave = () => { mounted = null; clearInterval(pollTimer); pollTimer = null; if (view.audio) { view.audio.pause(); view.audio = null; } };
  view.update = () => {
    if (mounted === 'list') {
      const s = Sub.status || {};
      const key = JSON.stringify([s.mp4, s.summary, s.resubtitle, s.uploads, s.recorder && s.recorder.recording, s.cloud && s.cloud.loggedIn]);
      if (key !== listKey) { listKey = key; loadRecordings().then(renderRows); }
    } else if (mounted === 'detail' && view.updateDetail) view.updateDetail();
  };

  // ------------------------------------------------------------------ list
  function renderList(root) {
    mounted = 'list';
    root.innerHTML = `
      <div class="top"><h1>${t('files.title')}</h1><span class="muted">${t('files.subtitle')}</span><div class="grow"></div>
        <button id="btnFolder">${t('files.openFolder')}</button><button id="btnAdd" class="primary">${t('files.add')}</button></div>
      <div class="toolbar"><div class="pills" id="filters"></div><div id="bulk" class="btns" style="margin:0" hidden></div><div class="grow"></div><input type="text" id="search" placeholder="${t('files.search')}" style="width:220px"></div>
      <div class="body" style="flex-direction:column;overflow:auto">
        <div class="ui" style="padding:0;overflow:hidden"><table><thead><tr><th style="width:28px"><input type="checkbox" id="selAll" title="${t('files.selectAll')}"></th><th style="width:32%">${t('files.col.name')}</th><th>${t('files.col.date')}</th><th>${t('files.col.length')}</th><th>${t('files.col.subtitles')}</th><th>${t('files.col.mp4')}</th><th>${t('files.col.summary')}</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
        <div class="drop" id="drop">${t('files.drop')}</div>
      </div>`;
    for (const [k, label] of [['all', t('files.filter.all')], ['rec', t('files.filter.rec')], ['added', t('files.filter.added')]]) {
      const b = el('button', { class: `pill${filter === k ? ' on' : ''}`, 'data-f': k }, label);
      b.addEventListener('click', () => { filter = k; for (const x of $('filters').children) x.classList.toggle('on', x.dataset.f === k); renderRows(); });
      $('filters').appendChild(b);
    }
    $('search').value = search;
    $('selAll').addEventListener('change', () => { const visible = visibleRecordings(); if ($('selAll').checked) for (const b of visible) selected.add(b); else for (const b of visible) selected.delete(b); renderRows(); });
    $('search').addEventListener('input', () => { search = $('search').value.trim().toLowerCase(); renderRows(); });
    $('btnFolder').addEventListener('click', () => Sub.post('/api/recordings/open-folder'));
    $('btnAdd').addEventListener('click', addFile);
    const drop = $('drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const d = App.desktop(); const f = e.dataTransfer.files[0]; if (!f) return; const p = d && d.pathForFile ? d.pathForFile(f) : null; if (p) addPath(p); else alert(t('files.useAdd')); });
    Promise.all([loadRecordings(), loadJobs()]).then(renderRows);
    pollTimer = setInterval(() => { if (mounted === 'list') loadJobs().then(renderRows); }, 5000);
  }

  async function addFile() {
    const d = App.desktop();
    if (!d || !d.chooseFile) return alert(t('files.addNeedsApp'));
    const p = await d.chooseFile();
    if (p) addPath(p);
  }
  function addPath(p) { Sub.post('/api/files/add', { path: p }).then((r) => { if (r && r.error) alert(I18n.err(r)); else loadJobs().then(renderRows); }); }

  function renderRows() {
    const tb = $('rows'); if (!tb) return;
    const s = Sub.status || {};
    const rs = s.resubtitle || {}; const mp = s.mp4 || {}; const sm = s.summary || {}; const up = s.uploads || {};
    const items = [];
    for (const r of recordings) items.push({ kind: 'rec', name: r.base, sub: t('files.recordingSub', { langs: r.style === 'legacy' ? t('files.legacy') : '粤语 → 中文' }), date: r.mtime, length: r.durationMs, rec: r });
    for (const j of jobs) items.push({ kind: 'added', name: j.filename, sub: t('files.addedSub', { langs: `${j.engineLabel || j.source_lang} → ${j.targetLabel || j.target_lang}` }), date: j.created_at, length: j.duration ? j.duration * 1000 : null, job: j });
    if (up.current) items.push({ kind: 'added', name: up.current.name, sub: t('files.uploading'), date: up.current.startedAt, upload: up.current });
    for (const q of up.queue || []) items.push({ kind: 'added', name: q, sub: t('files.waiting'), date: Date.now(), queued: true });
    const shown = items.filter((it) => (filter === 'all' || it.kind === filter) && (!search || it.name.toLowerCase().includes(search))).sort((a, b) => (b.date || 0) - (a.date || 0));
    renderRows.visible = shown.filter((it) => it.rec).map((it) => it.rec.base);
    for (const b of [...selected]) if (!recordings.some((r) => r.base === b)) selected.delete(b);
    renderBulk();
    tb.innerHTML = '';
    if (!shown.length) { tb.appendChild(el('tr')).appendChild(el('td', { colspan: 8, class: 'empty' }, recordings.length || jobs.length ? t('files.noMatch') : t('files.empty'))); return; }
    for (const it of shown) {
      const tr = el('tr', { class: 'row-click' });
      const sel = tr.appendChild(el('td'));
      if (it.rec) { const cb = el('input', { type: 'checkbox' }); cb.checked = selected.has(it.rec.base); cb.addEventListener('click', (e) => e.stopPropagation()); cb.addEventListener('change', () => { if (cb.checked) selected.add(it.rec.base); else selected.delete(it.rec.base); renderBulk(); }); sel.appendChild(cb); }
      const name = tr.appendChild(el('td'));
      name.appendChild(el('div', {}, it.name)); name.appendChild(el('div', { class: 'muted', style: 'font-size:11px' }, it.sub));
      tr.appendChild(el('td', {}, it.date ? fmtDate(it.date) : '–'));
      tr.appendChild(el('td', {}, it.length ? Sub.fmtClock(it.length) : '–'));
      const subs = tr.appendChild(el('td'));
      if (it.rec) {
        const r = it.rec;
        if (rs.current && rs.current.base === r.base) { subs.appendChild(el('span', { class: 'tag busy' }, t('files.tag.resub', { stage: stageName(rs.current.stage) }))); subs.appendChild(progress(rs.current.percent)); }
        else if ((rs.queue || []).includes(r.base)) subs.appendChild(el('span', { class: 'tag busy' }, t('files.tag.queued')));
        else if (r.resubtitled) subs.appendChild(el('span', { class: 'tag done' }, t('files.tag.complete')));
        else if (r.zh || r.yue) { subs.appendChild(el('span', { class: 'tag live' }, t('files.tag.live'))); subs.appendChild(el('span', { class: 'muted', style: 'font-size:11px;margin-left:6px' }, t('files.fromTalk'))); }
        else subs.appendChild(el('span', { class: 'muted' }, t('files.tag.none')));
        if (rs.last && rs.last.base === r.base && !rs.last.ok) subs.appendChild(el('div', { class: 'muted', style: 'font-size:11px;color:#ff6b6b' }, rs.last.error));
        const mp4 = tr.appendChild(el('td'));
        if (r.mp4) mp4.textContent = '✓';
        else if (mp.current && mp.current.base === r.base) { mp4.appendChild(el('span', { class: 'tag busy' }, `${mp.current.percent}%`)); }
        else if ((mp.queue || []).includes(r.base)) mp4.appendChild(el('span', { class: 'tag busy' }, t('files.tag.queued')));
        else mp4.textContent = '—';
        const sum = tr.appendChild(el('td'));
        if (sm.current && sm.current.base === r.base) sum.appendChild(el('span', { class: 'tag busy' }, stageName(sm.current.stage)));
        else sum.textContent = r.summary ? '✓' : '—';
        const act = tr.appendChild(el('td'));
        const acts = el('div', { class: 'btns', style: 'margin:0;flex-wrap:nowrap;justify-content:flex-end' });
        const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };
        const open = el('button', { class: 'small' }, t('files.open')); open.addEventListener('click', stop(() => App.go('files', { base: r.base })));
        const dl = el('button', { class: 'small' }, t('files.download')); dl.addEventListener('click', stop(() => downloadMenu(dl, r)));
        const sumBusy = (sm.current && sm.current.base === r.base) || (sm.queue || []).includes(r.base);
        const sb = el('button', { class: 'small' }, r.summary ? t('files.viewSummary') : t('files.aiSummary'));
        sb.disabled = sumBusy || !(r.zh || r.yue);
        sb.addEventListener('click', stop(() => (r.summary ? App.go('files', { base: r.base, tab: 'summary' }) : generateSummary(r))));
        const more = el('button', { class: 'small' }, t('files.more')); more.addEventListener('click', stop(() => moreMenu(more, r)));
        acts.append(open, dl, sb, more);
        act.appendChild(acts);
        tr.addEventListener('click', () => App.go('files', { base: r.base }));
      } else if (it.job) {
        const j = it.job;
        if (j.status === 'done') subs.appendChild(el('span', { class: 'tag done' }, t('files.tag.cues', { n: j.cues })));
        else if (j.status === 'failed') subs.appendChild(el('span', { class: 'tag bad', title: j.error || '' }, t('files.tag.failed')));
        else { subs.appendChild(el('span', { class: 'tag busy' }, stageName(j.status))); subs.appendChild(progress(j.progress)); }
        tr.appendChild(el('td', {}, (j.files || []).some((f) => f.endsWith('.mp4')) ? '✓' : '—'));
        tr.appendChild(el('td', {}, '—'));
        const act = tr.appendChild(el('td')); act.appendChild(el('button', { class: 'small' }, t('files.openWeb')));
        tr.addEventListener('click', () => { const c = Sub.status.cloud; if (c && c.url) App.openExternal(`${c.url}/jobs/${j.id}`); });
      } else {
        subs.appendChild(el('span', { class: 'tag busy' }, it.queued ? t('files.tag.queued') : t('files.tag.uploading', { pct: it.upload.percent })));
        tr.appendChild(el('td', {}, '—')); tr.appendChild(el('td', {}, '—')); tr.appendChild(el('td'));
      }
      tb.appendChild(tr);
    }
  }
  const visibleRecordings = () => renderRows.visible || [];
  /** The bar of actions on the ticked recordings. */
  function renderBulk() {
    const bar = $('bulk'); if (!bar) return;
    const all = $('selAll'); if (all) { const vis = visibleRecordings(); all.checked = vis.length > 0 && vis.every((b) => selected.has(b)); all.indeterminate = !all.checked && vis.some((b) => selected.has(b)); }
    bar.hidden = selected.size === 0;
    bar.innerHTML = '';
    if (!selected.size) return;
    const picked = () => recordings.filter((r) => selected.has(r.base));
    bar.appendChild(el('span', { class: 'muted', style: 'margin-right:4px' }, t('files.selected', { n: selected.size })));
    const b = (label, cls, fn) => { const x = el('button', { class: `small ${cls || ''}` }, label); x.addEventListener('click', fn); bar.appendChild(x); return x; };
    b(t('files.bulkSummaries'), '', async () => { const rs = picked().filter((r) => r.zh || r.yue); const have = rs.filter((r) => r.summary).length; if (have && !confirm(t('files.bulkRegen', { n: have }))) return; for (const r of rs) await post('/api/recordings/summary', { base: r.base }); });
    b(t('files.bulkMp4'), '', async () => { for (const r of picked().filter((r) => r.zh || r.yue)) await post('/api/recordings/mp4', { base: r.base }); });
    b(t('files.bulkResub'), '', async () => { const c = Sub.status.cloud; if (!c || !c.loggedIn) return alert(t('files.loginFirst')); const rs = picked(); if (!confirm(t('files.bulkResubConfirm', { n: rs.length }))) return; for (const r of rs) await post('/api/recordings/resubtitle', { base: r.base }); });
    const dl = b(t('files.download'), '', () => App.menu(dl, ['all', 'audio', 'subtitles', 'plain', 'mp4', 'summary'].map((k) => ({ label: t(`files.dlKind.${k}`), onClick: () => downloadArchive([...selected], k) }))));
    b(t('files.bulkDelete'), 'danger', async () => {
      const rs = picked(); if (!rs.length || !confirm(t('files.deleteConfirm', { n: rs.length }))) return;
      const r = await post('/api/recordings/delete', { bases: rs.map((x) => x.base) });
      if (r && !r.error) { selected.clear(); await loadRecordings(); renderRows(); }
    });
    b(t('files.clearSel'), 'ghost', () => { selected.clear(); renderRows(); });
  }
  function downloadArchive(bases, kind) {
    const a = el('a', { href: `/api/recordings/archive?bases=${encodeURIComponent(bases.join(','))}&kinds=${kind}`, download: '' });
    document.body.appendChild(a); a.click(); a.remove();
  }
  const stageName = (st) => (I18n.has(`status.${st}`) ? t(`status.${st}`) : st);
  const post = (path, body) => Sub.post(path, body).then((x) => { if (x && x.error) alert(I18n.err(x)); return x; });
  /** Download menu for a recording (list rows and the recording page share it). */
  function downloadMenu(anchor, rr) {
    const items = [];
    const link = (name, label) => items.push({ label, href: `/recordings/${encodeURIComponent(name)}`, download: name });
    link(rr.mp3, t('files.dl.audio'));
    if (rr.zh) link(rr.zh, t('files.dl.zh'));
    if (rr.yue) link(rr.yue, t('files.dl.yue'));
    if (rr.zh) items.push({ label: t('files.dl.plainZh'), onClick: () => CleanDownloads.recording(rr, 'zh') });
    if (rr.yue) items.push({ label: t('files.dl.plainYue'), onClick: () => CleanDownloads.recording(rr, 'yue') });
    if (rr.mp4) link(rr.mp4, t('files.dl.mp4', { size: Sub.fmtBytes(rr.mp4Bytes) }));
    if (rr.summary) link(rr.summary, t('files.dl.md'));
    if (rr.summaryPdf) link(rr.summaryPdf, t('files.dl.pdf'));
    else if (rr.summary) items.push({ label: t('files.makePdf'), onClick: () => post('/api/recordings/summary-pdf', { base: rr.base }) });
    App.menu(anchor, items);
  }
  function generateSummary(rr) {
    if (rr.summary && !confirm(t('files.confirmRegen'))) return;
    post('/api/recordings/summary', { base: rr.base });
  }
  function resubtitle(rr) {
    const c = Sub.status.cloud; if (!c || !c.loggedIn) return alert(t('files.loginFirst'));
    if ((rr.zh || rr.yue) && !confirm(t('files.confirmResub'))) return;
    post('/api/recordings/resubtitle', { base: rr.base });
  }
  /** "More ▾" menu of a recording: re-subtitle, MP4. */
  function moreMenu(anchor, rr) {
    const s = Sub.status || {}; const rs = s.resubtitle || {}; const mp = s.mp4 || {};
    const busyResub = (rs.current && rs.current.base === rr.base) || (rs.queue || []).includes(rr.base);
    const busyMp4 = (mp.current && mp.current.base === rr.base) || (mp.queue || []).includes(rr.base);
    const items = [];
    if (!busyResub) items.push({ label: t('files.resub'), onClick: () => resubtitle(rr) });
    if (!busyMp4 && (rr.zh || rr.yue)) items.push({ label: rr.mp4 ? t('files.remakeMp4') : t('files.makeMp4'), onClick: () => post('/api/recordings/mp4', { base: rr.base }) });
    if (!items.length) items.push({ label: t('files.busy'), onClick: () => {} });
    App.menu(anchor, items);
  }
  const progress = (pct) => { const p = el('span', { class: 'progress', style: 'margin-left:6px' }); p.appendChild(el('i', { style: `width:${Math.round(pct || 0)}%` })); return p; };

  // ------------------------------------------------------------------ detail (one recording)
  async function renderDetail(root, base) {
    mounted = 'detail';
    root.innerHTML = `
      <div class="top"><button class="ghost" id="btnBack">${t('files.back')}</button><h1 id="dTitle"></h1><span id="dChip" class="chip"></span><div class="grow"></div>
        <button id="btnResub">${t('files.resub')}</button><button id="btnMp4">${t('files.makeMp4')}</button><button id="btnSummary">${t('files.aiSummary')}</button><button id="btnDownload" class="primary">${t('files.download')}</button></div>
      <div class="body">
        <div class="col" style="width:620px;flex:none;overflow:auto">
          <div class="ui" style="padding:10px"><div class="stage-p" id="pstage"></div><audio id="audio" controls preload="metadata" style="width:100%;margin-top:8px"></audio>
            <div class="row wide" style="margin-top:4px"><label>${t('files.showOriginal')}</label><input type="checkbox" id="showSrc"></div></div>
          <div class="ui"><h3>${t('files.filesHeading')}</h3><div id="dFiles" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px"></div></div>
        </div>
        <div class="col" style="flex:1;min-height:0">
          <div class="ui" style="flex:1;display:flex;flex-direction:column;min-height:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div class="pills"><button class="pill on" id="tabSubs">${t('files.tab.subtitles')}</button><button class="pill" id="tabSum">${t('files.tab.summary')}</button></div><div class="grow"></div><span class="muted" id="dHint">${t('files.editHint')}</span></div>
            <div class="cues" id="cues"></div>
            <div id="sumBox" hidden style="flex:1;min-height:0"></div>
            <div id="cueBar" style="display:flex;gap:8px;align-items:center;padding-top:10px;border-top:1px solid #2a2a2d"><button id="btnSave" class="primary" disabled>${t('files.save')}</button><button id="btnShift">${t('files.shiftAll')}</button><span class="muted" id="editCount"></span></div>
          </div>
        </div>
      </div>`;
    $('dTitle').textContent = base;
    $('btnBack').addEventListener('click', () => App.go('files'));
    await loadRecordings();
    const r = recordings.find((x) => x.base === base);
    if (!r) { root.querySelector('.body').innerHTML = `<div class="empty">${t('files.gone')}</div>`; return; }
    const audio = $('audio'); view.audio = audio;
    audio.src = `/recordings/${encodeURIComponent(r.mp3)}`;
    const data = await fetch(`/api/recordings/cues?base=${encodeURIComponent(base)}`).then((x) => x.json()).catch(() => ({ cues: [] }));
    let cues = data.cues || [];
    let dirty = 0;
    const stage = $('pstage');
    const applyLook = () => { Sub.applyCss(Sub.settings); stage.style.fontFamily = Sub.settings.fontFamily || ''; stage.style.color = Sub.settings.fontColor || '#fff'; stage.style.textAlign = Sub.settings.align || 'center'; };
    applyLook();
    let shown = -1; let current = null;
    function sync(force) {
      const now = audio.currentTime * 1000;
      let n = 0; while (n < cues.length && cues[n].start <= now) n++;
      const cur = n > 0 && cues[n - 1].end >= now ? n - 1 : null;
      if (n !== shown || force) {
        shown = n; stage.innerHTML = '';
        for (let i = Math.max(0, n - 6); i < n; i++) {
          const l = el('div', { class: `l${i === n - 1 ? '' : ' old'}` }, cues[i].zh || cues[i].yue);
          if ($('showSrc').checked && cues[i].yue && cues[i].zh) l.appendChild(el('span', { class: 's' }, cues[i].yue));
          stage.appendChild(l);
        }
      }
      if (cur !== current || force) { current = cur; for (const c of $('cues').children) c.classList.toggle('active', Number(c.dataset.i) === cur); const a = $('cues').querySelector('.active'); if (a && !dirty) a.scrollIntoView({ block: 'nearest' }); }
    }
    let raf = 0; const tick = () => { if (mounted !== 'detail') return; sync(false); raf = requestAnimationFrame(tick); }; tick();
    $('showSrc').addEventListener('change', () => sync(true));
    Sub.on('settings', applyLook);

    function renderCues() {
      const box = $('cues'); box.innerHTML = '';
      if (!cues.length) { box.appendChild(el('div', { class: 'empty' }, t('files.noCues'))); return; }
      cues.forEach((c, i) => {
        const row = el('div', { class: 'cue', 'data-i': i });
        const tc = el('div', { class: 't' }, `${Sub.fmtClock(c.start)}\n${Sub.fmtClock(c.end)}`); tc.style.whiteSpace = 'pre';
        tc.addEventListener('click', () => { audio.currentTime = c.start / 1000; audio.play().catch(() => {}); });
        const texts = el('div');
        const zh = el('textarea', { rows: 1 }); zh.value = c.zh || ''; zh.addEventListener('input', () => { c.zh = zh.value; markDirty(); });
        const yue = el('textarea', { rows: 1, class: 'orig', placeholder: t('web.original') }); yue.value = c.yue || ''; yue.addEventListener('input', () => { c.yue = yue.value; markDirty(); });
        texts.append(zh, yue);
        const ops = el('div', { class: 'ops' });
        const merge = el('button', { title: t('files.mergeTitle') }, t('files.merge')); merge.disabled = i === cues.length - 1;
        merge.addEventListener('click', () => { const n = cues[i + 1]; c.end = n.end; c.zh = [c.zh, n.zh].filter(Boolean).join(''); c.yue = [c.yue, n.yue].filter(Boolean).join(''); cues.splice(i + 1, 1); markDirty(); renderCues(); });
        const del = el('button', {}, t('files.delete')); del.addEventListener('click', () => { cues.splice(i, 1); markDirty(); renderCues(); });
        ops.append(merge, del);
        row.append(tc, texts, ops);
        box.appendChild(row);
      });
      for (const ta of box.querySelectorAll('textarea')) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; }
    }
    function markDirty() { dirty++; $('btnSave').disabled = false; $('editCount').textContent = t('files.changes', { n: dirty }); }
    renderCues();
    $('btnSave').addEventListener('click', async () => {
      const r2 = await Sub.post('/api/recordings/cues', { base, cues });
      if (r2 && r2.error) return alert(I18n.err(r2));
      dirty = 0; $('btnSave').disabled = true; $('editCount').textContent = t('files.saved'); sync(true);
    });
    $('btnShift').addEventListener('click', () => { const v = prompt(t('files.shiftPrompt'), '0'); const ms = Number(v); if (!v || !Number.isFinite(ms) || !ms) return; for (const c of cues) { c.start = Math.max(0, c.start + ms); c.end = Math.max(c.start + 200, c.end + ms); } markDirty(); renderCues(); });
    $('tabSubs').addEventListener('click', () => { $('tabSubs').classList.add('on'); $('tabSum').classList.remove('on'); $('cues').hidden = false; $('cueBar').hidden = false; $('sumBox').hidden = true; $('dHint').hidden = false; });
    $('tabSum').addEventListener('click', () => { $('tabSum').classList.add('on'); $('tabSubs').classList.remove('on'); $('cues').hidden = true; $('cueBar').hidden = true; $('sumBox').hidden = false; $('dHint').hidden = true; renderSummary(); });
    function renderSummary() {
      const box = $('sumBox'); box.innerHTML = '';
      const rr = recordings.find((x) => x.base === base) || r;
      if (rr.summary) { const f = el('iframe', { src: `/summary?rec=${encodeURIComponent(base)}`, style: 'width:100%;height:100%;border:0;border-radius:8px;background:#111' }); box.appendChild(f); }
      else box.appendChild(el('div', { class: 'empty' }, t('files.noSummary')));
    }
    const rec = () => recordings.find((x) => x.base === base) || r;
    $('btnResub').addEventListener('click', () => resubtitle(rec()));
    $('btnMp4').addEventListener('click', () => post('/api/recordings/mp4', { base }));
    $('btnSummary').addEventListener('click', () => { const rr = rec(); if (rr.summary && !confirm(t('files.confirmRegen'))) return; post('/api/recordings/summary', { base }).then((x) => { if (x && !x.error) $('tabSum').click(); }); });
    $('btnDownload').addEventListener('click', () => downloadMenu($('btnDownload'), rec()));
    if (App.params.tab === 'summary') $('tabSum').click();

    view.updateDetail = async () => {
      const s = Sub.status || {};
      const rs = s.resubtitle || {}; const mp = s.mp4 || {}; const sm = s.summary || {};
      const key = JSON.stringify([rs.current && rs.current.base === base ? rs.current : null, rs.last && rs.last.base === base ? rs.last.at : null, mp.current && mp.current.base === base ? mp.current.percent : null, sm.current && sm.current.base === base ? sm.current.stage : null]);
      const busy = (rs.current && rs.current.base === base) ? t('files.chip.busyResub', { stage: stageName(rs.current.stage), pct: rs.current.percent }) : (mp.current && mp.current.base === base) ? t('files.chip.busyMp4', { stage: stageName(mp.current.stage), pct: mp.current.percent }) : (sm.current && sm.current.base === base) ? t('files.chip.busySummary', { stage: stageName(sm.current.stage) }) : '';
      $('btnResub').disabled = !!(rs.current && rs.current.base === base) || !(s.cloud && s.cloud.loggedIn);
      $('btnMp4').disabled = !!(mp.current && mp.current.base === base) || !cues.length;
      $('btnSummary').disabled = !!(sm.current && sm.current.base === base) || !cues.length;
      if (key === view.detailKey && $('dChip').dataset.done) return;
      const changed = view.detailKey && key !== view.detailKey && !busy; // something finished: reload files/cues
      view.detailKey = key;
      if (changed) { await loadRecordings(); const rr = recordings.find((x) => x.base === base); if (rr) { const d2 = await fetch(`/api/recordings/cues?base=${encodeURIComponent(base)}`).then((x) => x.json()).catch(() => null); if (d2 && !dirty) { cues = d2.cues || []; renderCues(); sync(true); } } }
      const rr = recordings.find((x) => x.base === base) || r;
      const chip = $('dChip'); chip.className = `chip ${busy ? 'warn' : rr.resubtitled ? 'ok' : ''}`;
      chip.textContent = busy || (rr.resubtitled ? t('files.chip.complete') : (rr.zh || rr.yue) ? t('files.chip.live') : t('files.chip.none')) + (rr.durationMs ? ` · ${Sub.fmtClock(rr.durationMs)}` : '');
      chip.dataset.done = '1';
      const files = $('dFiles'); files.innerHTML = '';
      const f = (name, extra) => { const d = el('div'); const a = el('a', { href: `/recordings/${encodeURIComponent(name)}`, download: name }, name); d.appendChild(a); if (extra) d.appendChild(el('span', { class: 'muted' }, ` · ${extra}`)); files.appendChild(d); };
      f(rr.mp3, Sub.fmtBytes(rr.bytes)); if (rr.mp4) f(rr.mp4, Sub.fmtBytes(rr.mp4Bytes));
      if (rr.zh) f(rr.zh); if (rr.yue) f(rr.yue);
      for (const b of rr.backups || []) f(b, t('files.fromTalk'));
      if (rr.summary) f(rr.summary); if (rr.summaryPdf) f(rr.summaryPdf);
    };
    view.detailKey = '';
    view.updateDetail();
  }

  App.register('files', view);
})();
