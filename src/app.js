const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { ROOT, UPLOAD_DIR, DEV_MAILBOX } = require('./config');
const { loadUser } = require('./middleware/auth');
const csrf = require('./middleware/csrf');
const errorHandler = require('./middleware/errors');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(loadUser);

/* ---------- API ---------- */
const api = express.Router();
api.use(csrf);
api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use('/auth', require('./routes/auth'));
api.use('/public', require('./routes/public'));
api.use('/student', require('./routes/student'));
api.use('/restaurant', require('./routes/restaurant'));
api.use('/admin', require('./routes/admin'));
if (DEV_MAILBOX) api.use('/dev', require('./routes/dev')); // development only: read emails without SMTP
api.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use('/api', api);

/* ---------- Server-side page guards (UI is also guarded client-side) ---------- */
// Admin dashboard: only an authenticated Super Admin. /admin/login is the only public admin page.
app.use('/admin', (req, res, next) => {
  const isLogin = req.path === '/login' || req.path === '/login.html';
  if (isLogin) return req.user && req.user.role === 'admin' ? res.redirect('/admin/') : next();
  if (!req.user) return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (req.user.role !== 'admin') return res.status(403).sendFile(path.join(ROOT, 'public', '403.html'));
  next();
});
function guardPage(role, portal) {
  return (req, res, next) => {
    if (!req.user) return res.redirect(`/login.html?as=${portal}&next=${encodeURIComponent(req.originalUrl)}`);
    if (req.user.role !== role) return res.status(403).sendFile(path.join(ROOT, 'public', '403.html'));
    next();
  };
}
// Friendly direct login links for each portal
app.get(['/student/login', '/student/login.html', '/student', '/login/student', '/student-login', '/student-login.html'],
  (_req, res) => res.redirect('/login.html?as=student'));
app.get(['/restaurant/login', '/restaurant/login.html', '/restaurant', '/login/restaurant', '/restaurant-login', '/restaurant-login.html'],
  (_req, res) => res.redirect('/login.html?as=restaurant'));
app.get('/register', (_req, res) => res.redirect('/register.html'));
app.use('/restaurant-dashboard.html', guardPage('restaurant', 'restaurant'));
app.use('/orders.html', guardPage('student', 'student'));
if (DEV_MAILBOX) app.get('/dev/mailbox.html', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'dev', 'mailbox.html')));
app.use('/dev', (_req, res) => res.status(404).sendFile(path.join(ROOT, 'public', '404.html')));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: false }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.use((_req, res) => res.status(404).sendFile(path.join(ROOT, 'public', '404.html')));

app.use(errorHandler);

module.exports = app;
