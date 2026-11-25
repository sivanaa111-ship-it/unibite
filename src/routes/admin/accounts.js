/** Manage Restaurant Accounts + invitations (Super Admin only). */
const express = require('express');
const { one, all, run, tx } = require('../../db');
const { validator } = require('../../utils/validate');
const { notFound, conflict } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const { createInvitation } = require('../../services/invitations');
const tokens = require('../../services/tokens');
const { sendMail } = require('../../services/mailer');
const serialize = require('../../utils/serialize');
const link = require('../../utils/links');

const router = express.Router();

const ACCOUNT_SELECT = `
  SELECT u.*, ru.restaurant_id, ru.assigned_role AS staff_role, r.name AS restaurant_name, r.is_active AS restaurant_active
    FROM users u
    LEFT JOIN restaurant_users ru ON ru.user_id = u.id AND ru.status = 'active'
    LEFT JOIN restaurants r ON r.id = ru.restaurant_id`;

router.get('/restaurant-accounts', (req, res) => {
  const where = [`u.role = 'restaurant'`];
  const params = [];
  if (req.query.q) { where.push('(u.name LIKE ? OR u.email LIKE ? OR r.name LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
  if (['active', 'deactivated'].includes(req.query.status)) { where.push('u.status = ?'); params.push(req.query.status); }
  if (req.query.restaurant) { where.push('ru.restaurant_id = ?'); params.push(Number(req.query.restaurant)); }
  const items = all(`${ACCOUNT_SELECT} WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT 200`, ...params).map(serialize.user);
  res.json({ items });
});

router.get('/invitations', (req, res) => {
  const status = req.query.status || 'pending';
  const items = all(
    `SELECT i.id, i.restaurant_id, i.email, i.replace_owner, i.expires_at, i.created_at, i.accepted_at, r.name AS restaurant_name,
            u.name AS invited_by_name,
            CASE WHEN i.status = 'pending' AND i.expires_at <= datetime('now') THEN 'expired' ELSE i.status END AS status
       FROM restaurant_invitations i JOIN restaurants r ON r.id = i.restaurant_id LEFT JOIN users u ON u.id = i.invited_by
      ${status === 'all' ? '' : `WHERE (CASE WHEN i.status = 'pending' AND i.expires_at <= datetime('now') THEN 'expired' ELSE i.status END) = ?`}
      ORDER BY i.id DESC LIMIT 200`,
    ...(status === 'all' ? [] : [status])
  );
  res.json({ items });
});

function getInvitation(id) {
  const i = one('SELECT * FROM restaurant_invitations WHERE id = ?', Number(id));
  if (!i) throw notFound('Invitation not found');
  return i;
}

/** Resend = revoke the old link and issue a fresh one (new token, new expiry). */
router.post('/invitations/:id/resend', async (req, res) => {
  const i = getInvitation(req.params.id);
  if (i.status === 'accepted') throw conflict('This invitation was already accepted');
  const invitation = await createInvitation(req, { restaurantId: i.restaurant_id, email: i.email, replaceOwner: !!i.replace_owner, requestId: i.request_id });
  audit(req, 'invitation.resend', 'restaurant', i.restaurant_id, { email: i.email });
  res.json({ invitation });
});

router.post('/invitations/:id/revoke', (req, res) => {
  const i = getInvitation(req.params.id);
  if (i.status !== 'pending') throw conflict('Only pending invitations can be revoked');
  run(`UPDATE restaurant_invitations SET status = 'revoked' WHERE id = ?`, i.id);
  audit(req, 'invitation.revoke', 'restaurant', i.restaurant_id, { email: i.email });
  res.json({ ok: true });
});

function getAccount(id) {
  const u = one(`${ACCOUNT_SELECT} WHERE u.id = ? AND u.role = 'restaurant'`, Number(id));
  if (!u) throw notFound('Restaurant account not found');
  return u;
}

router.post('/restaurant-accounts/:id/deactivate', (req, res) => {
  const u = getAccount(req.params.id);
  if (u.status === 'deactivated') throw conflict('Account is already deactivated');
  run(`UPDATE users SET status = 'deactivated', token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`, u.id);
  audit(req, 'account.deactivate', 'user', u.id, { email: u.email, role: 'restaurant', restaurant: u.restaurant_name, before: { status: u.status }, after: { status: 'deactivated' } });
  res.json({ user: serialize.user(getAccount(u.id)) });
});

router.post('/restaurant-accounts/:id/reactivate', (req, res) => {
  const u = getAccount(req.params.id);
  if (u.status === 'active') throw conflict('Account is already active');
  run(`UPDATE users SET status = 'active', updated_at = datetime('now') WHERE id = ?`, u.id);
  audit(req, 'account.reactivate', 'user', u.id, { email: u.email, role: 'restaurant', before: { status: u.status }, after: { status: 'active' } });
  res.json({ user: serialize.user(getAccount(u.id)) });
});

/** Move an owner account to another restaurant (which must not already have an owner). */
router.post('/restaurant-accounts/:id/reassign', (req, res) => {
  const u = getAccount(req.params.id);
  const v = validator(req.body);
  const restaurantId = v.int('restaurant_id', { required: true, min: 1 });
  v.done();
  const r = one('SELECT * FROM restaurants WHERE id = ?', restaurantId);
  if (!r) throw notFound('Restaurant not found');
  if (u.restaurant_id === restaurantId) throw conflict('The account is already assigned to this restaurant');
  const owner = one(`SELECT user_id FROM restaurant_users WHERE restaurant_id = ? AND status = 'active' AND assigned_role = 'owner'`, restaurantId);
  if (owner) throw conflict(`${r.name} already has an owner. Deactivate or reassign that account first.`);
  tx(() => {
    run(`UPDATE restaurant_users SET status = 'removed', updated_at = datetime('now') WHERE user_id = ? AND status = 'active'`, u.id);
    run(`INSERT INTO restaurant_users (user_id, restaurant_id, assigned_role) VALUES (?, ?, 'owner')`, u.id, restaurantId);
    run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', u.id); // sign out of the old restaurant
    audit(req, 'account.reassign', 'user', u.id, {
      email: u.email,
      before: { restaurant_id: u.restaurant_id, restaurant: u.restaurant_name },
      after: { restaurant_id: restaurantId, restaurant: r.name },
    });
  });
  res.json({ user: serialize.user(getAccount(u.id)) });
});

/** Unlink an owner from their restaurant without deactivating the login. */
router.post('/restaurant-accounts/:id/unassign', (req, res) => {
  const u = getAccount(req.params.id);
  if (!u.restaurant_id) throw conflict('This account is not assigned to a restaurant');
  run(`UPDATE restaurant_users SET status = 'removed', updated_at = datetime('now') WHERE user_id = ? AND status = 'active'`, u.id);
  run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', u.id);
  audit(req, 'account.unassign', 'user', u.id, { email: u.email, before: { restaurant: u.restaurant_name }, after: { restaurant: null } });
  res.json({ user: serialize.user(getAccount(u.id)) });
});

/** Secure access reset: signs the account out everywhere and emails a single-use reset link. */
router.post('/restaurant-accounts/:id/reset-access', async (req, res) => {
  const u = getAccount(req.params.id);
  if (u.status !== 'active') throw conflict('Reactivate the account before resetting access');
  run(`UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`, u.id);
  const token = tokens.issue('password_reset', u.id, req.user.id);
  await sendMail({
    to: u.email, subject: 'Reset your UniBite password', title: 'Your account access was reset',
    paragraphs: ['A UniBite administrator reset access to your restaurant account. Choose a new password using the link below. It expires in 60 minutes and works once.'],
    action: { label: 'Choose a new password', url: link(req, `/reset-password.html?token=${token}`) },
  });
  audit(req, 'account.reset_access', 'user', u.id, { email: u.email });
  res.json({ ok: true });
});

module.exports = router;
