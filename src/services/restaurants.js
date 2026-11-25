const { one, all } = require('../db');
const serialize = require('../utils/serialize');

// A restaurant is publicly visible only when it is active AND published.
const PUBLIC_WHERE = 'r.is_active = 1 AND r.published_at IS NOT NULL';

const BASE_SELECT = `
  SELECT r.*, c.name AS category_name, c.icon AS category_icon,
         (SELECT AVG(score) FROM ratings WHERE restaurant_id = r.id) AS avg_rating,
         (SELECT COUNT(*)   FROM ratings WHERE restaurant_id = r.id) AS rating_count
    FROM restaurants r
    JOIN categories c ON c.id = r.category_id`;

// Admin-only: owner account + invitation status (never exposed publicly)
const ADMIN_SELECT = `
  SELECT r.*, c.name AS category_name, c.icon AS category_icon,
         (SELECT AVG(score) FROM ratings WHERE restaurant_id = r.id) AS avg_rating,
         (SELECT COUNT(*)   FROM ratings WHERE restaurant_id = r.id) AS rating_count,
         ou.id AS owner_id, ou.name AS owner_name, ou.email AS owner_email, ou.status AS owner_status,
         (SELECT email FROM restaurant_invitations i WHERE i.restaurant_id = r.id AND i.status = 'pending'
             AND i.expires_at > datetime('now') ORDER BY i.id DESC LIMIT 1) AS pending_invite_email
    FROM restaurants r
    JOIN categories c ON c.id = r.category_id
    LEFT JOIN restaurant_users ru ON ru.restaurant_id = r.id AND ru.status = 'active' AND ru.assigned_role = 'owner'
    LEFT JOIN users ou ON ou.id = ru.user_id`;

function accountStatus(r) {
  if (r.owner_id) return r.owner_status === 'active' ? 'active' : 'deactivated';
  if (r.pending_invite_email) return 'invited';
  return 'none';
}
const adminSerialize = (r) => ({ ...serialize.restaurant(r), account_status: accountStatus(r) });

function getById(id, { includeInactive = false } = {}) {
  if (includeInactive) {
    const r = one(`${ADMIN_SELECT} WHERE r.id = ?`, id);
    return r ? adminSerialize(r) : null;
  }
  const r = one(`${BASE_SELECT} WHERE r.id = ? AND ${PUBLIC_WHERE}`, id);
  return r ? serialize.restaurant(r) : null;
}

/**
 * Filtered + paginated listing. `scope: 'public'` restricts to visible restaurants.
 */
function list({ search, categoryId, status, availability, account, sort = 'name_asc', page = 1, pageSize = 12, scope = 'public' } = {}) {
  const where = [];
  const params = [];
  if (scope === 'public') where.push(PUBLIC_WHERE);
  else if (status === 'active') where.push('r.is_active = 1 AND r.published_at IS NOT NULL');
  else if (status === 'draft') where.push('r.is_active = 1 AND r.published_at IS NULL');
  else if (status === 'inactive') where.push('r.is_active = 0');
  if (search) { where.push('(r.name LIKE ? OR r.campus_location LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (categoryId) { where.push('r.category_id = ?'); params.push(Number(categoryId)); }
  if (availability && ['open', 'busy', 'closed'].includes(availability)) {
    where.push('r.availability_status = ?'); params.push(availability);
  }
  if (scope !== 'public' && account) {
    if (account === 'active') where.push(`ou.status = 'active'`);
    if (account === 'deactivated') where.push(`ou.status = 'deactivated'`);
    if (account === 'invited') where.push(`ou.id IS NULL AND EXISTS (SELECT 1 FROM restaurant_invitations i WHERE i.restaurant_id = r.id AND i.status = 'pending' AND i.expires_at > datetime('now'))`);
    if (account === 'none') where.push(`ou.id IS NULL AND NOT EXISTS (SELECT 1 FROM restaurant_invitations i WHERE i.restaurant_id = r.id AND i.status = 'pending' AND i.expires_at > datetime('now'))`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = {
    name_asc: 'r.name COLLATE NOCASE ASC',
    name_desc: 'r.name COLLATE NOCASE DESC',
    newest: 'r.created_at DESC, r.id DESC',
    oldest: 'r.created_at ASC, r.id ASC',
    rating: 'avg_rating IS NULL, avg_rating DESC',
  }[sort] || 'r.name COLLATE NOCASE ASC';

  const select = scope === 'public' ? BASE_SELECT : ADMIN_SELECT;
  const from = select.slice(select.indexOf('FROM restaurants r'));
  const size = Math.min(Math.max(Number(pageSize) || 12, 1), 100);
  const total = one(`SELECT COUNT(*) AS n ${from} ${whereSql}`, ...params).n;
  const pages = Math.max(Math.ceil(total / size), 1);
  const p = Math.min(Math.max(Number(page) || 1, 1), pages);
  const rows = all(`${select} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, size, (p - 1) * size);
  return { items: rows.map(scope === 'public' ? serialize.restaurant : adminSerialize), total, page: p, pages, pageSize: size };
}

module.exports = { getById, list, PUBLIC_WHERE };
