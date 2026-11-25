const { APP_URL } = require('../config');
/** Absolute URL for emailed links. */
module.exports = function link(req, pathAndQuery) {
  const base = APP_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}${pathAndQuery}`;
};
