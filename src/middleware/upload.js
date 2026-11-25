const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('../config');
const { badRequest } = require('../utils/errors');

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + ALLOWED[file.mimetype]),
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) =>
    ALLOWED[file.mimetype] ? cb(null, true) : cb(badRequest('Images must be JPG, PNG, WEBP or GIF')),
});

const publicPath = (file) => (file ? `/uploads/${file.filename}` : undefined);

/** Delete a previously uploaded file (only files inside the uploads dir). */
function removeUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const p = path.join(UPLOAD_DIR, path.basename(url));
  fs.promises.unlink(p).catch(() => {});
}

module.exports = { upload, publicPath, removeUpload };
