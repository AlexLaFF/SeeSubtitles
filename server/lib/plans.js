'use strict';
// Plans and monthly quotas. Hours are audio per calendar month (UTC); an administrator has no limits and every
// feature. Plan ids match the website (web/site.js PLANS) and the request form.
const PLANS = {
  hobbyist: { name: 'Hobbyist', price: 28, liveHours: 10, fileHours: 5, sharing: false, summaries: false, team: false },
  business: { name: 'Business', price: 88, liveHours: 40, fileHours: 20, sharing: true, summaries: true, team: false },
  enterprise: { name: 'Enterprise', price: 388, liveHours: 200, fileHours: 100, sharing: true, summaries: true, team: true },
};
const ADMIN = { name: 'Administrator', price: 0, liveHours: null, fileHours: null, sharing: true, summaries: true, team: true };
const IDS = Object.keys(PLANS);

const monthKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);
/** 'admin' for administrators, otherwise the account's plan (hobbyist when unset or unknown). */
const planOf = (row) => (row && row.role === 'admin' ? 'admin' : row && PLANS[row.plan] ? row.plan : 'hobbyist');
const limitsOf = (plan) => (plan === 'admin' ? ADMIN : PLANS[plan] || PLANS.hobbyist);

class Quotas {
  constructor(db) { this.db = db; }
  used(userId, month = monthKey()) {
    const r = this.db.get('SELECT live_seconds, file_seconds FROM usage WHERE user_id = ? AND month = ?', userId, month);
    return { liveSeconds: r ? r.live_seconds : 0, fileSeconds: r ? r.file_seconds : 0 };
  }
  /** Add seconds of live subtitles or file recognition to the month; returns the month's totals. */
  add(userId, kind, seconds, month = monthKey()) {
    const col = kind === 'live' ? 'live_seconds' : 'file_seconds';
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    if (s) this.db.run(`INSERT INTO usage(user_id, month, ${col}) VALUES (?,?,?) ON CONFLICT(user_id, month) DO UPDATE SET ${col} = ${col} + excluded.${col}`, userId, month, s);
    return this.used(userId, month);
  }
  /** What a client needs to show and enforce the plan: limits in seconds (null = unlimited) and what is used. */
  snapshot(row) {
    const plan = planOf(row);
    const l = limitsOf(plan);
    return {
      plan, name: l.name, price: l.price, month: monthKey(),
      limits: { liveSeconds: l.liveHours == null ? null : l.liveHours * 3600, fileSeconds: l.fileHours == null ? null : l.fileHours * 3600, sharing: l.sharing, summaries: l.summaries, team: l.team },
      used: this.used(row.id),
    };
  }
  /** Seconds left this month for 'live' or 'file' (Infinity when the plan has no limit). */
  remaining(row, kind) {
    const s = this.snapshot(row);
    const limit = kind === 'live' ? s.limits.liveSeconds : s.limits.fileSeconds;
    if (limit == null) return Infinity;
    return Math.max(0, limit - (kind === 'live' ? s.used.liveSeconds : s.used.fileSeconds));
  }
}

module.exports = { PLANS, ADMIN, IDS, Quotas, planOf, limitsOf, monthKey };
