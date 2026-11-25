/**
 * Authentication.
 *  Main site:  /register (students), /login with portal = student | restaurant
 *  Admin:      /admin/login (+ /admin/mfa when 2FA is on) — Super Admin only
 *  Tokens:     email verification, password reset, restaurant owner invitations
 * Roles are only ever set by the server; no endpoint accepts a role from the client.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { one, run, tx } = require('../db');
const { validator } = require('../utils/validate');
const { badRequest, unauthorized, conflict, forbidden, notFound } = require('../utils/errors');
const { issueSession, clearSession, requireAuth, findUserByEmail, findUserById } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const serialize = require('../utils/serialize');
const tokens = require('../services/tokens');
const totp = require('../services/totp');
const { sendMail } = require('../services/mailer');
const { isUniversityEmail, checkUniversityId } = require('../services/university');
const { notifyAdmins } = require('../services/notifications');
const { audit } = require('../utils/audit');
const link = require('../utils/links');

const router = express.Router();
const HASH_ROUNDS = 12;
const minutes = (n) => n * 60 * 1000;

const loginLimiter = rateLimit({ windowMs: minutes(15), max: 20, key: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`, message: 'Too many login attempts. Try again in 15 minutes.' });
const emailLimiter = rateLimit({ windowMs: minutes(15), max: 8, message: 'Too many requests. Please wait a few minutes and try again.' });
const registerLimiter = rateLimit({ windowMs: minutes(60), max: 10, message: 'Too many registrations from this network. Try again later.' });

// Constant-time-ish dummy compare so unknown emails take as long as wrong passwords
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', HASH_ROUNDS);
function checkPassword(user, password) {
  const ok = bcrypt.compareSync(String(password), user ? user.password_hash : DUMMY_HASH);
  return !!user && ok;
}

function confirmMatches(v, body) {
  if (body.password && body.confirm_password !== undefined && body.password !== body.confirm_password) {
    v.fail('confirm_password', 'Passwords do not match');
  }
}

async function sendVerification(req, user) {
  const token = tokens.issue('email_verification', user.id);
  await sendMail({
    to: user.email,
    subject: 'Verify your UniBite email',
    title: `Welcome to UniBite, ${user.name.split(' ')[0]}!`,
    paragraphs: ['Please confirm your university email address to activate your student account. This link expires in 24 hours.'],
    action: { label: 'Verify email', url: link(req, `/verify-email.html?token=${token}`) },
  });
}

/* ------------------------------------------------------------------ */
/* Student registration + email verification                           */
/* ------------------------------------------------------------------ */
router.post('/register', registerLimiter, async (req, res) => {
  const v = validator(req.body);
  const name = v.string('name', { required: true, min: 2, max: 100 });
  const email = v.email('email', { required: true });
  const universityId = v.string('university_id', { required: true, max: 40 });
  const password = v.password('password');
  v.string('confirm_password', { required: true, max: 128 });
  confirmMatches(v, req.body);
  if (email && !v.errors.email && !isUniversityEmail(email)) v.fail('email', 'Use your official university email address');
  let idCheck = null;
  if (universityId) {
    idCheck = checkUniversityId(universityId, email);
    if (!idCheck.ok) v.fail('university_id', idCheck.error);
  }
  if (universityId && one('SELECT 1 AS x FROM student_profiles WHERE university_id = ?', universityId)) {
    v.fail('university_id', 'An account with this University ID already exists');
  }
  if (email && one('SELECT 1 AS x FROM users WHERE email = ?', email)) v.fail('email', 'An account with this email already exists');
  v.done();

  const userId = tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'student', 'pending')`,
      name, email, bcrypt.hashSync(password, HASH_ROUNDS)
    );
    run(
      `INSERT INTO student_profiles (user_id, university_id, verification_status, verified_at) VALUES (?, ?, ?, ?)`,
      lastInsertRowid, universityId, idCheck.status, idCheck.status === 'verified' ? new Date().toISOString() : null
    );
    return Number(lastInsertRowid);
  });
  await sendVerification(req, findUserById(userId));
  res.status(201).json({ ok: true, status: 'pending', message: 'Check your university inbox to verify your email and activate your account.' });
});

router.post('/verify-email', (req, res) => {
  const v = validator(req.body);
  const token = v.string('token', { required: true, max: 200 });
  v.done();
  const row = tokens.consume('email_verification', token);
  if (!row) throw badRequest('This verification link is invalid or has expired. Request a new one from the login page.');
  run(
    `UPDATE users SET status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
            email_verified_at = COALESCE(email_verified_at, datetime('now')), last_login_at = datetime('now'),
            updated_at = datetime('now') WHERE id = ?`,
    row.user_id
  );
  const user = findUserById(row.user_id);
  if (user.status !== 'active') throw forbidden('This account has been deactivated. Contact the UniBite administrator.');
  issueSession(res, user);
  res.json({ ok: true, user: serialize.user(user) });
});

router.post('/resend-verification', emailLimiter, async (req, res) => {
  const v = validator(req.body);
  const email = v.email('email', { required: true });
  v.done();
  const user = one(`SELECT * FROM users WHERE email = ? AND status = 'pending'`, email);
  if (user) await sendVerification(req, user);
  // Same response either way (no account enumeration)
  res.json({ ok: true, message: 'If that account is awaiting verification, a new link has been sent.' });
});

/* ------------------------------------------------------------------ */
/* Login (main website)                                                */
/* ------------------------------------------------------------------ */
router.post('/login', loginLimiter, (req, res) => {
  const v = validator(req.body);
  const email = v.email('email', { required: true });
  const password = v.string('password', { required: true, max: 128 });
  const portal = v.oneOf('portal', ['student', 'restaurant'], { required: true });
  v.done();

  const user = findUserByEmail(email);
  // Super Admin accounts never sign in through the public portals
  if (!checkPassword(user, password) || user.role === 'admin') throw unauthorized('Incorrect email or password');

  if (user.role !== portal) {
    throw forbidden(user.role === 'student'
      ? 'This is a student account. Choose "Login as Student".'
      : 'This is a restaurant account. Choose "Login as Restaurant".', 'WRONG_PORTAL');
  }
  if (user.status === 'pending') throw forbidden('Please verify your email before logging in. Check your inbox or request a new link.', 'EMAIL_NOT_VERIFIED');
  if (user.status !== 'active') throw forbidden('This account has been deactivated. Contact the UniBite administrator.', 'ACCOUNT_DEACTIVATED');
  if (user.role === 'restaurant' && !user.restaurant_id) {
    throw forbidden('Your account is not linked to a restaurant yet. Contact the UniBite administrator.', 'NO_RESTAURANT');
  }

  run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, user.id);
  issueSession(res, user);
  res.json({ user: serialize.user(user), redirect: user.role === 'student' ? '/restaurants.html' : '/restaurant-dashboard.html' });
});

/* ------------------------------------------------------------------ */
/* Super Admin login (/admin/login)                                    */
/* ------------------------------------------------------------------ */
router.post('/admin/login', loginLimiter, (req, res) => {
  const v = validator(req.body);
  const email = v.email('email', { required: true });
  const password = v.string('password', { required: true, max: 128 });
  v.done();
  const user = findUserByEmail(email);
  // Identical error for "not an admin" and "wrong password"
  if (!checkPassword(user, password) || user.role !== 'admin') throw unauthorized('Invalid administrator credentials');
  if (user.status !== 'active') throw forbidden('This administrator account is deactivated.');

  if (user.totp_enabled) {
    const mfaToken = tokens.issue('mfa_challenge', user.id);
    return res.json({ mfa_required: true, mfa_token: mfaToken });
  }
  run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, user.id);
  issueSession(res, user);
  audit({ user, ip: req.ip }, 'admin.login', 'user', user.id, { email: user.email });
  res.json({ user: serialize.user(user), redirect: '/admin/' });
});

router.post('/admin/mfa', loginLimiter, (req, res) => {
  const v = validator(req.body);
  const mfaToken = v.string('mfa_token', { required: true, max: 200 });
  const code = v.string('code', { required: true, max: 10 });
  v.done();
  const challenge = tokens.peek('mfa_challenge', mfaToken);
  if (!challenge) throw unauthorized('Your sign-in session expired. Please log in again.');
  const user = findUserById(challenge.user_id);
  if (!user || user.role !== 'admin' || user.status !== 'active') throw unauthorized('Invalid administrator credentials');
  if (!totp.verify(user.totp_secret, code)) throw badRequest('Incorrect verification code', { code: 'Incorrect or expired code' });
  tokens.consume('mfa_challenge', mfaToken);
  run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, user.id);
  issueSession(res, user);
  audit({ user, ip: req.ip }, 'admin.login', 'user', user.id, { email: user.email, mfa: true });
  res.json({ user: serialize.user(user), redirect: '/admin/' });
});

/* ------------------------------------------------------------------ */
/* Session                                                            */
/* ------------------------------------------------------------------ */
router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const extra = req.user.role === 'student'
    ? one('SELECT university_id, verification_status FROM student_profiles WHERE user_id = ?', req.user.id)
    : {};
  res.json({ user: { ...serialize.user(req.user), ...extra } });
});

router.post('/change-password', requireAuth, (req, res) => {
  const v = validator(req.body);
  const current = v.string('current_password', { required: true, max: 128 });
  const next = v.password('new_password');
  v.done();
  if (!bcrypt.compareSync(current, req.user.password_hash)) throw badRequest('Current password is incorrect', { current_password: 'Incorrect password' });
  run(
    `UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = 0,
            updated_at = datetime('now') WHERE id = ?`,
    bcrypt.hashSync(next, HASH_ROUNDS), req.user.id
  );
  issueSession(res, findUserById(req.user.id)); // keep this device, sign out all others
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Forgot / reset password                                             */
/* ------------------------------------------------------------------ */
router.post('/forgot-password', emailLimiter, async (req, res) => {
  const v = validator(req.body);
  const email = v.email('email', { required: true });
  v.done();
  const user = one(`SELECT * FROM users WHERE email = ? AND status = 'active'`, email);
  if (user) {
    const token = tokens.issue('password_reset', user.id);
    await sendMail({
      to: user.email,
      subject: 'Reset your UniBite password',
      title: 'Reset your password',
      paragraphs: ['We received a request to reset your UniBite password. This link expires in 60 minutes and can only be used once.', 'If you did not request this, you can ignore this email.'],
      action: { label: 'Choose a new password', url: link(req, `/reset-password.html?token=${token}`) },
    });
  }
  res.json({ ok: true, message: 'If an active account exists for that email, a reset link has been sent.' });
});

router.get('/reset-password/:token', (req, res) => {
  const row = tokens.peek('password_reset', req.params.token);
  res.json({ valid: !!row && row.user_status === 'active', email: row ? row.email : null });
});

router.post('/reset-password', (req, res) => {
  const v = validator(req.body);
  const token = v.string('token', { required: true, max: 200 });
  const password = v.password('password');
  confirmMatches(v, req.body);
  v.done();
  const row = tokens.consume('password_reset', token);
  if (!row || row.user_status !== 'active') throw badRequest('This reset link is invalid or has expired. Request a new one.');
  run(
    `UPDATE users SET password_hash = ?, token_version = token_version + 1, must_change_password = 0,
            updated_at = datetime('now') WHERE id = ?`,
    bcrypt.hashSync(password, HASH_ROUNDS), row.user_id
  );
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Restaurant owner invitations                                        */
/* ------------------------------------------------------------------ */
function findInvitation(token) {
  return one(
    `SELECT i.*, r.name AS restaurant_name, r.is_active AS restaurant_active
       FROM restaurant_invitations i JOIN restaurants r ON r.id = i.restaurant_id
      WHERE i.token_hash = ? AND i.status = 'pending' AND i.expires_at > datetime('now')`,
    tokens.hash(token)
  );
}

router.get('/invitations/:token', (req, res) => {
  const inv = findInvitation(req.params.token);
  if (!inv) return res.json({ valid: false });
  const existing = one('SELECT role FROM users WHERE email = ?', inv.email);
  res.json({ valid: true, email: inv.email, restaurant_name: inv.restaurant_name, existing_account: !!existing && existing.role === 'restaurant' });
});

router.post('/invitations/accept', registerLimiter, (req, res) => {
  const v = validator(req.body);
  const token = v.string('token', { required: true, max: 200 });
  const password = v.string('password', { required: true, max: 128 });
  v.done();
  const inv = findInvitation(token);
  if (!inv) throw badRequest('This invitation is invalid, has expired, or was revoked. Ask the UniBite administrator for a new one.');

  const existing = findUserByEmail(inv.email);
  let name;
  if (existing) {
    // Existing restaurant account: prove ownership with the current password
    if (existing.role !== 'restaurant') throw conflict('This email belongs to a different type of UniBite account. Ask the administrator to invite another email.');
    if (!bcrypt.compareSync(password, existing.password_hash)) throw badRequest('Incorrect password for this existing account', { password: 'Incorrect password' });
    if (existing.restaurant_id && existing.restaurant_id !== inv.restaurant_id) {
      throw conflict('This account already manages another restaurant. Ask the administrator to reassign it.');
    }
  } else {
    name = v.string('name', { required: true, min: 2, max: 100 });
    v.password('password');
    v.string('confirm_password', { required: true, max: 128 });
    confirmMatches(v, req.body);
    v.done();
  }

  const userId = tx(() => {
    let uid = existing && existing.id;
    if (!existing) {
      uid = Number(run(
        `INSERT INTO users (name, email, password_hash, role, status, email_verified_at) VALUES (?, ?, ?, 'restaurant', 'active', datetime('now'))`,
        name, inv.email, bcrypt.hashSync(password, HASH_ROUNDS)
      ).lastInsertRowid);
    } else if (existing.status !== 'active') {
      run(`UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`, uid);
    }
    // The restaurant comes from the invitation record — never from the client
    const currentOwner = one(`SELECT * FROM restaurant_users WHERE restaurant_id = ? AND assigned_role = 'owner' AND status = 'active'`, inv.restaurant_id);
    if (currentOwner && currentOwner.user_id !== uid) {
      if (!inv.replace_owner) throw conflict('This restaurant already has an owner. Ask the administrator for a new invitation.');
      run(`UPDATE restaurant_users SET status = 'removed', updated_at = datetime('now') WHERE id = ?`, currentOwner.id);
      run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', currentOwner.user_id);
    }
    if (!currentOwner || currentOwner.user_id !== uid) {
      run(`INSERT INTO restaurant_users (user_id, restaurant_id, assigned_role) VALUES (?, ?, 'owner')`, uid, inv.restaurant_id);
    }
    const upd = run(
      `UPDATE restaurant_invitations SET status = 'accepted', accepted_by = ?, accepted_at = datetime('now') WHERE id = ? AND status = 'pending'`,
      uid, inv.id
    );
    if (upd.changes !== 1) throw conflict('This invitation has already been used');
    audit(null, 'invitation.accept', 'restaurant', inv.restaurant_id, { email: inv.email, restaurant: inv.restaurant_name, user_id: uid });
    return uid;
  });
  run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, userId);
  notifyAdmins('owner_activated', 'Restaurant owner activated', `${inv.email} activated the account for ${inv.restaurant_name}.`, `#restaurants/${inv.restaurant_id}`);

  const user = findUserById(userId);
  issueSession(res, user);
  res.json({ user: serialize.user(user), redirect: '/restaurant-dashboard.html' });
});

// Unknown auth sub-route
router.use((_req, _res, next) => next(notFound('Endpoint not found')));

module.exports = router;
