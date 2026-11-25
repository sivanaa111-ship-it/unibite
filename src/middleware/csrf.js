/**
 * CSRF defence: the session cookie is SameSite=Lax, and every state-changing API call
 * must carry a custom header, which browsers will not attach to cross-site form posts.
 */
const { forbidden } = require('../utils/errors');

module.exports = function csrf(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'UniBite') return next(forbidden('Missing request verification header'));
  next();
};
