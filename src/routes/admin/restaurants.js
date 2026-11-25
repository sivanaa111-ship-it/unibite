const express = require('express');
const { one, all, run, tx } = require('../../db');
const { upload, publicPath, removeUpload } = require('../../middleware/upload');
const { validator } = require('../../utils/validate');
const { badRequest, notFound, conflict } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const restaurants = require('../../services/restaurants');
const orders = require('../../services/orders');
const { createInvitation } = require('../../services/invitations');
const { sendMail } = require('../../services/mailer');
const serialize = require('../../utils/serialize');

const router = express.Router();
const images = upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover_image', maxCount: 1 }]);
const EDITABLE = ['name', 'description', 'category_id', 'campus_location', 'contact_phone', 'email', 'opening_time', 'closing_time', 'operating_days', 'availability_status'];

router.get('/', (req, res) => {
  const { q, category, status, availability, account, sort, page, pageSize } = req.query;
  res.json(restaurants.list({ search: q, categoryId: category, status, availability, account, sort, page, pageSize: pageSize || 10, scope: 'admin' }));
});

router.get('/:id', (req, res) => {
  const r = restaurants.getById(Number(req.params.id), { includeInactive: true });
  if (!r) throw notFound('Restaurant not found');
  const accounts = all(
    `SELECT u.id, u.name, u.email, u.status, u.last_login_at, ru.assigned_role, ru.status AS association_status, ru.created_at AS assigned_at
       FROM restaurant_users ru JOIN users u ON u.id = ru.user_id
      WHERE ru.restaurant_id = ? ORDER BY ru.status = 'active' DESC, ru.id DESC`, r.id
  );
  const invitations = all(
    `SELECT id, email, status, replace_owner, expires_at, created_at, accepted_at,
            CASE WHEN status = 'pending' AND expires_at <= datetime('now') THEN 'expired' ELSE status END AS effective_status
       FROM restaurant_invitations WHERE restaurant_id = ? ORDER BY id DESC LIMIT 10`, r.id
  );
  const stats = one(
    `SELECT COUNT(*) AS total_orders,
            COALESCE(SUM(CASE WHEN status='completed' THEN total END),0) AS revenue,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_orders,
            SUM(CASE WHEN status IN ('pending','accepted','preparing','ready') THEN 1 ELSE 0 END) AS open_orders
       FROM orders WHERE restaurant_id = ?`, r.id
  );
  stats.menu_items = one('SELECT COUNT(*) n FROM products WHERE restaurant_id = ? AND is_active = 1', r.id).n;
  const creator = r.created_by ? one('SELECT name FROM users WHERE id = ?', r.created_by) : null;
  const recentOrders = orders.hydrate(all(`${orders.ORDER_SELECT} WHERE o.restaurant_id = ? ORDER BY o.id DESC LIMIT 20`, r.id));
  res.json({ restaurant: { ...r, created_by_name: creator && creator.name }, accounts, invitations, stats, recent_orders: recentOrders });
});

function readFields(req, partial) {
  const v = validator(req.body, { partial });
  const d = {
    name: v.string('name', { required: true, min: 2, max: 120 }),
    description: v.string('description', { required: true, min: 10, max: 1000 }),
    category_id: v.int('category_id', { required: true, min: 1 }),
    campus_location: v.string('campus_location', { required: true, max: 160 }),
    contact_phone: v.phone('contact_phone', { required: true }),
    email: v.email('email', { required: true }),
    opening_time: v.time('opening_time', { required: true }),
    closing_time: v.time('closing_time', { required: true }),
    operating_days: v.days('operating_days', { required: true }),
    availability_status: v.oneOf('availability_status', ['open', 'busy', 'closed'], { required: true }),
  };
  if (d.category_id && !one('SELECT id FROM categories WHERE id = ? AND is_active = 1', d.category_id)) {
    v.fail('category_id', 'Choose an active category');
  }
  return { v, d };
}

/** Restaurant names are unique across ALL records (deactivated ones are reactivated, not duplicated). */
function assertUniqueName(name, exceptId = 0) {
  const dup = one('SELECT id, is_active FROM restaurants WHERE name = ? COLLATE NOCASE AND id <> ?', name, exceptId);
  if (dup) {
    throw badRequest(
      dup.is_active ? 'A restaurant with this name already exists' : 'A deactivated restaurant with this name already exists. Reactivate it instead of creating a duplicate.',
      { name: 'Name already in use' }
    );
  }
}

