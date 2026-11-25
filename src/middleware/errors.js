const multer = require('multer');
const { HttpError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 3 MB or smaller' : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, fields: err.details, code: err.code });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err && /UNIQUE constraint failed/.test(err.message)) {
    return res.status(409).json({ error: 'A record with these details already exists' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};
