'use strict';
// Tencent usage for the dashboard: what the account consumed (asr GetUsageByDate) and, when the operator tells the
// server what was bought, what is left of the resource pack. Optionally the account balance (billing).
//
//   GetUsageByDate          asr 2019-06-14. BizNameList: asr_rt (实时识别), asr_rec (录音文件识别). StartDate/EndDate are
//                           YYYY-MM-DD in China time, at most 3 months apart; Duration comes back in seconds. Allowed by
//                           QcloudASRFullAccess / QcloudASRReadOnlyAccess, i.e. the keys the server already has.
//   DescribeAccountBalance  billing 2018-07-09, no parameters; amounts in 分. Needs a finance permission
//                           (billing:DescribeAccountBalance), so it takes its own key (TENCENT_BILLING_SECRET_ID/KEY)
//                           and the keys handed to desktop apps never gain it.
// Tencent has no API that returns a resource pack's remaining quota, so the pack is described by the operator
// (TENCENT_PACK = "<hours>h@<purchase date>") and remaining = size − usage since that date.
const tc3 = require('./tc3');

const BIZ = { asr_rt: 'live', asr_rec: 'files' };
const DAY = 86_400_000;
const CN_OFFSET = 8 * 3_600_000; // the usage API counts days in China time
const WINDOW_DAYS = 90; // the API accepts at most three months per call

const cnDate = (ms) => new Date(ms + CN_OFFSET).toISOString().slice(0, 10);
const cnMonthStart = (ms) => `${cnDate(ms).slice(0, 8)}01`;
const dayMs = (ymd) => Date.parse(`${ymd}T00:00:00Z`);
const addDays = (ymd, n) => new Date(dayMs(ymd) + n * DAY).toISOString().slice(0, 10);

/** TENCENT_PACK: "32h@2026-08-01" (hours) or "115200s@2026-08-01" (seconds). null when unset or malformed. */
function parsePack(spec) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([hs])?\s*@\s*(\d{4}-\d{2}-\d{2})\s*$/i.exec(spec || '');
  if (!m || Number.isNaN(dayMs(m[3]))) return null;
  const n = Number(m[1]);
  return { seconds: Math.round((m[2] || 'h').toLowerCase() === 'h' ? n * 3600 : n), since: m[3] };
}

/** Seconds and calls per business over [start, end] (inclusive, YYYY-MM-DD), in ≤ 90-day calls. */
async function usageBetween(creds, start, end, call = tc3.call) {
  const out = { live: 0, files: 0, count: 0 };
  for (let from = start; from <= end; from = addDays(from, WINDOW_DAYS)) {
    const to = addDays(from, WINDOW_DAYS - 1) < end ? addDays(from, WINDOW_DAYS - 1) : end;
    const r = await call(creds, { service: 'asr', version: '2019-06-14', action: 'GetUsageByDate', payload: { BizNameList: Object.keys(BIZ), StartDate: from, EndDate: to } });
    for (const it of (r.Data && r.Data.UsageByDateInfoList) || []) {
      const k = BIZ[it.BizName];
      if (!k) continue;
      out[k] += Number(it.Duration) || 0;
      out.count += Number(it.Count) || 0;
    }
  }
  return out;
}

async function balance(creds, call = tc3.call) {
  const r = await call(creds, { service: 'billing', version: '2018-07-09', action: 'DescribeAccountBalance', payload: {} });
  const fen = Number(r.RealBalance ?? r.Balance);
  return { yuan: Number.isFinite(fen) ? fen / 100 : null, oweYuan: (Number(r.OweAmount) || 0) / 100, allowArrears: !!r.IsAllowArrears };
}

class UsageMonitor {
  /**
   * @param {object} o  creds: the server's Tencent keys (usage) · billingCreds: keys with finance read access (balance)
   *                    pack: parsePack() result · pipeline: which usage the pack covers, 'live' (default) or 'all'
   */
  constructor({ creds, billingCreds = null, pack = null, pipeline = 'live', log = () => {}, call = tc3.call, ttlMs = 10 * 60_000, now = Date.now }) {
    Object.assign(this, { creds, billingCreds, pack, pipeline, log, call, ttlMs, now });
    this.cache = null;
  }

  /** Cached snapshot: this month's usage, what is left of the pack, the balance. Failures land in `errors`, never throw. */
  async snapshot() {
    const t = this.now();
    if (this.cache && t - this.cache.at < this.ttlMs) return this.cache;
    const snap = { at: t, month: null, pack: null, balance: null, errors: {} };
    if (!this.creds) snap.errors.usage = 'the server has no Tencent keys';
    else {
      try {
        const today = cnDate(t);
        snap.month = { since: cnMonthStart(t), ...(await usageBetween(this.creds, cnMonthStart(t), today, this.call)) };
        if (this.pack) {
          const u = await usageBetween(this.creds, this.pack.since, today, this.call);
          const used = this.pipeline === 'all' ? u.live + u.files : u.live;
          snap.pack = { seconds: this.pack.seconds, since: this.pack.since, covers: this.pipeline, usedSeconds: used, remainingSeconds: Math.max(0, this.pack.seconds - used), fraction: this.pack.seconds ? Math.max(0, Math.min(1, 1 - used / this.pack.seconds)) : 0 };
        }
      } catch (err) { snap.errors.usage = err.message; this.log('warn', `usage: ${err.message}`); }
    }
    if (this.billingCreds) {
      try { snap.balance = await balance(this.billingCreds, this.call); } catch (err) { snap.errors.balance = err.message; this.log('warn', `balance: ${err.message}`); }
    }
    this.cache = snap;
    return snap;
  }
}

module.exports = { UsageMonitor, parsePack, usageBetween, balance, cnDate, cnMonthStart, BIZ };
