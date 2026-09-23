'use strict';
// Provider usage by account, action and the model that actually answered. These are billable units, not invoice
// amounts: provider rounding, free packs and settlement happen later. Recording an event never exposes a key or text.
class UsageLedger {
  constructor(db) { this.db = db; }

  record(row) {
    const n = (value) => Math.max(0, Number(value) || 0);
    this.db.run(`INSERT OR IGNORE INTO usage_detail
      (event_key, user_id, action_id, action, operation, provider, pipeline, model, source_lang, target_lang,
       seconds, calls, input_tokens, output_tokens, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.eventKey || null, row.userId, row.actionId || null, row.action, row.operation, row.provider,
    row.pipeline || '', row.model || '', row.source || '', row.target || '',
    n(row.seconds), n(row.calls), Math.round(n(row.inputTokens)), Math.round(n(row.outputTokens)), row.at || Date.now());
  }

  breakdown(userId, month = new Date().toISOString().slice(0, 7)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month must be YYYY-MM');
    const from = Date.parse(`${month}-01T00:00:00Z`);
    const to = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1);
    const rows = this.db.all(`SELECT action, operation, provider, pipeline, model, source_lang AS source,
      target_lang AS target, SUM(seconds) AS seconds, SUM(calls) AS calls,
      SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
      COUNT(DISTINCT action_id) AS actions
      FROM usage_detail WHERE user_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY action, operation, provider, pipeline, model, source_lang, target_lang
      ORDER BY seconds DESC, calls DESC`, userId, from, to);
    return { month, userId, rows };
  }
}

module.exports = { UsageLedger };
