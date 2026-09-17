#!/usr/bin/env node
'use strict';
// What the account has been charged, read from Tencent's billing API with a key that can only read bills.
//
//   node deploy/billing.js                      this month: totals by product, every priced item, then each day
//   node deploy/billing.js 2026-08 2026-09      those months
//   node deploy/billing.js --json out.json      also write the raw detail lines, for analysis
//
// The key lives in ~/.config/seesubtitles/billing.env (TENCENT_BILLING_SECRET_ID / _KEY), belongs to a sub-user with
// only QcloudFinanceBillReadOnlyAccess, and never leaves this Mac. It is read here and never printed.
// Bills lag usage: TokenHub settles hourly, two to three hours behind; speech recognition once a day, around 11:05.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOST = 'billing.tencentcloudapi.com';
const VERSION = '2018-07-09';

function loadKey() {
  const file = path.join(os.homedir(), '.config', 'seesubtitles', 'billing.env');
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!env.TENCENT_BILLING_SECRET_ID || !env.TENCENT_BILLING_SECRET_KEY) throw new Error(`${file} needs TENCENT_BILLING_SECRET_ID and TENCENT_BILLING_SECRET_KEY`);
  return { id: env.TENCENT_BILLING_SECRET_ID, key: env.TENCENT_BILLING_SECRET_KEY };
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();

/** One billing API call, signed with TC3-HMAC-SHA256. Resolves with `Response`, or rejects with Tencent's error. */
async function call(cred, action, params) {
  const body = JSON.stringify(params);
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${HOST}\n\ncontent-type;host\n${sha256(body)}`;
  const scope = `${date}/billing/tc3_request`;
  const toSign = `TC3-HMAC-SHA256\n${ts}\n${scope}\n${sha256(canonical)}`;
  const signing = hmac(hmac(hmac(`TC3${cred.key}`, date), 'billing'), 'tc3_request');
  const signature = crypto.createHmac('sha256', signing).update(toSign, 'utf8').digest('hex');
  const res = await fetch(`https://${HOST}/`, {
    method: 'POST',
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${cred.id}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      Host: HOST,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(ts),
      'X-TC-Version': VERSION,
    },
    body,
  });
  const json = await res.json();
  const r = json.Response || {};
  if (r.Error) { const e = new Error(`${action}: ${r.Error.Code} ${r.Error.Message}`); e.code = r.Error.Code; throw e; }
  return r;
}

/** Every detail line of one month, page by page. */
async function detailLines(cred, month) {
  const lines = [];
  for (let offset = 0; ; offset += 100) {
    const r = await call(cred, 'DescribeBillDetail', { Month: month, Offset: offset, Limit: 100, NeedRecordNum: 1 });
    const set = r.DetailSet || [];
    lines.push(...set);
    if (set.length < 100 || lines.length >= (r.Total || 0)) break;
  }
  return lines;
}

const yuan = (n) => Number(n || 0);
const fmt = (n) => yuan(n).toFixed(yuan(n) < 1 ? 4 : 2);

async function main() {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
  const now = new Date();
  const months = args.length ? args : [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`];
  const cred = loadKey();
  const dump = {};

  for (const month of months) {
    console.log(`\n══ ${month}`);
    let lines = [];
    try { lines = await detailLines(cred, month); } catch (err) { console.log(`  detail unavailable: ${err.message}`); continue; }
    dump[month] = lines;
    // Totals come from the detail lines, not DescribeBillSummaryByProduct: the summary leaves out the day that settled
    // most recently (on 17 Sept it showed ¥122.51 while the lines already held ¥395.49).
    const cost = (l) => (l.ComponentSet || []).reduce((a, c) => a + yuan(c.RealCost), 0);
    const byProduct = new Map();
    for (const l of lines) byProduct.set(l.BusinessCodeName, (byProduct.get(l.BusinessCodeName) || 0) + cost(l));
    console.log(`total charged ¥${fmt([...byProduct.values()].reduce((a, b) => a + b, 0))}`);
    for (const [name, c] of [...byProduct].sort((a, b) => b[1] - a[1])) if (Math.abs(c) >= 0.01) console.log(`  ${name.padEnd(28)} ¥${fmt(c).padStart(10)}`);

    // one row per priced item: what it is, how much was used, at what price, for how much
    const items = new Map();
    const days = new Map();
    for (const l of lines) {
      if (l.BusinessCode === 'p_rounding' || /精度差异/.test(l.BusinessCodeName)) continue;
      for (const c of l.ComponentSet || []) {
        const k = [l.BusinessCodeName, l.ProductCodeName, c.ItemCodeName || c.ComponentCodeName, l.PayModeName, c.SinglePrice, c.PriceUnit].join('|');
        const it = items.get(k) || { business: l.BusinessCodeName, product: l.ProductCodeName, item: c.ItemCodeName || c.ComponentCodeName,
          payMode: l.PayModeName, price: c.SinglePrice, priceUnit: c.PriceUnit, used: 0, usedUnit: c.UsedAmountUnit, cost: 0, lines: 0,
          first: l.FeeBeginTime, last: l.FeeEndTime };
        it.used += yuan(c.UsedAmount);
        it.cost += yuan(c.RealCost);
        it.lines++;
        if (l.FeeBeginTime < it.first) it.first = l.FeeBeginTime;
        if (l.FeeEndTime > it.last) it.last = l.FeeEndTime;
        items.set(k, it);
        if (l.PayModeName === '按量计费') {
          const day = String(l.FeeBeginTime).slice(0, 10);
          const d = days.get(day) || [];
          d.push(`${+yuan(c.UsedAmount).toFixed(2)} ${c.UsedAmountUnit} ${c.ItemCodeName} @ ${+yuan(c.SinglePrice)} = ¥${fmt(c.RealCost)}`);
          days.set(day, d);
        }
      }
    }
    console.log(`  ${lines.length} detail lines`);
    for (const it of [...items.values()].sort((a, b) => b.cost - a.cost)) {
      console.log(`  ${`${it.business} › ${it.item}`.slice(0, 60).padEnd(60)} ${String(+it.used.toFixed(4)).padStart(12)} ${String(it.usedUnit || '').padEnd(8)}`
        + ` @ ${it.price} ${it.priceUnit || ''}`.padEnd(22) + ` = ¥${fmt(it.cost)}  (${it.payMode}; ${String(it.first).slice(0, 10)} → ${String(it.last).slice(0, 10)})`);
    }
    console.log('\n  pay-as-you-go, day by day');
    for (const [day, d] of [...days].sort()) for (const row of d) console.log(`  ${day}  ${row}`);
  }

  // No balance: DescribeAccountBalance needs finance:trade, which a read-only bill key deliberately lacks.
  if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(dump, null, 1)); console.log(`raw detail lines written to ${jsonOut}`); }
}

if (require.main === module) main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
module.exports = { call, loadKey, detailLines };
