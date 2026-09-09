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
  const hrs = (s) => (Math.round((s || 0) / 360) / 10).toFixed(1);
  /** The account's plan and this month's hours (from /api/me → plan). */
  function plan(box, p) {
    box.innerHTML = '';
    if (!p) { box.hidden = true; return; }
    const tile = (k, v, d) => { const x = el('div', { class: 'stat' }); x.appendChild(el('div', { class: 'k' }, k)); x.appendChild(el('div', { class: 'v' }, v)); if (d) x.appendChild(el('div', { class: 'd' }, d)); box.appendChild(x); };
    const name = t(`plan.${p.plan}`);
    tile(t('plan.tile'), name, p.plan === 'admin' ? t('plan.unlimited') : t('plan.perMonth', { price: p.price }));
    tile(t('plan.liveTile'), p.limits.liveSeconds == null ? t('plan.noLimit', { used: hrs(p.used.liveSeconds) }) : t('plan.of', { used: hrs(p.used.liveSeconds), max: hrs(p.limits.liveSeconds) }), t('plan.since', { month: p.month }));
    tile(t('plan.fileTile'), p.limits.fileSeconds == null ? t('plan.noLimit', { used: hrs(p.used.fileSeconds) }) : t('plan.of', { used: hrs(p.used.fileSeconds), max: hrs(p.limits.fileSeconds) }), [p.limits.sharing ? t('plan.hasSharing') : t('plan.noSharing'), p.limits.summaries ? t('plan.hasSummaries') : t('plan.noSummaries')].join(' · '));
    box.hidden = false;
  }
  window.UsageTiles = { render, fmtDur, plan, hrs };
})();
