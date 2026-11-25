/**
 * Single-use, expiring tokens. Only a SHA-256 hash is stored; the raw token is
 * shown once (in an emailed link) and cannot be recovered from the database.
 */
const crypto = require('crypto');
const { one, run } = require('../db');
const { TTL } = require('../config');

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function issue(purpose, userId, createdBy = null) {
  const token = newToken();
  // Only one live token per user and purpose
  run(`UPDATE auth_tokens SET used_at = datetime('now') WHERE user_id = ? AND purpose = ? AND used_at IS NULL`, userId, purpose);
  run(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_by) VALUES (?, ?, ?, datetime('now', ?), ?)`,
    userId, purpose, hash(token), `+${TTL[purpose]} minutes`, createdBy
  );
  return token;
}

/** Look up a valid token without consuming it. */
function peek(purpose, token) {
  return one(
    `SELECT t.*, u.email, u.name, u.status AS user_status FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.purpose = ? AND t.used_at IS NULL AND t.expires_at > datetime('now')`,
    hash(token), purpose
  );
}

/** Consume a valid token (returns the row or null). Atomic: a token can only be used once. */
function consume(purpose, token) {
  const row = peek(purpose, token);
  if (!row) return null;
  const res = run(`UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`, row.id);
  return res.changes === 1 ? row : null;
}

module.exports = { newToken, hash, issue, peek, consume };