const cleanupFiles = (req) => { for (const f of Object.values(req.files || {}).flat()) removeUpload(`/uploads/${f.filename}`); };

router.post('/', images, async (req, res) => {
  let created;
  try {
    const { v, d } = readFields(req, false);
    const publish = v.bool('publish') !== false;
    const inviteEmail = v.email('invite_email');
    const requestId = v.int('request_id', { min: 1 });
    v.done();
    assertUniqueName(d.name);
    let request = null;
    if (requestId) {
      request = one(`SELECT * FROM restaurant_requests WHERE id = ?`, requestId);
      if (!request || request.status !== 'pending') throw conflict('This application has already been reviewed.');
    }
    const logo = publicPath(req.files?.logo?.[0]);
    const cover = publicPath(req.files?.cover_image?.[0]);

    created = tx(() => {
      const { lastInsertRowid: rid } = run(
        `INSERT INTO restaurants (name, description, logo, cover_image, category_id, campus_location, contact_phone, email,
                                  opening_time, closing_time, operating_days, availability_status, created_by, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${publish ? "datetime('now')" : 'NULL'})`,
        d.name, d.description, logo ?? null, cover ?? null, d.category_id, d.campus_location, d.contact_phone,
        d.email, d.opening_time, d.closing_time, d.operating_days, d.availability_status, req.user.id
      );
      if (request) {
        run(
          `UPDATE restaurant_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), restaurant_id = ? WHERE id = ?`,
          req.user.id, rid, request.id
        );
        audit(req, 'request.approve', 'restaurant_request', request.id, { restaurant_name: d.name, mode: 'new_restaurant', restaurant_id: Number(rid) });
      }
      audit(req, 'restaurant.create', 'restaurant', rid, { name: d.name, published: publish, after: { ...d, published: publish } });
      return Number(rid);
    });
  } catch (err) {
    cleanupFiles(req);
    throw err;
  }

  // Owner invitation (from the form, or the applicant's email when approving an application)
  const reqRow = req.body.request_id ? one('SELECT * FROM restaurant_requests WHERE id = ?', Number(req.body.request_id)) : null;
  const email = req.body.invite_email ? String(req.body.invite_email).trim().toLowerCase() : reqRow?.email;
  let invitation = null;
  let inviteError = null;
  if (email) {
    try {
      invitation = await createInvitation(req, { restaurantId: created, email, requestId: reqRow?.id ?? null });
      audit(req, 'invitation.send', 'restaurant', created, { email });
    } catch (err) { inviteError = err.message; }
  }
  if (reqRow) {
    await sendMail({
      to: reqRow.email, subject: 'Your UniBite application was approved', title: 'Application approved',
      paragraphs: [`Great news: ${reqRow.restaurant_name} has been approved on UniBite.`, invitation ? 'You will receive a separate email with a link to activate your owner account.' : 'The UniBite team will contact you to set up your owner account.'],
    }).catch(() => {});
  }
  res.status(201).json({ restaurant: restaurants.getById(created, { includeInactive: true }), invitation, invite_error: inviteError });
});

