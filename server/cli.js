#!/usr/bin/env node
'use strict';
// Admin CLI:  node server/cli.js add-user <email> [password]
//             node server/cli.js set-password <email> <password>
//             node server/cli.js set-role <email> admin|user
//             node server/cli.js list-users
//             node server/cli.js add-invite [count]        (codes for SIGNUP_MODE=invite)
//             node server/cli.js list-invites
const path = require('node:path');
const crypto = require('node:crypto');
const { loadEnv } = require('@subs/core');
const { openDb } = require('./lib/db');
const { createAuth } = require('./lib/auth');

loadEnv(path.join(__dirname, '..', '.env'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const db = openDb(DATA_DIR);
const auth = createAuth(db);
const [cmd, a, b] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'add-user': {
      const password = b || crypto.randomBytes(9).toString('base64url');
      const u = auth.addUser(a, password);
      console.log(`user ${u.email} (#${u.id}) created${b ? '' : `, password: ${password}`}`);
      break;
    }
    case 'set-password':
      auth.setPassword(a, b);
      console.log(`password updated for ${a}`);
      break;
    case 'set-role':
      auth.setRole(a, b);
      console.log(`${a} is now ${b}`);
      break;
    case 'list-users':
      for (const u of db.all('SELECT id, email, role, created_at FROM users ORDER BY id')) console.log(`#${u.id}  ${u.email}  ${u.role}  ${new Date(u.created_at).toISOString()}`);
      break;
    case 'add-invite': {
      const n = Math.min(100, Math.max(1, Number(a) || 1));
      for (let i = 0; i < n; i++) console.log(auth.createInvite(null));
      break;
    }
    case 'list-invites':
      for (const i of db.all('SELECT code, created_at, used_by, used_at FROM invites ORDER BY created_at')) console.log(`${i.code}  ${i.used_at ? `used by #${i.used_by} ${new Date(i.used_at).toISOString()}` : 'unused'}`);
      break;
    default:
      console.log('usage: cli.js add-user <email> [password] | set-password <email> <password> | set-role <email> admin|user | list-users | add-invite [count] | list-invites');
      process.exit(1);
  }
} catch (err) {
  console.error('✘', err.message);
  process.exit(1);
} finally {
  db.close();
}
