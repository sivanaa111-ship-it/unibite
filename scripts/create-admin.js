#!/usr/bin/env node
/**
 * Server-side Super Admin provisioning. Run on the server: `npm run admin:create`
 *  - If no Super Admin exists, creates the first one.
 *  - If one already exists, a new admin can only be added with the existing Super Admin's
 *    email + password (and 2FA code if enabled) as explicit authorization.
 * There is no HTTP endpoint for creating administrators.
 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { one, run } = require('../src/db');
const totp = require('../src/services/totp');

function ask(q, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = function (s) { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

(async () => {
  const existing = one(`SELECT COUNT(*) n FROM users WHERE role = 'admin' AND status = 'active'`).n;
  if (existing) {
    console.log('A Super Admin already exists. Adding another administrator requires authorization from the existing Super Admin.\n');
    const aEmail = (await ask('Existing Super Admin email: ')).toLowerCase();
    const aPass = await ask('Existing Super Admin password: ', { hidden: true });
    const admin = one(`SELECT * FROM users WHERE email = ? AND role = 'admin' AND status = 'active'`, aEmail);
    if (!admin || !bcrypt.compareSync(aPass, admin.password_hash)) { console.error('Authorization failed.'); process.exit(1); }
    if (admin.totp_enabled) {
      const code = await ask('Existing Super Admin 2FA code: ');
      if (!totp.verify(admin.totp_secret, code)) { console.error('Authorization failed.'); process.exit(1); }
    }
  }
  const name = await ask('New admin full name: ');
  const email = (await ask('New admin email: ')).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error('Invalid email.'); process.exit(1); }
  if (one('SELECT id FROM users WHERE email = ?', email)) { console.error('An account with this email already exists.'); process.exit(1); }
  const p1 = await ask('Password (min 12 chars, letters + numbers): ', { hidden: true });
  const p2 = await ask('Confirm password: ', { hidden: true });
  if (p1 !== p2) { console.error('Passwords do not match.'); process.exit(1); }
  if (p1.length < 12 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) { console.error('Password too weak.'); process.exit(1); }
  const { lastInsertRowid } = run(
    `INSERT INTO users (name, email, password_hash, role, status, email_verified_at) VALUES (?, ?, ?, 'admin', 'active', datetime('now'))`,
    name || 'UniBite Super Admin', email, bcrypt.hashSync(p1, 12)
  );
  run(`INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, details) VALUES (NULL, 'admin.provision', 'user', ?, ?)`,
    lastInsertRowid, JSON.stringify({ email, via: 'cli' }));
  console.log(`\nSuper Admin ${email} created. Sign in at /admin/login and enable two-factor authentication under Security.`);
})();
