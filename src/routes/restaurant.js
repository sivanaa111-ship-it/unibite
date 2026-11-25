/**
 * Restaurant Owner API. Every query is scoped to req.user.restaurant_id, which comes from
 * the server-side restaurant_users association — never from the client — so an owner can
 * never read or modify another restaurant's data.
 *
 * Deactivated restaurant: the owner keeps read access and can finish existing orders,
 * but menu, profile and availability changes are refused (requireRestaurantWritable).
 */
const express = require('express');
const { one, all, run, tx } = require('../db');
const { requireRestaurantMember, requireRestaurantWritable } = require('../middleware/auth');
const { upload, publicPath, removeUpload } = require('../middleware/upload');
const { validator } = require('../utils/validate');
const { notFound, conflict, forbidden } = require('../utils/errors');
const restaurants = require('../services/restaurants');
const orders = require('../services/orders');
const serialize = require('../utils/serialize');

const router = express.Router();
router.use(requireRestaurantMember);

const writable = requireRestaurantWritable;
const ownerOnly = (req, _res, next) =>
  req.user.staff_role === 'owner' ? next() : next(forbidden('Only the restaurant owner can do this'));

const myRestaurant = (req) => restaurants.getById(req.user.restaurant_id, { includeInactive: true });
function publicView(r) {
  // Owners see their own restaurant but not admin-only owner/invitation fields
  const { owner_id, owner_email, owner_name, owner_status, pending_invite_email, account_status, ...rest } = r;
  return rest;
}

router.get('/overview', (req, res) => {
  const rid = req.user.restaurant_id;
  const today = one(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status='completed' THEN total END),0) AS revenue
       FROM orders WHERE restaurant_id = ? AND date(created_at) = date('now')`, rid
  );
  const rating = one('SELECT AVG(score) AS avg, COUNT(*) AS n FROM ratings WHERE restaurant_id = ?', rid);
  res.json({
    restaurant: publicView(myRestaurant(req)),
    staff_role: req.user.staff_role,
    stats: {
      today_orders: today.orders,
      today_revenue: today.revenue,
      active_orders: one(`SELECT COUNT(*) n FROM orders WHERE restaurant_id = ? AND status IN ('pending','accepted','preparing','ready')`, rid).n,
      pending_orders: one(`SELECT COUNT(*) n FROM orders WHERE restaurant_id = ? AND status = 'pending'`, rid).n,
      menu_items: one('SELECT COUNT(*) n FROM products WHERE restaurant_id = ? AND is_active = 1', rid).n,
      avg_rating: rating.avg ? Math.round(rating.avg * 10) / 10 : null,
      rating_count: rating.n,
    },
  });
});

/* ---------------- Restaurant information ---------------- */
router.get('/profile', (req, res) => res.json({ restaurant: publicView(myRestaurant(req)) }));

const images = upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover_image', maxCount: 1 }]);

/** Owners may edit: description, contact phone, email, logo, cover. Name, category,
 *  location and hours are managed by the Super Admin. */
router.put('/profile', ownerOnly, writable, images, (req, res) => {
  const cleanup = () => { for (const f of Object.values(req.files || {}).flat()) removeUpload(`/uploads/${f.filename}`); };
  try {
    const v = validator(req.body, { partial: true });
    const d = {
      description: v.string('description', { min: 10, max: 1000 }),
      contact_phone: v.phone('contact_phone'),
      email: v.email('email'),
    };
    v.done();
    const before = one('SELECT * FROM restaurants WHERE id = ?', req.user.restaurant_id);
    const logo = publicPath(req.files?.logo?.[0]);
    const cover = publicPath(req.files?.cover_image?.[0]);
    run(
      `UPDATE restaurants SET description = COALESCE(?, description), contact_phone = COALESCE(?, contact_phone),
              email = COALESCE(?, email), logo = COALESCE(?, logo), cover_image = COALESCE(?, cover_image),
              updated_at = datetime('now') WHERE id = ?`,
      d.description ?? null, d.contact_phone ?? null, d.email ?? null, logo ?? null, cover ?? null, before.id
    );
    if (logo && before.logo) removeUpload(before.logo);
    if (cover && before.cover_image) removeUpload(before.cover_image);
    res.json({ restaurant: publicView(myRestaurant(req)) });
  } catch (err) { cleanup(); throw err; }
});

router.patch('/availability', writable, (req, res) => {
  const v = validator(req.body);
  const status = v.oneOf('availability_status', ['open', 'busy', 'closed'], { required: true });
  v.done();
  run(`UPDATE restaurants SET availability_status = ?, updated_at = datetime('now') WHERE id = ?`, status, req.user.restaurant_id);
  res.json({ restaurant: publicView(myRestaurant(req)) });
});

/* ---------------- Menu ---------------- */
router.get('/products', (req, res) => {
  const items = all(
    `SELECT * FROM products WHERE restaurant_id = ? AND is_active = 1 ORDER BY COALESCE(menu_section,'zzz'), name`,
    req.user.restaurant_id
  ).map(serialize.product);
  const sections = [...new Set(items.map((p) => p.menu_section).filter(Boolean))];
  res.json({ items, sections });
});

function productFields(req, partial) {
  const v = validator(req.body, { partial });
  const data = {
    name: v.string('name', { required: true, max: 100 }),
    description: v.string('description', { max: 500 }),
    price: v.number('price', { required: true, min: 0, max: 10000 }),
    menu_section: v.string('menu_section', { max: 60 }),
    is_available: v.bool('is_available'),
  };
  v.done();
  return data;
}

function ownProduct(req) {
  const p = one('SELECT * FROM products WHERE id = ? AND restaurant_id = ? AND is_active = 1', Number(req.params.id), req.user.restaurant_id);
  if (!p) throw notFound('Menu item not found');
  return p;
}

router.post('/products', ownerOnly, writable, upload.single('image'), (req, res) => {
  const d = productFields(req, false);
  const { lastInsertRowid } = run(
    `INSERT INTO products (restaurant_id, name, description, price, image, menu_section, is_available)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    req.user.restaurant_id, d.name, d.description ?? null, d.price, publicPath(req.file) ?? null,
    d.menu_section ?? null, d.is_available === false ? 0 : 1
  );
  res.status(201).json({ product: serialize.product(one('SELECT * FROM products WHERE id = ?', lastInsertRowid)) });
});

