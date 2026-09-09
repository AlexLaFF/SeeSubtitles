'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { createAuth } = require('../lib/auth');
const { createAccount, cleanGlossary, hotwordsText, deviceName } = require('../lib/account');
const { LiveSessions } = require('../lib/live');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subs-account-'));
  const db = openDb(dir);
  const auth = createAuth(db);
  const account = createAccount(db, { baseUrl: 'https://subs.test' });
  const admin = auth.addUser('admin@test', 'password1'); auth.setRole('admin@test', 'admin');
  const mei = auth.addUser('mei@test', 'password2');
  const asUser = (u) => { const token = auth.issueToken(u.id, 'cookie', 'Safari'); return { ...u, token }; };
  return { dir, db, auth, account, admin: asUser(admin), mei: asUser(mei) };
}

test('glossary is cleaned: weights clamped, duplicates and pipes dropped, hotwords text derived', () => {
  const items = cleanGlossary([{ term: ' 騰訊雲 ', weight: 15, note: 'x' }, { term: '共融', weight: '8' }, { term: '共融', weight: 3 }, { term: 'a|b', weight: 100 }, { term: '', weight: 1 }, { term: '字幕' }]);
  assert.deepEqual(items.map((i) => [i.term, i.weight]), [['騰訊雲', 11], ['共融', 8], ['ab', 100], ['字幕', 6]]);
  assert.equal(hotwordsText(items), '騰訊雲|11\n共融|8\nab|100\n字幕|6');
  assert.throws(() => cleanGlossary('nope'), /list/);
  assert.throws(() => cleanGlossary(Array.from({ length: 129 }, (_, i) => ({ term: `t${i}` }))), /128/);
});

test('glossary round-trips per user', () => {
  const { account, mei, admin } = setup();
  assert.deepEqual(account.getGlossary(mei.id), { items: [], updatedAt: null });
  const put = account.putGlossary(mei.id, [{ term: '黃大仙', weight: 10, note: 'place' }]);
  assert.equal(put.items[0].note, 'place');
  assert.deepEqual(account.getGlossary(mei.id).items, put.items);
  assert.deepEqual(account.getGlossary(admin.id).items, []);
});

test('password change needs the current one and signs out other devices', () => {
  const { auth, account, mei } = setup();
  const other = auth.issueToken(mei.id, 'bearer', 'See Subtitles desktop app');
  assert.throws(() => account.changePassword(mei, 'wrong', 'newpassword'), /current password/);
  assert.throws(() => account.changePassword(mei, 'password2', 'short'), /8 characters/);
  account.changePassword(mei, 'password2', 'newpassword');
  assert.ok(auth.login('mei@test', 'newpassword', 'cookie'));
  assert.equal(auth.userForToken(other), null);
  assert.equal(auth.userForToken(mei.token).id, mei.id);
});

test('devices: listed with the current one marked, revocable one at a time or all others', () => {
  const { auth, account, mei } = setup();
  auth.issueToken(mei.id, 'bearer', 'See Subtitles desktop app');
  auth.issueToken(mei.id, 'cookie', 'Chrome');
  const list = account.listTokens(mei);
  assert.equal(list.length, 3);
  assert.equal(list.filter((t) => t.current).length, 1);
  assert.ok(list.every((t) => !t.token && t.id.length === 12));
  const target = list.find((t) => t.label === 'Chrome');
  assert.equal(account.revokeTokens(mei, { id: target.id }), 1);
  assert.equal(account.revokeTokens(mei, { all: true }), 1);
  assert.equal(account.listTokens(mei).length, 1);
});

test('team: invites, roles with a last-admin guard, reset links that work once and expire', () => {
  const { db, auth, account, admin, mei } = setup();
  assert.equal(account.isAdmin(admin), true);
  assert.equal(account.isAdmin(mei), false);
  const code = account.createInvite(admin.id);
  let t = account.team();
  assert.equal(t.users.length, 2);
  assert.equal(t.invites[0].code, code);
  assert.equal(t.invites[0].created_by, 'admin@test');
  auth.signup('ken@test', 'password3', { mode: 'invite', invite: code });
  assert.equal(account.team().invites[0].used_by, 'ken@test');
  assert.throws(() => account.deleteInvite(code), /unused/);
  assert.throws(() => account.setRole(admin, admin.id, 'user'), /only administrator/);
  account.setRole(admin, mei.id, 'admin');
  account.setRole(admin, admin.id, 'user');
  assert.equal(account.isAdmin(mei), true);
  const reset = account.createReset(mei.id);
  assert.match(reset.url, /^https:\/\/subs\.test\/reset\//);
  assert.equal(account.resetInfo(reset.token).email, 'm•••@test');
  assert.throws(() => account.resetPassword(reset.token, 'short'), /8 characters/);
  assert.equal(account.resetPassword(reset.token, 'afterreset'), 'mei@test');
  assert.equal(account.resetInfo(reset.token), null);
  assert.throws(() => account.resetPassword(reset.token, 'afterreset2'), /invalid or has expired/);
  assert.equal(auth.userForToken(mei.token), null); // every device signed out
  assert.ok(auth.login('mei@test', 'afterreset', 'cookie'));
  const old = account.createReset(mei.id);
  db.run('UPDATE resets SET created_at = ? WHERE token = ?', Date.now() - 25 * 3600 * 1000, old.token);
  assert.equal(account.resetInfo(old.token), null);
});

test('account requests from the website are validated and can be marked handled', () => {
  const { account, admin } = setup();
  assert.throws(() => account.requestAccount({ email: 'nope' }), /email/);
  const { id } = account.requestAccount({ name: 'Alex', email: 'Alex@Example.com ', org: 'HKU', note: 'talks' });
  const req = account.team().requests[0];
  assert.equal(req.email, 'alex@example.com');
  assert.equal(req.handled_at, null);
  account.handleRequest(id, admin.id);
  assert.ok(account.team().requests[0].handled_at);
  assert.throws(() => account.handleRequest(id, admin.id), /open request/);
});

test('live sessions count the phones that followed and the peak', () => {
  const { db, mei } = setup();
  const live = new LiveSessions({ db, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'subs-live-')) });
  const s = live.create(mei.id, 'talk');
  const fake = () => { const handlers = {}; return { writeHead() {}, write() {}, on(ev, fn) { handlers[ev] = fn; }, close() { handlers.close && handlers.close(); } }; };
  const a = fake(); const b = fake();
  live.subscribe(s.code, a, a, {}); live.subscribe(s.code, b, b, {});
  b.close();
  const c = fake(); live.subscribe(s.code, c, c, {});
  const row = live.list(mei.id)[0];
  assert.equal(row.peak_viewers, 2);
  assert.equal(row.total_viewers, 3);
  assert.equal(row.viewers, 2);
  a.close(); c.close(); // clears the heartbeat timers so the test process can exit
  assert.equal(live.list(mei.id)[0].viewers, 0);
});

test('device names come from the user agent, the desktop app keeps its own label', () => {
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'cookie'), 'Safari on iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'cookie'), 'Chrome on Mac');
  assert.equal(deviceName('See Subtitles desktop app', 'bearer'), 'See Subtitles desktop app');
  assert.equal(deviceName('', 'bearer'), 'See Subtitles app');
});
