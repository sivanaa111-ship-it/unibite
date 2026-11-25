const express = require('express');
const { one, all, run, tx } = require('../db');
const { requireRole } = require('../middleware/auth');
const { validator } = require('../utils/validate');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { canOrder } = require('../utils/hours');
const orders = require('../services/orders');

const router = express.Router();
router.use(requireRole('student'));

router.post('/orders', (req, res) => {
  const v = validator(req.body);
  const restaurantId = v.int('restaurant_id', { required: true, min: 1 });
  const notes = v.string('notes', { max: 300 });
  v.done();

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length || items.length > 50) throw badRequest('Your cart is empty');

  const r = one('SELECT * FROM restaurants WHERE id = ?', restaurantId);
  if (!r || !r.is_active || !r.published_at) throw notFound('This restaurant is no longer available on UniBite');
  if (!canOrder(r)) throw conflict(`${r.name} is not accepting orders right now`);

  // Merge duplicates and validate each product against the database (never trust client prices)
  const qty = new Map();
  for (const it of items) {
    const pid = Number(it.product_id);
    const q = Number(it.quantity);
    if (!Number.isInteger(pid) || !Number.isInteger(q) || q < 1 || q > 20) throw badRequest('Invalid item in cart');
    qty.set(pid, (qty.get(pid) || 0) + q);
  }
  const ids = [...qty.keys()];
  const products = all(
    `SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND restaurant_id = ?`,
    ...ids, restaurantId
  );
  const unavailable = ids.filter((id) => {
    const p = products.find((x) => x.id === id);
    return !p || !p.is_active || !p.is_available;
  });
  if (unavailable.length) throw conflict('Some items in your cart are no longer available. Please review your cart.');

  const total = Math.round(products.reduce((s, p) => s + p.price * qty.get(p.id), 0) * 100) / 100;

  const orderId = tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO orders (student_id, restaurant_id, total, notes, pickup_code) VALUES (?, ?, ?, ?, ?)`,
      req.user.id, restaurantId, total, notes ?? null, orders.pickupCode()
    );
    for (const p of products) {
      run(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)`,
        lastInsertRowid, p.id, p.name, p.price, qty.get(p.id)
      );
    }
    run(`INSERT INTO order_status_history (order_id, status, changed_by) VALUES (?, 'pending', ?)`, lastInsertRowid, req.user.id);
    return Number(lastInsertRowid);
  });
  res.status(201).json({ order: orders.getOrder(orderId) });
});

router.get('/orders', (req, res) => {
  const rows = all(`${orders.ORDER_SELECT} WHERE o.student_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT 100`, req.user.id);
  res.json({ items: orders.hydrate(rows) });
});

function ownOrder(req) {
  const o = orders.getOrder(Number(req.params.id));
  if (!o || o.student_id !== req.user.id) throw notFound('Order not found');
  return o;
}

router.get('/orders/:id', (req, res) => res.json({ order: ownOrder(req) }));

router.post('/orders/:id/cancel', (req, res) => {
  const o = ownOrder(req);
  if (o.status !== 'pending') throw conflict('Orders can only be cancelled before the restaurant accepts them');
  tx(() => {
    run(`UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, o.id);
    run(`INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, 'cancelled', ?, 'Cancelled by student')`, o.id, req.user.id);
  });
  res.json({ order: orders.getOrder(o.id) });
});

router.post('/orders/:id/rating', (req, res) => {
  const o = ownOrder(req);
  const v = validator(req.body);
  const score = v.int('score', { required: true, min: 1, max: 5 });
  const comment = v.string('comment', { max: 500 });
  v.done();
  if (o.status !== 'completed') throw conflict('You can rate an order after it has been completed');
  if (o.rating) throw conflict('You have already rated this order');
  run(
    `INSERT INTO ratings (order_id, student_id, restaurant_id, score, comment) VALUES (?, ?, ?, ?, ?)`,
    o.id, req.user.id, o.restaurant_id, score, comment ?? null
  );
  res.status(201).json({ order: orders.getOrder(o.id) });
});

router.patch('/profile', (req, res) => {
  const v = validator(req.body, { partial: true });
  const name = v.string('name', { min: 2, max: 100 });
  const phone = v.phone('phone');
  v.done();
  run(
    `UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), updated_at = datetime('now') WHERE id = ?`,
    name ?? null, phone ?? null, req.user.id
  );
  res.json({ ok: true });
});

module.exports = router;