router.put('/products/:id', ownerOnly, writable, upload.single('image'), (req, res) => {
  const p = ownProduct(req);
  const d = productFields(req, true);
  const image = publicPath(req.file);
  const has = (k) => req.body[k] !== undefined;
  run(
    `UPDATE products SET name = ?, description = ?, price = ?, menu_section = ?, image = COALESCE(?, image),
            is_available = ?, updated_at = datetime('now') WHERE id = ?`,
    d.name ?? p.name,
    has('description') ? d.description ?? null : p.description,
    d.price ?? p.price,
    has('menu_section') ? d.menu_section ?? null : p.menu_section,
    image ?? null,
    d.is_available === undefined ? p.is_available : d.is_available ? 1 : 0,
    p.id
  );
  if (image && p.image) removeUpload(p.image);
  res.json({ product: serialize.product(one('SELECT * FROM products WHERE id = ?', p.id)) });
});

router.patch('/products/:id/availability', writable, (req, res) => {
  const p = ownProduct(req);
  const avail = validator(req.body).bool('is_available');
  run(`UPDATE products SET is_available = ?, updated_at = datetime('now') WHERE id = ?`, avail ? 1 : 0, p.id);
  res.json({ product: serialize.product(one('SELECT * FROM products WHERE id = ?', p.id)) });
});

// Soft delete: keeps order_items history intact
router.delete('/products/:id', ownerOnly, writable, (req, res) => {
  const p = ownProduct(req);
  run(`UPDATE products SET is_active = 0, is_available = 0, updated_at = datetime('now') WHERE id = ?`, p.id);
  res.json({ ok: true });
});

