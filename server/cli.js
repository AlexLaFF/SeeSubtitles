#!/usr/bin/env node
'use strict';
// Admin CLI:  node server/cli.js add-user <email> [password]
//             node server/cli.js set-password <email> <password>
//             node server/cli.js list-users
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
    case 'list-users':
      for (const u of db.all('SELECT id, email, created_at FROM users ORDER BY id')) console.log(`#${u.id}  ${u.email}  ${new Date(u.created_at).toISOString()}`);
      break;
    default:
      console.log('usage: cli.js add-user <email> [password] | set-password <email> <password> | list-users');
      process.exit(1);
  }
} catch (err) {
  console.error('✘', err.message);
  process.exit(1);
} finally {
  db.close();
}
