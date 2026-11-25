const express = require('express');
const { one, all, run } = require('../../db');
const { validator } = require('../../utils/validate');
const { notFound, conflict } = require('../../utils/errors');
const { audit } = require('../../utils/audit');

const router = express.Router();

router.get('/', (_req, res) => {
  const items = all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM restaurants r WHERE r.category_id = c.id AND r.is_active = 1) AS active_restaurants,
            (SELECT COUNT(*) FROM restaurants r WHERE r.category_id = c.id) AS total_restaurants
       FROM categories c ORDER BY c.is_active DESC, c.name`
  ).map((c) => ({ ...c, is_active: !!c.is_active }));
  res.json({ items });
});

function fields(req, partial) {
  const v = validator(req.body, { partial });
  const d = {
    name: v.string('name', { required: true, min: 2, max: 60 }),
    description: v.string('description', { max: 300 }),
    icon: v.oneOf('icon', ['utensils', 'coffee', 'truck', 'pizza', 'salad', 'cake', 'sandwich', 'soup', 'store'], {}),
  };
  v.done();
  return d;
}

router.post('/', (req, res) => {
  const d = fields(req, false);
  if (one('SELECT id FROM categories WHERE name = ?', d.name)) throw conflict('A category with this name already exists');
  const { lastInsertRowid } = run(
    'INSERT INTO categories (name, description, icon) VALUES (?, ?, ?)', d.name, d.description ?? null, d.icon ?? 'utensils'
  );
  audit(req, 'category.create', 'category', lastInsertRowid, { name: d.name });
  res.status(201).json({ category: one('SELECT * FROM categories WHERE id = ?', lastInsertRowid) });
});

router.put('/:id', (req, res) => {
  const c = one('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
  if (!c) throw notFound('Category not found');
  const d = fields(req, true);
  if (d.name && one('SELECT id FROM categories WHERE name = ? AND id <> ?', d.name, c.id)) throw conflict('A category with this name already exists');
  run(
    `UPDATE categories SET name = COALESCE(?, name), description = ?, icon = COALESCE(?, icon), updated_at = datetime('now') WHERE id = ?`,
    d.name ?? null, d.description ?? null, d.icon ?? null, c.id
  );
  audit(req, 'category.update', 'category', c.id, { from: c.name, to: d.name ?? c.name });
  res.json({ category: one('SELECT * FROM categories WHERE id = ?', c.id) });
});

router.post('/:id/deactivate', (req, res) => {
  const c = one('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
  if (!c) throw notFound('Category not found');
  const inUse = one('SELECT COUNT(*) n FROM restaurants WHERE category_id = ? AND is_active = 1', c.id).n;
  if (inUse) throw conflict(`${inUse} active restaurant(s) use this category. Move them to another category first.`);
  run(`UPDATE categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?`, c.id);
  audit(req, 'category.deactivate', 'category', c.id, { name: c.name });
  res.json({ ok: true });
});

router.post('/:id/reactivate', (req, res) => {
  const c = one('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
  if (!c) throw notFound('Category not found');
  run(`UPDATE categories SET is_active = 1, updated_at = datetime('now') WHERE id = ?`, c.id);
  audit(req, 'category.reactivate', 'category', c.id, { name: c.name });
  res.json({ ok: true });
});

module.exports = router;
