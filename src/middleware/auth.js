const jwt = require('jsonwebtoken');
const { one } = require('../db');
const { JWT_SECRET, COOKIE_NAME, IS_PROD, SESSION_HOURS } = require('../config');
const { unauthorized, forbidden } = require('../utils/errors');

/** Sign a session for the user. Lifetime depends on role (admins get the shortest). */
function issueSession(res, user) {
  const hours = SESSION_HOURS[user.role] || 24;
  const token = jwt.sign({ sub: user.id, v: user.token_version, r: user.role }, JWT_SECRET, { expiresIn: `${hours}h` });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: hours * 3600 * 1000,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

const USER_SQL = `
  SELECT u.*, ru.restaurant_id, ru.assigned_role AS staff_role,
         r.is_active AS restaurant_active, r.name AS restaurant_name
    FROM users u
    LEFT JOIN restaurant_users ru ON ru.user_id = u.id AND ru.status = 'active'
    LEFT JOIN restaurants r ON r.id = ru.restaurant_id`;

const findUserById = (id) => one(`${USER_SQL} WHERE u.id = ?`, id);
const findUserByEmail = (email) => one(`${USER_SQL} WHERE u.email = ?`, email);

/**
 * Resolve the current user from the session cookie on every request. The row is re-read
 * from the database so deactivation, reassignment and password resets (token_version bump)
 * take effect immediately. Only ACTIVE accounts get a session.
 */
function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const u = findUserById(payload.sub);
    if (u && u.status === 'active' && u.token_version === payload.v && u.role === payload.r) req.user = u;
  } catch (_) { /* invalid/expired token -> anonymous */ }
  next();
}

const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

/** Restaurant account must be linked to a restaurant (read access, also when deactivated). */
function requireRestaurantMember(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'restaurant') return next(forbidden());
  if (!req.user.restaurant_id) return next(forbidden('Your account is not linked to a restaurant. Contact the UniBite administrator.'));
  next();
}

/** Write access to menu/profile/availability requires an ACTIVE restaurant. */
function requireRestaurantWritable(req, _res, next) {
  if (!req.user.restaurant_active) {
    return next(forbidden('This restaurant has been deactivated. Menu and restaurant details can no longer be changed.'));
  }
  next();
}

module.exports = {
  issueSession, clearSession, loadUser, requireAuth, requireRole,
  requireRestaurantMember, requireRestaurantWritable, findUserById, findUserByEmail,
};