router.put('/:id', images, (req, res) => {
  try {
    const existing = one('SELECT * FROM restaurants WHERE id = ?', Number(req.params.id));
    if (!existing) throw notFound('Restaurant not found');
    const { v, d } = readFields(req, true);
    v.done();
    if (d.name) assertUniqueName(d.name, existing.id);
    const logo = publicPath(req.files?.logo?.[0]);
    const cover = publicPath(req.files?.cover_image?.[0]);
    const next = { ...existing };
    for (const [k, val] of Object.entries(d)) if (val !== undefined) next[k] = val;
    if (logo) next.logo = logo;
    if (cover) next.cover_image = cover;

    const before = {};
    const after = {};
    for (const k of EDITABLE) if (String(existing[k]) !== String(next[k])) { before[k] = existing[k]; after[k] = next[k]; }
    if (logo) { before.logo = existing.logo; after.logo = logo; }
    if (cover) { before.cover_image = existing.cover_image; after.cover_image = cover; }

    run(
      `UPDATE restaurants SET name=?, description=?, logo=?, cover_image=?, category_id=?, campus_location=?, contact_phone=?,
              email=?, opening_time=?, closing_time=?, operating_days=?, availability_status=?, updated_at=datetime('now')
        WHERE id = ?`,
      next.name, next.description, next.logo, next.cover_image, next.category_id, next.campus_location, next.contact_phone,
      next.email, next.opening_time, next.closing_time, next.operating_days, next.availability_status, existing.id
    );
    if (logo && existing.logo) removeUpload(existing.logo);
    if (cover && existing.cover_image) removeUpload(existing.cover_image);
    if (Object.keys(after).length) audit(req, 'restaurant.update', 'restaurant', existing.id, { name: next.name, before, after });
    res.json({ restaurant: restaurants.getById(existing.id, { includeInactive: true }) });
  } catch (err) {
    cleanupFiles(req);
    throw err;
  }
});

function getRow(req) {
  const r = one('SELECT * FROM restaurants WHERE id = ?', Number(req.params.id));
  if (!r) throw notFound('Restaurant not found');
  return r;
}

router.post('/:id/publish', (req, res) => {
  const r = getRow(req);
  if (r.published_at) throw conflict('This restaurant is already published');
  run(`UPDATE restaurants SET published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, r.id);
  audit(req, 'restaurant.publish', 'restaurant', r.id, { name: r.name, before: { published: false }, after: { published: true } });
  res.json({ restaurant: restaurants.getById(r.id, { includeInactive: true }) });
});

router.post('/:id/unpublish', (req, res) => {
  const r = getRow(req);
  if (!r.published_at) throw conflict('This restaurant is not published');
  run(`UPDATE restaurants SET published_at = NULL, updated_at = datetime('now') WHERE id = ?`, r.id);
  audit(req, 'restaurant.unpublish', 'restaurant', r.id, { name: r.name, before: { published: true }, after: { published: false } });
  res.json({ restaurant: restaurants.getById(r.id, { includeInactive: true }) });
});

/**
 * Soft delete. The restaurant disappears from public browsing and cannot receive new orders.
 * Its record, menu, orders and ratings are preserved; the owner keeps read-only access and
 * can finish orders that were already placed.
 */
router.post('/:id/deactivate', (req, res) => {
  const r = getRow(req);
  if (!r.is_active) throw conflict('This restaurant is already deactivated');
  const reason = validator(req.body).string('reason', { max: 300 });
  run(
    `UPDATE restaurants SET is_active = 0, deactivated_at = datetime('now'), deactivated_by = ?, updated_at = datetime('now') WHERE id = ?`,
    req.user.id, r.id
  );
  const open = one(`SELECT COUNT(*) n FROM orders WHERE restaurant_id = ? AND status IN ('pending','accepted','preparing','ready')`, r.id).n;
  audit(req, 'restaurant.deactivate', 'restaurant', r.id, { name: r.name, reason, open_orders: open, before: { is_active: true }, after: { is_active: false } });
  res.json({ restaurant: restaurants.getById(r.id, { includeInactive: true }), open_orders: open });
});

router.post('/:id/reactivate', (req, res) => {
  const r = getRow(req);
  if (r.is_active) throw conflict('This restaurant is already active');
  run(`UPDATE restaurants SET is_active = 1, deactivated_at = NULL, deactivated_by = NULL, updated_at = datetime('now') WHERE id = ?`, r.id);
  audit(req, 'restaurant.reactivate', 'restaurant', r.id, { name: r.name, before: { is_active: false }, after: { is_active: true } });
  res.json({ restaurant: restaurants.getById(r.id, { includeInactive: true }) });
});

/** Invite Restaurant Owner */
router.post('/:id/invitations', async (req, res) => {
  const r = getRow(req);
  const v = validator(req.body);
  const email = v.email('email', { required: true });
  const replace = v.bool('replace_owner') === true;
  v.done();
  const invitation = await createInvitation(req, { restaurantId: r.id, email, replaceOwner: replace });
  audit(req, 'invitation.send', 'restaurant', r.id, { name: r.name, email, replace_owner: replace });
  res.status(201).json({ invitation });
});

module.exports = router;
