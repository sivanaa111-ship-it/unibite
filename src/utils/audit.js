const { run } = require('../db');

/**
 * Append an entry to the (append-only) audit log.
 * opts: { summary, before, after } — before/after hold the previous and updated values.
 */
function audit(req, action, entityType, entityId, opts = {}) {
  const { before, after, ...summary } = opts;
  run(
    `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, details, before_data, after_data, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    req && req.user ? req.user.id : null,
    action,
    entityType,
    entityId ?? null,
    Object.keys(summary).length ? JSON.stringify(summary) : null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    (req && req.ip) || null
  );
}

module.exports = { audit };
