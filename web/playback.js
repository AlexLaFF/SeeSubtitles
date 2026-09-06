// Playback page: plays a recording and scrolls its SRT cues in the live-display style, in sync.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const linesEl = $('lines');
  const cuesEl = $('cues');
  let cues = []; // { start, end, zh, yue }
  let shown = -1; // number of cues currently rendered
  let current = null;

  function parseSrt(text) {
    const out = [];
    for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
      const lines = block.split('\n').filter(Boolean);
      if (lines.length < 2) continue;
      const m = /(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/.exec(lines[1] || lines[0]);
      if (!m) continue;
      const t = (h, mi, s, ms) => ((+h * 60 + +mi) * 60 + +s) * 1000 + +ms;
      const textIdx = /-->/.test(lines[1]) ? 2 : 1;
      out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: lines.slice(textIdx).join('\n') });
    }
    return out;
  }

  async function loadRecording(r) {
    cues = [];
    shown = -1;
    linesEl.innerHTML = '';
    cuesEl.innerHTML = '';
    audio.src = `/recordings/${encodeURIComponent(r.mp3)}`;
    const [zh, yue] = await Promise.all([
      r.zh ? fetch(`/recordings/${encodeURIComponent(r.zh)}`).then((x) => x.text()).then(parseSrt) : [],
      r.yue ? fetch(`/recordings/${encodeURIComponent(r.yue)}`).then((x) => x.text()).then(parseSrt) : [],
    ]);
    // pair Cantonese cues with Mandarin ones by start time (they are written together)
    cues = zh.map((c) => ({ ...c, zh: c.text, yue: (yue.find((y) => Math.abs(y.start - c.start) < 50) || {}).text || '' }));
    if (!zh.length && yue.length) cues = yue.map((c) => ({ ...c, zh: '', yue: c.text }));
    $('info').textContent = `${r.base} · ${Sub.fmtBytes(r.bytes)} · ${cues.length} cues${r.mp4 ? ' · ' : ''}`;
    if (r.mp4) { const a = document.createElement('a'); a.href = `/recordings/${encodeURIComponent(r.mp4)}`; a.download = r.mp4; a.textContent = 'download mp4'; $('info').appendChild(a); }
    if (r.summary) { $('info').appendChild(document.createTextNode(' · ')); const a = document.createElement('a'); a.href = `/summary?rec=${encodeURIComponent(r.base)}`; a.target = '_blank'; a.textContent = '📘 AI summary'; $('info').appendChild(a); }
    const seek = Number(new URLSearchParams(location.search).get('t'));
    if (seek > 0) { const jump = () => { audio.currentTime = seek; sync(true); }; if (audio.readyState >= 1) jump(); else audio.addEventListener('loadedmetadata', jump, { once: true }); }
    for (const [i, c] of cues.entries()) {
      const p = document.createElement('div');
      p.className = 'p cue';
      p.dataset.i = i;
      p.innerHTML = `<div class="s">${Sub.fmtClock(c.start)}</div><div>${escape(c.zh || c.yue)}</div>`;
      p.addEventListener('click', () => { audio.currentTime = c.start / 1000; audio.play().catch(() => {}); });
      cuesEl.appendChild(p);
    }
    sync(true);
  }
  const escape = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

  function sync(force) {
    const t = audio.currentTime * 1000;
    let n = 0;
    while (n < cues.length && cues[n].start <= t) n++;
    const cur = n > 0 && cues[n - 1].end >= t ? n - 1 : null;
    if (n !== shown || force) {
      shown = n;
      linesEl.innerHTML = '';
      const showSrc = $('showSrc').checked;
      for (let i = Math.max(0, n - 40); i < n; i++) {
        const el = document.createElement('div');
        el.className = 'line';
        el.dataset.i = i;
        const main = document.createElement('span');
        main.className = 'main';
        main.textContent = cues[i].zh || cues[i].yue;
        el.appendChild(main);
        if (showSrc && cues[i].yue && cues[i].zh) {
          const sub = document.createElement('span');
          sub.className = 'sub';
          sub.textContent = cues[i].yue;
          el.appendChild(sub);
        }
        linesEl.appendChild(el);
      }
    }
    if (cur !== current || force) {
      current = cur;
      for (const el of linesEl.children) el.classList.toggle('partial', Number(el.dataset.i) !== cur);
      for (const el of cuesEl.children) el.classList.toggle('active', Number(el.dataset.i) === cur);
      const active = cuesEl.querySelector('.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }

  function tick() { sync(false); requestAnimationFrame(tick); }

  async function loadList() {
    const list = await fetch('/api/recordings').then((r) => r.json()).catch(() => []);
    const sel = $('recSel');
    sel.innerHTML = '';
    for (const r of list) {
      const o = document.createElement('option');
      o.value = r.base;
      o.textContent = `${r.base}  (${Sub.fmtBytes(r.bytes)})`;
      sel.appendChild(o);
    }
    sel.onchange = () => { const r = list.find((x) => x.base === sel.value); if (r) loadRecording(r); };
    const wanted = new URLSearchParams(location.search).get('rec');
    const first = list.find((x) => x.base === wanted) || list[0];
    if (first) { sel.value = first.base; loadRecording(first); }
  }

  // same look as the live display, scaled down for the page
  function applyLook() {
    Sub.applyCss(Sub.settings);
    document.documentElement.style.setProperty('--font-size', `${$('scale').value}px`);
    document.documentElement.style.setProperty('--pad-top', '2vh');
    document.documentElement.style.setProperty('--pad-y', '3vh');
    document.documentElement.style.setProperty('--pad-x', '4vw');
    document.body.classList.toggle('fade', Sub.settings.topFade !== false);
  }

  $('scale').addEventListener('input', applyLook);
  $('showSrc').addEventListener('change', () => sync(true));
  $('btnControl').addEventListener('click', () => window.open('/control', '_blank'));
  Sub.on('init', () => { applyLook(); loadList(); });
  Sub.on('settings', applyLook);
  Sub.connect();
  requestAnimationFrame(tick);
})();
