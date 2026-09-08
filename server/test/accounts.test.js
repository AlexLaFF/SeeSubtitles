'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDb } = require('../lib/db');
const { createAuth, createLimiter, verifyPassword } = require('../lib/auth');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-'));
  const db = openDb(root);
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { db, auth: createAuth(db) };
}

test('passwords are stored as salted scrypt hashes and verified in constant time', (t) => {
  const { db, auth } = fixture(t);
  const u = auth.addUser('A@Example.com', 'correct horse');
  const row = db.get('SELECT * FROM users WHERE id = ?', u.id);
  assert.equal(row.email, 'a@example.com');
  assert.match(row.pass_hash, /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(row.role, 'user');
  assert.ok(verifyPassword('correct horse', row.pass_hash));
  assert.ok(!verifyPassword('wrong', row.pass_hash));
  assert.ok(auth.login('a@example.com', 'correct horse', 'cookie'));
  assert.equal(auth.login('a@example.com', 'nope', 'cookie'), null);
  assert.throws(() => auth.addUser('b@example.com', 'short'), /at least 8/);
});

test('sign-up modes: closed refuses, invite needs an unused code, open accepts; roles can be set', (t) => {
  const { db, auth } = fixture(t);
  assert.throws(() => auth.signup('x@example.com', 'password123', { mode: 'closed' }), /closed/);
  assert.throws(() => auth.signup('x@example.com', 'password123', { mode: 'invite', invite: 'nope' }), /invite code/);
  const code = auth.createInvite(null);
  const u = auth.signup('x@example.com', 'password123', { mode: 'invite', invite: code });
  assert.equal(db.get('SELECT used_by FROM invites WHERE code = ?', code).used_by, u.id);
  assert.throws(() => auth.signup('y@example.com', 'password123', { mode: 'invite', invite: code }), /already used/);
  assert.throws(() => auth.signup('x@example.com', 'password123', { mode: 'open' }), /already exists/);
  assert.ok(auth.signup('z@example.com', 'password123', { mode: 'open' }));
  auth.setRole('z@example.com', 'admin');
  assert.equal(db.get('SELECT role FROM users WHERE email = ?', 'z@example.com').role, 'admin');
  assert.throws(() => auth.setRole('z@example.com', 'god'), /role/);
});

test('the attempt limiter blocks the 21st try in a window and keys are independent', () => {
  const lim = createLimiter({ max: 20, windowMs: 60_000 });
  for (let i = 0; i < 20; i++) assert.ok(lim.allow('ip:1'));
  assert.ok(!lim.allow('ip:1'));
  assert.ok(lim.allow('ip:2'));
});

test('opening an older database adds the users.role column without losing rows', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(path.join(root, 'platform.sqlite'));
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL); INSERT INTO users(email, pass_hash, created_at) VALUES ('old@example.com', 'x', 1)");
  old.close();
  const db = openDb(root);
  try {
    const row = db.get('SELECT email, role FROM users');
    assert.equal(row.email, 'old@example.com');
    assert.equal(row.role, 'user');
  } finally { db.close(); }
});
