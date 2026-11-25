const express = require('express');
const { one, all, run } = require('../../db');
const { validator } = require('../../utils/validate');
const { notFound, conflict } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const { createInvitation } = require('../../services/invitations');
const { sendMail } = require('../../services/mailer');

const router = express.Router();

const SELECT = `
  SELECT q.*, c.name AS category_name, u.name AS reviewed_by_name, lr.name AS linked_restaurant_name,
         (SELECT id FROM restaurants r WHERE r.name = q.restaurant_name COLLATE NOCASE LIMIT 1) AS duplicate_restaurant_id
    FROM restaurant_requests q
    LEFT JOIN categories c ON c.id = q.category_id
    LEFT JOIN users u ON u.id = q.reviewed_by
    LEFT JOIN restaurants lr ON lr.id = q.restaurant_id`;

router.get('/', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const items = all(
    `${SELECT} ${status ? 'WHERE q.status = ?' : ''}
      ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END, q.created_at DESC`,
    ...(status ? [status] : [])
  );
  res.json({ items });
});

function getRequest(id) {
  const q = one(`${SELECT} WHERE q.id = ?`, Number(id));
  if (!q) throw notFound('Application not found');
  return q;
}

router.get('/:id', (req, res) => res.json({ request: getRequest(req.params.id) }));

/**
 * Approve by linking the application to a restaurant that already exists.
 * (Approving as a NEW restaurant goes through POST /admin/restaurants with request_id.)
 */
router.post('/:id/approve-link', async (req, res) => {
  const q = getRequest(req.params.id);
  if (q.status !== 'pending') throw conflict('This application has already been reviewed');
  const v = validator(req.body);
  const restaurantId = v.int('restaurant_id', { required: true, min: 1 });
  const replace = v.bool('replace_owner') === true;
  v.done();
  const r = one('SELECT * FROM restaurants WHERE id = ?', restaurantId);
  if (!r) throw notFound('Restaurant not found');
  // Send the invitation first: if the owner cannot be invited, the application stays pending
  const invitation = await createInvitation(req, { restaurantId, email: q.email, replaceOwner: replace, requestId: q.id });
  run(
    `UPDATE restaurant_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), restaurant_id = ? WHERE id = ?`,
    req.user.id, restaurantId, q.id
  );
  audit(req, 'request.approve', 'restaurant_request', q.id, { restaurant_name: q.restaurant_name, mode: 'linked_existing', restaurant_id: restaurantId, email: q.email });
  await sendMail({
    to: q.email, subject: 'Your UniBite application was approved', title: 'Application approved',
    paragraphs: [`Your application was approved and linked to ${r.name} on UniBite.`, 'You will receive a separate email with a link to activate your owner account.'],
  }).catch(() => {});
  res.json({ ok: true, invitation });
});

router.post('/:id/reject', async (req, res) => {
  const q = getRequest(req.params.id);
  if (q.status !== 'pending') throw conflict('This application has already been reviewed');
  const note = validator(req.body).string('note', { max: 300 });
  run(
    `UPDATE restaurant_requests SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`,
    note ?? null, req.user.id, q.id
  );
  audit(req, 'request.reject', 'restaurant_request', q.id, { restaurant_name: q.restaurant_name, note });
  await sendMail({
    to: q.email, subject: 'Update on your UniBite application', title: 'Application not approved',
    paragraphs: [`Thank you for your interest in bringing ${q.restaurant_name} to UniBite. Unfortunately, we are unable to approve your application at this time.`, ...(note ? [`Reason: ${note}`] : [])],
  }).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
