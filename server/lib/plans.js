'use strict';
// Plans and monthly quotas. Hours are audio per calendar month (UTC); an administrator has no limits and every
// feature. Plan ids match the website (web/site.js PLANS) and the request form.
const PLANS = {
  hobbyist: { name: 'Hobbyist', price: 28, liveHours: 10, fileHours: 5, sharing: false, summaries: false, team: false, directLive: false },
  business: { name: 'Business', price: 88, liveHours: 40, fileHours: 20, sharing: true, summaries: true, team: false, directLive: false },
  enterprise: { name: 'Enterprise', price: 388, liveHours: 200, fileHours: 100, sharing: true, summaries: true, team: true, directLive: false },
  // Pay as you go (web/site.js RATES): billed per hour actually processed, so there is no monthly cap —
  // null hours mean unmetered *here* while Quotas.add keeps recording the seconds to invoice from.
  // Sharing to phones and screens stays a monthly-plan feature; summaries are a priced line item.
  payg: { name: 'Pay as you go', price: 0, liveHours: null, fileHours: null, sharing: false, summaries: true, team: false, directLive: false },
};
// directLive lets an account skip the metering proxy and connect straight to Tencent. It is not a perk of
// a paid tier: metering exists to constrain people who are not paying the Tencent bill, and the owner is.
// It also means the owner's own events do not stop when the server does.
const ADMIN = { name: 'Administrator', price: 0, liveHours: null, fileHours: null, sharing: true, summaries: true, team: true, directLive: true };
const IDS = Object.keys(PLANS);

const monthKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);
/** 'admin' for administrators, otherwise the account's plan (hobbyist when unset or unknown). */
const planOf = (row) => (row && row.role === 'admin' ? 'admin' : row && PLANS[row.plan] ? row.plan : 'hobbyist');
const limitsOf = (plan) => (plan === 'admin' || plan === 'team' ? ADMIN : PLANS[plan] || PLANS.hobbyist);

class Quotas {
  constructor(db) { this.db = db; }
  used(userId, month = monthKey()) {
    const r = this.db.get('SELECT live_seconds, file_seconds FROM usage WHERE user_id = ? AND month = ?', userId, month);
    return { liveSeconds: r ? r.live_seconds : 0, fileSeconds: r ? r.file_seconds : 0 };
  }
  /** A team counts together: the owner's plan applies to every member and their hours add up. */
  scope(row) {
    const owned = this.db.get('SELECT id FROM orgs WHERE owner_id = ?', row.id);
    const orgId = row.org_id || (owned && owned.id);
    const org = orgId ? this.db.get('SELECT o.id, o.owner_id, o.name, u.role, u.plan FROM orgs o JOIN users u ON u.id = o.owner_id WHERE o.id = ?', orgId) : null;
    if (!org) return { planRow: row, ids: [row.id], team: null };
    const ids = this.db.all('SELECT id FROM users WHERE org_id = ? OR id = ?', org.id, org.owner_id).map((u) => u.id);
    return { planRow: { id: org.owner_id, role: org.role, plan: org.plan }, ids, team: { id: org.id, name: org.name, ownerId: org.owner_id, member: row.id !== org.owner_id } };
  }
  usedBy(ids, month = monthKey()) {
    const out = { liveSeconds: 0, fileSeconds: 0 };
    for (const id of ids) { const u = this.used(id, month); out.liveSeconds += u.liveSeconds; out.fileSeconds += u.fileSeconds; }
    return out;
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
    const sc = this.scope(row);
    let plan = planOf(sc.planRow);
    if (plan === 'admin' && sc.team && sc.team.member) plan = 'team'; // an administrator's team members share the freedom, not the role
    const l = limitsOf(plan);
    return {
      plan, name: l.name, price: l.price, month: monthKey(), team: sc.team,
      limits: { liveSeconds: l.liveHours == null ? null : l.liveHours * 3600, fileSeconds: l.fileHours == null ? null : l.fileHours * 3600, sharing: l.sharing, summaries: l.summaries, team: l.team, directLive: !!l.directLive },
      used: this.usedBy(sc.ids),
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
