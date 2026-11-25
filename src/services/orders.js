const crypto = require('crypto');
const { one, all } = require('../db');

const ACTIVE = ['pending', 'accepted', 'preparing', 'ready'];

/** Allowed transitions for restaurant staff. */
const STAFF_TRANSITIONS = {
  pending: ['accepted', 'rejected'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready'],
  ready: ['completed'],
};

const pickupCode = () => String(crypto.randomInt(1000, 10000));

function hydrate(orders) {
  if (!orders.length) return orders;
  const ids = orders.map((o) => o.id);
  const ph = ids.map(() => '?').join(',');
  const items = all(`SELECT * FROM order_items WHERE order_id IN (${ph}) ORDER BY id`, ...ids);
  const ratings = all(`SELECT order_id, score, comment FROM ratings WHERE order_id IN (${ph})`, ...ids);
  return orders.map((o) => ({
    ...o,
    items: items.filter((i) => i.order_id === o.id),
    rating: ratings.find((r) => r.order_id === o.id) || null,
  }));
}

const ORDER_SELECT = `
  SELECT o.*, r.name AS restaurant_name, r.logo AS restaurant_logo, r.campus_location AS restaurant_location,
         r.is_active AS restaurant_active, u.name AS student_name, u.email AS student_email
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    JOIN users u ON u.id = o.student_id`;

function getOrder(id) {
  const o = one(`${ORDER_SELECT} WHERE o.id = ?`, id);
  if (!o) return null;
  const [full] = hydrate([o]);
  full.history = all(
    `SELECT h.status, h.note, h.created_at, u.name AS changed_by_name
       FROM order_status_history h LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.order_id = ? ORDER BY h.id`,
    id
  );
  return full;
}

/** Restaurants see the student's name only — not their email or other account details. */
function forRestaurant(o) {
  const { student_email, ...rest } = o;
  return rest;
}

module.exports = { ACTIVE, STAFF_TRANSITIONS, pickupCode, hydrate, ORDER_SELECT, getOrder, forRestaurant };
