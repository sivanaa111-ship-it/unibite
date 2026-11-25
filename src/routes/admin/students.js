/** Manage Students (Super Admin only). Passwords and auth secrets are never returned. */
const express = require('express');
const { one, all, run } = require('../../db');
const { notFound, conflict } = require('../../utils/errors');
const { audit } = require('../../utils/audit');

const router = express.Router();

const SELECT = `
  SELECT u.id, u.name, u.email, u.status, u.email_verified_at, u.last_login_at, u.created_at,
         sp.university_id, sp.verification_status, sp.verified_at,
         (SELECT COUNT(*) FROM orders o WHERE o.student_id = u.id) AS order_count,
         (SELECT COUNT(*) FROM ratings rt WHERE rt.student_id = u.id) AS rating_count
    FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id`;

router.get('/', (req, res) => {
  const where = [`u.role = 'student'`];
  const params = [];
  if (req.query.q) { where.push('(u.name LIKE ? OR u.email LIKE ? OR sp.university_id LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
  if (['pending', 'active', 'deactivated'].includes(req.query.status)) { where.push('u.status = ?'); params.push(req.query.status); }
  if (['verified', 'unverified'].includes(req.query.verification)) { where.push('sp.verification_status = ?'); params.push(req.query.verification); }
  const w = `WHERE ${where.join(' AND ')}`;
  const order = req.query.sort === 'oldest' ? 'u.created_at ASC' : req.query.sort === 'name' ? 'u.name COLLATE NOCASE' : 'u.created_at DESC';
  const size = 15;
  const total = one(`SELECT COUNT(*) n FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id ${w}`, ...params).n;
  const pages = Math.max(Math.ceil(total / size), 1);
  const page = Math.min(Math.max(Number(req.query.page) || 1, 1), pages);
  const items = all(`${SELECT} ${w} ORDER BY ${order}, u.id DESC LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size);
  res.json({ items, total, page, pages });
});

function getStudent(id) {
  const s = one(`${SELECT} WHERE u.id = ? AND u.role = 'student'`, Number(id));
  if (!s) throw notFound('Student not found');
  return s;
}

router.get('/:id', (req, res) => {
  const s = getStudent(req.params.id);
  const recent = all(
    `SELECT o.id, o.status, o.total, o.created_at, r.name AS restaurant_name
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.student_id = ? ORDER BY o.id DESC LIMIT 10`, s.id
  );
  res.json({ student: s, recent_orders: recent });
});

router.post('/:id/deactivate', (req, res) => {
  const s = getStudent(req.params.id);
  if (s.status === 'deactivated') throw conflict('Account is already deactivated');
  run(`UPDATE users SET status = 'deactivated', token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`, s.id);
  audit(req, 'account.deactivate', 'user', s.id, { email: s.email, role: 'student', before: { status: s.status }, after: { status: 'deactivated' } });
  res.json({ student: getStudent(s.id) });
});

/** Activate: re-enables a deactivated account, or manually activates one stuck awaiting email verification. */
router.post('/:id/activate', (req, res) => {
  const s = getStudent(req.params.id);
  if (s.status === 'active') throw conflict('Account is already active');
  run(
    `UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`, s.id
  );
  audit(req, 'account.activate', 'user', s.id, { email: s.email, role: 'student', before: { status: s.status }, after: { status: 'active' } });
  res.json({ student: getStudent(s.id) });
});

/** Mark a University ID as checked against official records. */
router.post('/:id/verify-id', (req, res) => {
  const s = getStudent(req.params.id);
  if (s.verification_status === 'verified') throw conflict('University ID is already verified');
  run(`UPDATE student_profiles SET verification_status = 'verified', verified_at = datetime('now') WHERE user_id = ?`, s.id);
  audit(req, 'student.verify_id', 'user', s.id, { email: s.email, university_id: s.university_id, before: { verification_status: 'unverified' }, after: { verification_status: 'verified' } });
  res.json({ student: getStudent(s.id) });
});

module.exports = router;
