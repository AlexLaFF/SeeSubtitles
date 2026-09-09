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

test('team: an Enterprise owner adds members who share the plan, its hours and its glossary; removal detaches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const db = openDb(dir);
  const auth = createAuth(db);
  const account = createAccount(db, { baseUrl: 'https://x.test', log() {} });
  const quotas = new Quotas(db);
  const owner = auth.addUser('owner@example.com', 'password-1');
  const hobby = auth.addUser('hobby@example.com', 'password-2');
  assert.throws(() => account.addMember(hobby.id, 'm@example.com'), /Enterprise/);
  account.setPlan(owner.id, 'enterprise');
  const added = account.addMember(owner.id, 'Member@Example.com');
  assert.equal(added.member.email, 'member@example.com');
  assert.match(added.reset.url, /^https:\/\/x\.test\/reset\//);
  assert.throws(() => account.addMember(owner.id, 'member@example.com'), /already exists/);
  const member = account.userRow(added.member.id);
  assert.throws(() => account.addMember(member.id, 'x@example.com'), /owner adds/);

  // the member's plan is the owner's; hours add up across the team
  let s = quotas.snapshot(member);
  assert.equal(s.plan, 'enterprise'); assert.equal(s.limits.sharing, true); assert.equal(s.team.member, true);
  quotas.add(owner.id, 'live', 3600); quotas.add(member.id, 'live', 1800);
  assert.equal(quotas.snapshot(member).used.liveSeconds, 5400);
  assert.equal(quotas.snapshot(account.userRow(owner.id)).used.liveSeconds, 5400);
  assert.equal(quotas.remaining(member, 'live'), PLANS.enterprise.liveHours * 3600 - 5400);

  // one glossary for the team
  account.putGlossary(owner.id, [{ term: '腾讯云', weight: 10 }]);
  assert.deepEqual(account.getGlossary(member.id).items.map((i) => i.term), ['腾讯云']);
  account.putGlossary(member.id, [{ term: '腾讯云', weight: 10 }, { term: '共融', weight: 6 }]);
  assert.equal(account.getGlossary(owner.id).items.length, 2);

  const view = account.teamView(owner.id);
  assert.equal(view.owner, true); assert.equal(view.members.length, 2); assert.equal(view.members[0].owner, true); assert.equal(view.members[1].live_seconds, 1800);
  assert.equal(account.teamView(member.id).owner, false); assert.equal(account.teamView(member.id).org.ownerEmail, 'owner@example.com');
  account.setTeamName(owner.id, '  Nutrition talks  ');
  assert.equal(account.teamView(member.id).org.name, 'Nutrition talks');

  assert.throws(() => account.removeMember(hobby.id, member.id), /do not own/);
  account.removeMember(owner.id, member.id);
  assert.equal(account.userRow(member.id).org_id, null);
  assert.equal(quotas.snapshot(account.userRow(member.id)).plan, 'hobbyist');
  assert.equal(account.teamView(owner.id).members.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pending account requests are counted and listed newest first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-'));
  const db = openDb(dir);
  const account = createAccount(db, { log() {} });
  account.requestAccount({ name: 'A', email: 'a@example.com', plan: 'business', note: 'talks' });
  account.requestAccount({ name: 'B', email: 'b@example.com' });
  const p = account.pendingRequests();
  assert.equal(p.count, 2); assert.equal(p.latest[0].email, 'b@example.com'); assert.match(p.latest[1].note, /plan: business/);
  fs.rmSync(dir, { recursive: true, force: true });
});
