/** Small in-memory fixed-window rate limiter (per process). */
const { HttpError } = require('../utils/errors');

module.exports = function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests. Please try again later.' }) {
  const hits = new Map();
  return (req, _res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === 'true') return next();
    const k = key(req);
    const now = Date.now();
    const rec = hits.get(k);
    if (!rec || rec.reset < now) { hits.set(k, { n: 1, reset: now + windowMs }); return next(); }
    rec.n += 1;
    if (rec.n > max) return next(new HttpError(429, message));
    next();
  };
};
