'use strict';
// The test accounts, made straight in a throwaway server's database the way the server's own tests make them.
// Used by harness.mjs on this Mac and, inside the test image on the server, by real-on-server.sh:
//   DATA_DIR=/tmp/data E2E_PASSWORD=… node accounts.cjs [path/to/server]
const path = require('node:path');

const ACCOUNTS = { owner: 'owner@e2e.test', business: 'business@e2e.test', hobby: 'hobby@e2e.test', spent: 'spent@e2e.test', secure: 'secure@e2e.test' };

/** @returns {{totpSecret: string}} the two-factor secret of the `secure` account, for whoever must produce its codes */
function createAccounts(dataDir, password, serverDir) {
  const { openDb } = require(path.join(serverDir, 'lib', 'db.js'));
  const { createAuth } = require(path.join(serverDir, 'lib', 'auth.js'));
  const totp = require(path.join(serverDir, 'lib', 'totp.js'));
  const db = openDb(dataDir);
  const auth = createAuth(db);
  for (const email of Object.values(ACCOUNTS)) auth.addUser(email, password);
  auth.setRole(ACCOUNTS.owner, 'admin');
  db.run("UPDATE users SET plan = 'business' WHERE email IN (?, ?)", ACCOUNTS.business, ACCOUNTS.secure);
  const id = (email) => db.get('SELECT id FROM users WHERE email = ?', email).id;
  // a Hobbyist whose ten live hours are gone
  db.run('INSERT INTO usage(user_id, month, live_seconds, file_seconds) VALUES (?,?,?,0)', id(ACCOUNTS.spent), new Date().toISOString().slice(0, 7), 10 * 3600);
  // two-factor on, the way a person turns it on: begin, then confirm with a code from the secret
  const { secret } = auth.beginTotp(id(ACCOUNTS.secure));
  auth.confirmTotp(id(ACCOUNTS.secure), totp.codeFor(secret));
  db.close();
  return { totpSecret: secret };
}

module.exports = { ACCOUNTS, createAccounts };

if (require.main === module) {
  const dataDir = process.env.DATA_DIR;
  const password = process.env.E2E_PASSWORD;
  if (!dataDir || !password) { console.error('DATA_DIR and E2E_PASSWORD are needed'); process.exit(2); }
  createAccounts(dataDir, password, path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'server')));
  console.log(`accounts: ${Object.values(ACCOUNTS).join(', ')}`);
}
