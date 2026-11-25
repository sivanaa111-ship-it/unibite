const express = require('express');
const { all, run, one } = require('../db');
const restaurants = require('../services/restaurants');
const serialize = require('../utils/serialize');
const { validator } = require('../utils/validate');
const { notFound, conflict } = require('../utils/errors');
const rateLimit = require('../middleware/rateLimit');
const { notifyAdmins, adminEmails } = require('../services/notifications');
const { sendMail } = require('../services/mailer');
const link = require('../utils/links');

const router = express.Router();
const { PUBLIC_WHERE } = restaurants;

router.get('/categories', (_req, res) => {
  const items = all(
    `SELECT c.id, c.name, c.description, c.icon,
            (SELECT COUNT(*) FROM restaurants r WHERE r.category_id = c.id AND ${PUBLIC_WHERE}) AS restaurant_count
       FROM categories c WHERE c.is_active = 1 ORDER BY c.name`
  );
  res.json({ items });
});

router.get('/restaurants', (req, res) => {
  const { q, category, availability, sort, page, pageSize } = req.query;
  res.json(restaurants.list({ search: q, categoryId: category, availability, sort, page, pageSize, scope: 'public' }));
});

router.get('/restaurants/:id', (req, res) => {
  const r = restaurants.getById(Number(req.params.id));
  if (!r) throw notFound('Restaurant not found');
  const menu = all(
    `SELECT * FROM products WHERE restaurant_id = ? AND is_active = 1
      ORDER BY COALESCE(menu_section, 'zzz'), name`,
    r.id
  ).map(serialize.product);
  const reviews = all(
    `SELECT rt.score, rt.comment, rt.created_at, u.name AS student_name
       FROM ratings rt JOIN users u ON u.id = rt.student_id
      WHERE rt.restaurant_id = ? ORDER BY rt.created_at DESC LIMIT 10`,
    r.id
  ).map((x) => ({ ...x, student_name: x.student_name.split(' ')[0] }));
  res.json({ restaurant: r, menu, reviews });
});

/** Search menu items across all visible restaurants, by name or menu category. */
router.get('/menu-items', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const section = String(req.query.section || '').trim().slice(0, 60);
  const where = [PUBLIC_WHERE, 'p.is_active = 1'];
  const params = [];
  if (q) { where.push('(p.name LIKE ? OR p.description LIKE ? OR p.menu_section LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (section) { where.push('p.menu_section = ? COLLATE NOCASE'); params.push(section); }
  if (req.query.category) { where.push('r.category_id = ?'); params.push(Number(req.query.category)); }
  const rows = all(
    `SELECT p.*, r.name AS restaurant_name, r.id AS restaurant_id, r.logo AS restaurant_logo, r.campus_location,
            r.is_active, r.published_at, r.availability_status, r.opening_time, r.closing_time, r.operating_days
       FROM products p JOIN restaurants r ON r.id = p.restaurant_id
      WHERE ${where.join(' AND ')} ORDER BY p.name COLLATE NOCASE LIMIT 60`,
    ...params
  );
  const { canOrder } = require('../utils/hours');
  res.json({
    items: rows.map((p) => ({
      id: p.id, name: p.name, description: p.description, price: p.price, image: p.image, menu_section: p.menu_section,
      is_available: !!p.is_available, restaurant: { id: p.restaurant_id, name: p.restaurant_name, logo: p.restaurant_logo, campus_location: p.campus_location, accepting_orders: canOrder(p) },
    })),
    sections: all(
      `SELECT DISTINCT p.menu_section AS s FROM products p JOIN restaurants r ON r.id = p.restaurant_id
        WHERE ${PUBLIC_WHERE} AND p.is_active = 1 AND p.menu_section IS NOT NULL ORDER BY s COLLATE NOCASE`
    ).map((x) => x.s),
  });
});

/** Non-sensitive settings the UI needs (allowed email domains, dev mailbox availability). */
router.get('/config', (_req, res) => {
  const cfg = require('../config');
  res.json({ university_email_domains: cfg.UNIVERSITY_EMAIL_DOMAINS, dev_mailbox: cfg.DEV_MAILBOX });
});

router.get('/stats', (_req, res) => {
  res.json({
    restaurants: one(`SELECT COUNT(*) n FROM restaurants r WHERE ${PUBLIC_WHERE}`).n,
    orders: one(`SELECT COUNT(*) n FROM orders WHERE status = 'completed'`).n,
    students: one(`SELECT COUNT(*) n FROM users WHERE role = 'student' AND status = 'active'`).n,
  });
});

/** "Register Your Restaurant" application, reviewed by the Super Admin. */
router.post('/restaurant-requests', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many applications from this network. Try again later.' }), async (req, res) => {
  const v = validator(req.body);
  const data = {
    contact_name: v.string('contact_name', { required: true, min: 2, max: 100 }),
    email: v.email('email', { required: true }),
    phone: v.phone('phone', { required: true }),
    restaurant_name: v.string('restaurant_name', { required: true, min: 2, max: 120 }),
    category_id: v.int('category_id', { required: true, min: 1 }),
    description: v.string('description', { required: true, min: 10, max: 1000 }),
    campus_location: v.string('campus_location', { required: true, max: 160 }),
    additional_info: v.string('additional_info', { max: 1000 }),
  };
  if (data.category_id && !one('SELECT id FROM categories WHERE id = ? AND is_active = 1', data.category_id)) {
    v.fail('category_id', 'Choose a valid category');
  }
  v.done();
  if (one(`SELECT id FROM restaurant_requests WHERE status = 'pending' AND (email = ? OR restaurant_name = ? COLLATE NOCASE)`, data.email, data.restaurant_name)) {
    throw conflict('An application for this restaurant or email is already awaiting review.');
  }
  const { lastInsertRowid } = run(
    `INSERT INTO restaurant_requests (restaurant_name, contact_name, email, phone, category_id, campus_location, description, additional_info)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    data.restaurant_name, data.contact_name, data.email, data.phone, data.category_id, data.campus_location, data.description, data.additional_info ?? null
  );
  // Notify the Super Admin (in-app + email)
  notifyAdmins('restaurant_request', 'New restaurant application', `${data.restaurant_name} (${data.contact_name}) applied to join UniBite.`, `#requests?status=pending`);
  for (const to of adminEmails()) {
    await sendMail({
      to, subject: `New restaurant application: ${data.restaurant_name}`, title: 'New restaurant application',
      paragraphs: [`${data.contact_name} (${data.email}) applied to add "${data.restaurant_name}" at ${data.campus_location}.`],
      action: { label: 'Review application', url: link(req, `/admin/#requests?status=pending`) },
    }).catch(() => {});
  }
  await sendMail({
    to: data.email, subject: 'We received your UniBite application', title: 'Application received',
    paragraphs: [`Thanks for applying to bring ${data.restaurant_name} to UniBite. Our team will review your application and email you with the outcome.`],
  }).catch(() => {});
  res.status(201).json({ ok: true, id: Number(lastInsertRowid) });
});

module.exports = router;
