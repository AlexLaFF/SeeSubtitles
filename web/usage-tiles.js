// Stat tiles for /api/usage: what the account consumed this month, what is left of the resource pack (if the server
// knows its size) and the Tencent balance. Used by the overview and the Account page.
(function () {
  'use strict';
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const fmtDur = (s) => { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} m` : `${m} min`; };
  /** @param box   container for the tiles (hidden when there are none)
   *  @param note  container for the caveats chip (may be null)
   *  @param u     the /api/usage snapshot, or { errors } when the call failed */
  function render(box, note, u) {
    box.innerHTML = '';
    const tile = (k, v, d) => { const t = el('div', { class: 'stat' }); t.appendChild(el('div', { class: 'k' }, k)); t.appendChild(el('div', { class: 'v' }, v)); if (d) t.appendChild(el('div', { class: 'd' }, d)); box.appendChild(t); };
    if (u.month) {
      tile('Live this month', fmtDur(u.month.live), `since ${u.month.since} · ${u.month.count} requests`);
      tile('Files this month', fmtDur(u.month.files), 'recognised on this server');
    }
    if (u.pack) { const pct = Math.round(u.pack.fraction * 100); tile('Resource pack', `${pct}% left`, `${fmtDur(u.pack.remainingSeconds)} of ${fmtDur(u.pack.seconds)} bought ${u.pack.since}${u.pack.covers === 'all' ? '' : ' · live subtitles'}`); }
    if (u.balance && u.balance.yuan != null) tile('Account balance', `¥${u.balance.yuan.toFixed(2)}`, u.balance.oweYuan ? `owing ¥${u.balance.oweYuan.toFixed(2)}` : 'Tencent Cloud');
    box.hidden = !box.children.length;
    if (!note) return;
    note.innerHTML = '';
    const bits = Object.entries(u.errors || {}).map(([k, v]) => `${k}: ${v}`);
    if (u.month && !u.pack) bits.push('set TENCENT_PACK on the server to see what is left of the resource pack');
    if (bits.length) note.appendChild(el('span', { class: 'chip' }, bits.join(' · ')));
  }
  window.UsageTiles = { render, fmtDur };
})();
