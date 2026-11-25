/**
 * University identity checks for student registration.
 *  - Email must belong to an allowed university domain (UNIVERSITY_EMAIL_DOMAINS).
 *  - University ID must match UNIVERSITY_ID_PATTERN and, when a roster is in use,
 *    must exist in university_roster (and match the roster email if one is recorded).
 */
const { one } = require('../db');
const cfg = require('../config');

function isUniversityEmail(email) {
  const domain = String(email).split('@')[1] || '';
  return cfg.UNIVERSITY_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function rosterMode() {
  if (cfg.UNIVERSITY_ID_VERIFICATION === 'roster') return true;
  if (cfg.UNIVERSITY_ID_VERIFICATION === 'format') return false;
  return !!one('SELECT 1 AS x FROM university_roster LIMIT 1');
}

/** Returns { ok, status: 'verified'|'unverified', error } */
function checkUniversityId(universityId, email) {
  const id = String(universityId || '').trim();
  if (!cfg.UNIVERSITY_ID_PATTERN.test(id)) return { ok: false, error: 'Enter a valid University ID' };
  if (!rosterMode()) return { ok: true, status: 'unverified' };
  const row = one('SELECT * FROM university_roster WHERE university_id = ?', id);
  if (!row) return { ok: false, error: 'This University ID was not found in the university records' };
  if (row.email && row.email.toLowerCase() !== String(email).toLowerCase()) {
    return { ok: false, error: 'This University ID is registered to a different university email' };
  }
  return { ok: true, status: 'verified' };
}

module.exports = { isUniversityEmail, checkUniversityId, rosterMode };
