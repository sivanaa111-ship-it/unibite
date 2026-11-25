/** DEVELOPMENT ONLY (never mounted when NODE_ENV=production): read the email outbox. */
const express = require('express');
const { all } = require('../db');

const router = express.Router();
router.get('/outbox', (req, res) => {
  const to = String(req.query.to || '').trim();
  const items = all(
    `SELECT id, to_email, subject, text_body, html_body, status, created_at FROM email_outbox
      ${to ? 'WHERE to_email = ? COLLATE NOCASE' : ''} ORDER BY id DESC LIMIT 50`,
    ...(to ? [to] : [])
  );
  res.json({ items });
});
module.exports = router;
