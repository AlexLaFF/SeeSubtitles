'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { UsageMonitor, parsePack, usageBetween, cnDate, cnMonthStart } = require('../lib/usage');

const creds = { secretId: 'id', secretKey: 'key' };
const NOW = Date.parse('2026-09-09T02:00:00Z'); // 10:00 in China

test('parsePack reads hours or seconds and a purchase date', () => {
  assert.deepEqual(parsePack('32h@2026-08-01'), { seconds: 115200, since: '2026-08-01' });
  assert.deepEqual(parsePack(' 1.5 @ 2026-01-31 '), { seconds: 5400, since: '2026-01-31' });
  assert.deepEqual(parsePack('600s@2026-08-01'), { seconds: 600, since: '2026-08-01' });
  assert.equal(parsePack(''), null);
  assert.equal(parsePack('32h'), null);
  assert.equal(parsePack('32h@2026-13-40'), null);
});

test('dates are counted in China time', () => {
  assert.equal(cnDate(Date.parse('2026-09-08T17:30:00Z')), '2026-09-09'); // 01:30 the next day in China
  assert.equal(cnMonthStart(NOW), '2026-09-01');
});

test('usageBetween splits long windows into ≤ 90-day calls and sums per business', async () => {
  const calls = [];
  const call = async (c, req) => {
    calls.push(req.payload);
    assert.equal(req.service, 'asr'); assert.equal(req.action, 'GetUsageByDate');
    return { Data: { UsageByDateInfoList: [{ BizName: 'asr_rt', Count: 2, Duration: 100 }, { BizName: 'asr_rec', Count: 1, Duration: 40 }, { BizName: 'other', Count: 9, Duration: 999 }] } };
  };
  const u = await usageBetween(creds, '2026-05-01', '2026-09-09', call);
  assert.deepEqual(calls.map((p) => [p.StartDate, p.EndDate]), [['2026-05-01', '2026-07-29'], ['2026-07-30', '2026-09-09']]);
  assert.deepEqual(calls[0].BizNameList, ['asr_rt', 'asr_rec']);
  assert.deepEqual(u, { live: 200, files: 80, count: 6 });
});

test('snapshot: month usage, pack remaining for the live pipeline, balance in yuan, cached', async () => {
  let n = 0;
  const call = async (c, req) => {
    n++;
    if (req.action === 'DescribeAccountBalance') { assert.equal(c.secretId, 'billing'); return { Balance: 123456, RealBalance: 120000, OweAmount: 0, IsAllowArrears: false }; }
    // this month: 1 h live · since purchase: 20 h live + 5 h files
    const month = req.payload.StartDate === '2026-09-01';
    return { Data: { UsageByDateInfoList: [{ BizName: 'asr_rt', Count: 3, Duration: month ? 3600 : 72000 }, { BizName: 'asr_rec', Count: 1, Duration: month ? 0 : 18000 }] } };
  };
  let t = NOW;
  const m = new UsageMonitor({ creds, billingCreds: { secretId: 'billing', secretKey: 'k' }, pack: parsePack('32h@2026-08-01'), call, now: () => t });
  const s = await m.snapshot();
  assert.deepEqual(s.month, { since: '2026-09-01', live: 3600, files: 0, count: 4 });
  assert.equal(s.pack.usedSeconds, 72000);
  assert.equal(s.pack.remainingSeconds, 115200 - 72000);
  assert.equal(Math.round(s.pack.fraction * 100), 38);
  assert.equal(s.pack.covers, 'live');
  assert.deepEqual(s.balance, { yuan: 1200, oweYuan: 0, allowArrears: false });
  assert.deepEqual(s.errors, {});
  const calls = n;
  t += 60_000;
  assert.equal(await m.snapshot(), s); // within the TTL nothing is fetched again
  assert.equal(n, calls);
  t += 11 * 60_000;
  await m.snapshot();
  assert.ok(n > calls);
});

test('snapshot reports failures per part instead of throwing', async () => {
  const call = async (c, req) => { if (req.service === 'billing') throw new Error('billing: AuthFailure.UnauthorizedOperation'); return { Data: { UsageByDateInfoList: [] } }; };
  const m = new UsageMonitor({ creds, billingCreds: creds, pack: parsePack('10h@2026-09-01'), pipeline: 'all', call, now: () => NOW });
  const s = await m.snapshot();
  assert.deepEqual(s.month, { since: '2026-09-01', live: 0, files: 0, count: 0 });
  assert.equal(s.pack.remainingSeconds, 36000);
  assert.equal(s.balance, null);
  assert.match(s.errors.balance, /AuthFailure/);
  const none = new UsageMonitor({ creds: null, now: () => NOW });
  assert.equal((await none.snapshot()).errors.usage, 'the server has no Tencent keys');
});
