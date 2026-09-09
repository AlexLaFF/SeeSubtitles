// Stat tiles for /api/usage: what the account consumed this month, what is left of the resource pack (if the server
// knows its size) and the Tencent balance. Used by the overview and the Account page. Strings from the catalog.
(function () {
  'use strict';
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const fmtDur = (s) => { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return h ? t('usage.hours', { h, m }) : t('usage.minutes', { m }); };
  /** @param box   container for the tiles (hidden when there are none)
   *  @param note  container for the caveats chip (may be null)
   *  @param u     the /api/usage snapshot, or { errors } when the call failed */
  function render(box, note, u) {
    box.innerHTML = '';
    const tile = (k, v, d) => { const x = el('div', { class: 'stat' }); x.appendChild(el('div', { class: 'k' }, k)); x.appendChild(el('div', { class: 'v' }, v)); if (d) x.appendChild(el('div', { class: 'd' }, d)); box.appendChild(x); };
    if (u.month) {
      tile(t('usage.live'), fmtDur(u.month.live), t('usage.since', { since: u.month.since, count: u.month.count }));
      tile(t('usage.files'), fmtDur(u.month.files), t('usage.recognised'));
    }
    if (u.pack) { const pct = Math.round(u.pack.fraction * 100); tile(t('usage.pack'), t('usage.left', { pct }), t('usage.packDetail', { left: fmtDur(u.pack.remainingSeconds), total: fmtDur(u.pack.seconds), since: u.pack.since }) + (u.pack.covers === 'all' ? '' : t('usage.packLive'))); }
    if (u.balance && u.balance.yuan != null) tile(t('usage.balance'), `¥${u.balance.yuan.toFixed(2)}`, u.balance.oweYuan ? t('usage.owing', { n: u.balance.oweYuan.toFixed(2) }) : t('usage.tencent'));
    box.hidden = !box.children.length;
    if (!note) return;
    note.innerHTML = '';
    const bits = Object.entries(u.errors || {}).map(([k, v]) => `${k}: ${v}`);
    if (u.month && !u.pack) bits.push(t('usage.setPack'));
    if (bits.length) note.appendChild(el('span', { class: 'chip' }, bits.join(' · ')));
  }
  window.UsageTiles = { render, fmtDur };
})();
