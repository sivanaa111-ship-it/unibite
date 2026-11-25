const express = require('express');
const { one, all } = require('../../db');

const router = express.Router();

router.get('/overview', (_req, res) => {
  const count = (sql) => one(sql).n;
  res.json({
    stats: {
      total_restaurants: count('SELECT COUNT(*) n FROM restaurants'),
      active_restaurants: count('SELECT COUNT(*) n FROM restaurants WHERE is_active = 1 AND published_at IS NOT NULL'),
      draft_restaurants: count('SELECT COUNT(*) n FROM restaurants WHERE is_active = 1 AND published_at IS NULL'),
      inactive_restaurants: count('SELECT COUNT(*) n FROM restaurants WHERE is_active = 0'),
      students: count(`SELECT COUNT(*) n FROM users WHERE role = 'student'`),
      pending_students: count(`SELECT COUNT(*) n FROM users WHERE role = 'student' AND status = 'pending'`),
      restaurant_accounts: count(`SELECT COUNT(*) n FROM users WHERE role = 'restaurant'`),
      pending_invitations: count(`SELECT COUNT(*) n FROM restaurant_invitations WHERE status = 'pending' AND expires_at > datetime('now')`),
      pending_requests: count(`SELECT COUNT(*) n FROM restaurant_requests WHERE status = 'pending'`),
      total_orders: count('SELECT COUNT(*) n FROM orders'),
      orders_today: count(`SELECT COUNT(*) n FROM orders WHERE date(created_at) = date('now')`),
      active_orders: count(`SELECT COUNT(*) n FROM orders WHERE status IN ('pending','accepted','preparing','ready')`),
      revenue_7d: one(`SELECT COALESCE(SUM(total),0) n FROM orders WHERE status = 'completed' AND created_at >= datetime('now','-7 days')`).n,
    },
    orders_by_day: all(
      `SELECT date(created_at) AS day, COUNT(*) AS orders FROM orders
        WHERE created_at >= date('now','-6 days') GROUP BY day ORDER BY day`
    ),
    top_restaurants: all(
      `SELECT r.id, r.name, r.logo, r.is_active, COUNT(o.id) AS orders
         FROM restaurants r LEFT JOIN orders o ON o.restaurant_id = r.id AND o.created_at >= datetime('now','-30 days')
        GROUP BY r.id ORDER BY orders DESC, r.name LIMIT 5`
    ),
    recent_activity: all(
      `SELECT a.*, u.name AS admin_name FROM audit_logs a LEFT JOIN users u ON u.id = a.admin_id
        ORDER BY a.id DESC LIMIT 8`
    ),
  });
});

router.get('/audit-logs', (req, res) => {
  const size = 25;
  const where = [];
  const params = [];
  if (req.query.entity) { where.push('a.entity_type = ?'); params.push(String(req.query.entity)); }
  if (req.query.q) { where.push('(a.action LIKE ? OR a.details LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) n FROM audit_logs a ${w}`, ...params).n;
  const pages = Math.max(Math.ceil(total / size), 1);
  const page = Math.min(Math.max(Number(req.query.page) || 1, 1), pages);
  const items = all(
    `SELECT a.*, u.name AS admin_name FROM audit_logs a LEFT JOIN users u ON u.id = a.admin_id
     ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params, size, (page - 1) * size
  );
  res.json({ items, total, page, pages });
});

module.exports = router;
