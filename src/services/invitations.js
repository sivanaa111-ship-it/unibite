/**
 * Restaurant owner invitations: unique, single-use, time-limited tokens (only the SHA-256
 * hash is stored). Only the Super Admin can issue, resend or revoke them.
 */
const { one, run } = require('../db');
const { TTL } = require('../config');
const tokens = require('./tokens');
const { sendMail } = require('./mailer');
const { conflict, notFound } = require('../utils/errors');
const link = require('../utils/links');

/** Validate that `email` can become the owner of `restaurantId`. */
function assertInvitable(restaurantId, email, replaceOwner) {
  const r = one('SELECT * FROM restaurants WHERE id = ?', restaurantId);
  if (!r) throw notFound('Restaurant not found');
  const user = one(
    `SELECT u.*, ru.restaurant_id FROM users u
       LEFT JOIN restaurant_users ru ON ru.user_id = u.id AND ru.status = 'active' WHERE u.email = ?`, email
  );
  if (user && user.role !== 'restaurant') throw conflict('This email belongs to a student or administrator account. Use a different email for the restaurant owner.');
  if (user && user.restaurant_id && user.restaurant_id !== restaurantId) throw conflict('This email already manages another restaurant.');
  const owner = one(
    `SELECT u.email FROM restaurant_users ru JOIN users u ON u.id = ru.user_id
      WHERE ru.restaurant_id = ? AND ru.status = 'active' AND ru.assigned_role = 'owner'`, restaurantId
  );
  if (owner && owner.email.toLowerCase() === email.toLowerCase()) throw conflict('This person is already the owner of this restaurant.');
  if (owner && !replaceOwner) throw conflict(`This restaurant already has an owner (${owner.email}). Choose "Replace current owner" to invite someone else.`, { replace_owner: 'Required to replace the current owner' });
  return r;
}

async function createInvitation(req, { restaurantId, email, replaceOwner = false, requestId = null }) {
  const r = assertInvitable(restaurantId, email, replaceOwner);
  const token = tokens.newToken();
  // Only one live invitation per restaurant
  run(`UPDATE restaurant_invitations SET status = 'revoked' WHERE restaurant_id = ? AND status = 'pending'`, restaurantId);
  const { lastInsertRowid } = run(
    `INSERT INTO restaurant_invitations (restaurant_id, email, token_hash, replace_owner, request_id, expires_at, invited_by)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?)`,
    restaurantId, email, tokens.hash(token), replaceOwner ? 1 : 0, requestId, `+${TTL.invitation} minutes`, req.user.id
  );
  await sendMail({
    to: email,
    subject: `You're invited to manage ${r.name} on UniBite`,
    title: `Manage ${r.name} on UniBite`,
    paragraphs: [
      `The UniBite team has invited you to become the owner account for ${r.name}.`,
      'Open the link below to create your password and activate your account. The link works once and expires in 72 hours.',
    ],
    action: { label: 'Activate your account', url: link(req, `/accept-invite.html?token=${token}`) },
  });
  return one('SELECT id, restaurant_id, email, status, expires_at, created_at FROM restaurant_invitations WHERE id = ?', lastInsertRowid);
}

module.exports = { createInvitation, assertInvitable };
