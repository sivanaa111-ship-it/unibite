const { all, run } = require('../db');

/** In-app notification for every active Super Admin. */
function notifyAdmins(type, title, body, link) {
  for (const a of all(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`)) {
    run('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)', a.id, type, title, body ?? null, link ?? null);
  }
}

const adminEmails = () => all(`SELECT email FROM users WHERE role = 'admin' AND status = 'active'`).map((a) => a.email);

module.exports = { notifyAdmins, adminEmails };
