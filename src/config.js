const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IS_PROD = process.env.NODE_ENV === 'production';

// Use JWT_SECRET from env in production; in development persist a random one.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (IS_PROD) throw new Error('JWT_SECRET must be set in production');
  const file = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const list = (v, d) => (v || d).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

module.exports = {
  ROOT,
  DATA_DIR,
  UPLOAD_DIR,
  IS_PROD,
  PORT: Number(process.env.PORT) || 3000,
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, 'unibite.db'),
  JWT_SECRET: loadSecret(),
  COOKIE_NAME: 'unibite_session',
  // Session lifetimes (hours)
  SESSION_HOURS: { student: 24 * 7, restaurant: 24, admin: 8 },
  // Public base URL used in emailed links (falls back to the request origin)
  APP_URL: (process.env.APP_URL || '').replace(/\/$/, ''),

  // Token lifetimes (minutes)
  TTL: { email_verification: 60 * 24, password_reset: 60, mfa_challenge: 5, invitation: 60 * 72 },

  // University verification
  UNIVERSITY_EMAIL_DOMAINS: list(process.env.UNIVERSITY_EMAIL_DOMAINS, 'unibite.edu'),
  UNIVERSITY_ID_PATTERN: new RegExp(process.env.UNIVERSITY_ID_PATTERN || '^[0-9]{7,10}$'),
  // 'roster' = ID must exist in university_roster; 'format' = pattern only; 'auto' = roster when one is loaded
  UNIVERSITY_ID_VERIFICATION: process.env.UNIVERSITY_ID_VERIFICATION || 'auto',

  // Email (SMTP). Without SMTP_HOST, mail is written to the email_outbox table (+ dev mailbox page).
  SMTP: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || 'UniBite <no-reply@unibite.local>',
  },
  // Dev mailbox page (/dev/mailbox.html) — never enabled in production
  DEV_MAILBOX: !IS_PROD && process.env.DEV_MAILBOX !== 'false',
};
