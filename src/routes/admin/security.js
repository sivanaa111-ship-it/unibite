/** Admin notifications + Super Admin account security (two-factor authentication). */
const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { one, all, run } = require('../../db');
const { validator } = require('../../utils/validate');
const { badRequest, conflict } = require('../../utils/errors');
const { audit } = require('../../utils/audit');
const totp = require('../../services/totp');

const router = express.Router();

/* ---------- Notifications ---------- */
router.get('/notifications', (req, res) => {
  res.json({
    items: all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', req.user.id),
    unread: one('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n,
  });
});

router.post('/notifications/read-all', (req, res) => {
  run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`, req.user.id);
  res.json({ ok: true });
});

/* ---------- Two-factor authentication (TOTP) ---------- */
router.get('/security', (req, res) => {
  res.json({ totp_enabled: !!req.user.totp_enabled, email: req.user.email, last_login_at: req.user.last_login_at });
});

router.post('/security/2fa/setup', async (req, res) => {
  if (req.user.totp_enabled) throw conflict('Two-factor authentication is already enabled');
  const secret = totp.generateSecret();
  run('UPDATE users SET totp_pending_secret = ? WHERE id = ?', secret, req.user.id);
  const url = totp.otpauthUrl(secret, req.user.email);
  res.json({ secret, otpauth_url: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
});

router.post('/security/2fa/enable', (req, res) => {
  const v = validator(req.body);
  const code = v.string('code', { required: true, max: 10 });
  v.done();
  const u = one('SELECT totp_pending_secret FROM users WHERE id = ?', req.user.id);
  if (!u.totp_pending_secret) throw badRequest('Start the setup again');
  if (!totp.verify(u.totp_pending_secret, code)) throw badRequest('Incorrect code', { code: 'Incorrect or expired code' });
  run('UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = 1 WHERE id = ?', req.user.id);
  audit(req, 'security.2fa_enable', 'user', req.user.id, { email: req.user.email });
  res.json({ ok: true });
});

router.post('/security/2fa/disable', (req, res) => {
  const v = validator(req.body);
  const password = v.string('password', { required: true, max: 128 });
  const code = v.string('code', { required: true, max: 10 });
  v.done();
  if (!req.user.totp_enabled) throw conflict('Two-factor authentication is not enabled');
  if (!bcrypt.compareSync(password, req.user.password_hash)) throw badRequest('Incorrect password', { password: 'Incorrect password' });
  if (!totp.verify(req.user.totp_secret, code)) throw badRequest('Incorrect code', { code: 'Incorrect or expired code' });
  run('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', req.user.id);
  audit(req, 'security.2fa_disable', 'user', req.user.id, { email: req.user.email });
  res.json({ ok: true });
});

module.exports = router;
