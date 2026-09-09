'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { createAuth } = require('../lib/auth');
const { createAccount } = require('../lib/account');
const { Quotas, PLANS } = require('../lib/plans');

test('plans: hobbyist limits, admin unlimited, usage adds up per month, the team lists plans and hours', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
  const db = openDb(dir);
  const auth = createAuth(db);
  const account = createAccount(db, { log() {} });
  const quotas = new Quotas(db);
  const admin = auth.addUser('boss@example.com', 'password-1'); auth.setRole('boss@example.com', 'admin');
  const u = auth.addUser('someone@example.com', 'password-2');

  const a = quotas.snapshot(account.userRow(admin.id));
  assert.equal(a.plan, 'admin'); assert.equal(a.limits.liveSeconds, null); assert.equal(a.limits.sharing, true);
  assert.equal(quotas.remaining(account.userRow(admin.id), 'live'), Infinity);

  let s = quotas.snapshot(account.userRow(u.id));
  assert.equal(s.plan, 'hobbyist'); assert.equal(s.limits.liveSeconds, 10 * 3600); assert.equal(s.limits.sharing, false); assert.equal(s.limits.summaries, false);
  quotas.add(u.id, 'live', 3600); quotas.add(u.id, 'live', 1800); quotas.add(u.id, 'file', 600);
  s = quotas.snapshot(account.userRow(u.id));
  assert.deepEqual(s.used, { liveSeconds: 5400, fileSeconds: 600 });
  assert.equal(quotas.remaining(account.userRow(u.id), 'live'), 10 * 3600 - 5400);
  assert.equal(quotas.remaining(account.userRow(u.id), 'file'), 5 * 3600 - 600);
  quotas.add(u.id, 'file', 5 * 3600);
  assert.equal(quotas.remaining(account.userRow(u.id), 'file'), 0, 'clamped at zero');
  assert.equal(quotas.used(u.id, '1999-01').liveSeconds, 0, 'other months are separate');

  account.setPlan(u.id, 'business');
  s = quotas.snapshot(account.userRow(u.id));
  assert.equal(s.plan, 'business'); assert.equal(s.limits.liveSeconds, PLANS.business.liveHours * 3600); assert.equal(s.limits.summaries, true);
  assert.throws(() => account.setPlan(u.id, 'gold'), /plan must be one of/);

  const team = account.team();
  const row = team.users.find((x) => x.id === u.id);
  assert.equal(row.plan, 'business'); assert.equal(row.live_seconds, 5400); assert.equal(row.file_seconds, 600 + 5 * 3600);
  fs.rmSync(dir, { recursive: true, force: true });
});
