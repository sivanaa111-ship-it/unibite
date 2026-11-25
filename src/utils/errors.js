class HttpError extends Error {
  constructor(status, message, details, code) {
    super(message);
    this.status = status;
    this.details = details;
    if (code) this.code = code; // machine-readable reason, e.g. EMAIL_NOT_VERIFIED
  }
}
const badRequest = (msg, details) => new HttpError(400, msg, details);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const forbidden = (msg = 'You do not have permission to do this', code) => new HttpError(403, msg, undefined, code);
const unauthorized = (msg = 'Please log in', code) => new HttpError(401, msg, undefined, code);
const conflict = (msg, details) => new HttpError(409, msg, details);

module.exports = { HttpError, badRequest, notFound, forbidden, unauthorized, conflict };
