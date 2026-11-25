const bcrypt = require('bcryptjs');
const { one, run } = require('./index');

/**
 * First-boot provisioning: if no Super Admin exists and ADMIN_EMAIL / ADMIN_PASSWORD are set
 * in the server environment, create it. Never creates a second admin.
 * (Interactive alternative: `npm run admin:create`.)
 */
function ensureAdmin() {
  if (one(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('No Super Admin exists yet. Run `npm run admin:create` (or set ADMIN_EMAIL and ADMIN_PASSWORD) to provision one.');
    return;
  }
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  run(
    `INSERT INTO users (name, email, password_hash, role, status, email_verified_at) VALUES (?, ?, ?, 'admin', 'active', datetime('now'))`,
    process.env.ADMIN_NAME || 'UniBite Super Admin', email.toLowerCase(), bcrypt.hashSync(password, 12)
  );
  console.log(`Provisioned Super Admin ${email}. Remove ADMIN_PASSWORD from the environment now.`);
}

module.exports = { ensureAdmin };