/* ---------------- Orders ---------------- */
router.get('/orders', (req, res) => {
  const scope = req.query.scope === 'history' ? 'history' : 'active';
  const cond = scope === 'active'
    ? `o.status IN ('pending','accepted','preparing','ready')`
    : `o.status IN ('completed','cancelled','rejected')`;
  const rows = all(
    `${orders.ORDER_SELECT} WHERE o.restaurant_id = ? AND ${cond}
      ORDER BY ${scope === 'active' ? 'o.created_at ASC' : 'o.created_at DESC'} LIMIT 200`,
    req.user.restaurant_id
  );
  res.json({ items: orders.hydrate(rows).map(orders.forRestaurant) });
});

router.get('/orders/:id', (req, res) => {
  const o = orders.getOrder(Number(req.params.id));
  if (!o || o.restaurant_id !== req.user.restaurant_id) throw notFound('Order not found');
  res.json({ order: orders.forRestaurant(o) });
});

// Allowed even when the restaurant is deactivated, so existing orders can be completed.
router.patch('/orders/:id/status', (req, res) => {
  const o = one('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?', Number(req.params.id), req.user.restaurant_id);
  if (!o) throw notFound('Order not found');
  const v = validator(req.body);
  const status = v.oneOf('status', ['accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'], { required: true });
  const note = v.string('note', { max: 200 });
  v.done();
  const allowed = orders.STAFF_TRANSITIONS[o.status] || [];
  if (!allowed.includes(status)) throw conflict(`Cannot change an order from "${o.status}" to "${status}"`);
  if (!req.user.restaurant_active && status === 'accepted') {
    throw forbidden('This restaurant is deactivated and cannot accept new orders. You can reject it instead.');
  }
  tx(() => {
    run(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, o.id);
    run(`INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, ?, ?, ?)`, o.id, status, req.user.id, note ?? null);
  });
  res.json({ order: orders.forRestaurant(orders.getOrder(o.id)) });
});

/* ---------------- Performance ---------------- */
router.get('/performance', (req, res) => {
  const rid = req.user.restaurant_id;
  const r = one('SELECT AVG(score) AS avg, COUNT(*) AS n FROM ratings WHERE restaurant_id = ?', rid);
  const dist = all('SELECT score, COUNT(*) AS n FROM ratings WHERE restaurant_id = ? GROUP BY score', rid);
  const totals = one(
    `SELECT COUNT(*) AS total,
            SUM(status = 'completed') AS completed,
            SUM(status IN ('cancelled','rejected')) AS cancelled,
            SUM(status IN ('pending','accepted','preparing','ready')) AS active,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN total END), 0) AS revenue,
            COALESCE(AVG(CASE WHEN status = 'completed' THEN total END), 0) AS avg_order
       FROM orders WHERE restaurant_id = ?`, rid
  );
  res.json({
    rating: { average: r.avg ? Math.round(r.avg * 10) / 10 : null, count: r.n, distribution: [5, 4, 3, 2, 1].map((s) => ({ score: s, count: dist.find((d) => d.score === s)?.n || 0 })) },
    totals,
    by_day: all(
      `SELECT date(created_at) AS day, COUNT(*) AS orders FROM orders
        WHERE restaurant_id = ? AND created_at >= date('now','-6 days') GROUP BY day ORDER BY day`, rid
    ),
    top_items: all(
      `SELECT oi.product_name AS name, SUM(oi.quantity) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.restaurant_id = ? AND o.status = 'completed' GROUP BY oi.product_name ORDER BY qty DESC LIMIT 5`, rid
    ),
    reviews: all(
      `SELECT rt.score, rt.comment, rt.created_at, rt.order_id, u.name AS student_name
         FROM ratings rt JOIN users u ON u.id = rt.student_id
        WHERE rt.restaurant_id = ? ORDER BY rt.created_at DESC LIMIT 50`, rid
    ).map((x) => ({ ...x, student_name: x.student_name.split(' ')[0] })),
  });
});

module.exports = router;
