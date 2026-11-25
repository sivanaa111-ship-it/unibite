/**
 * Small declarative validator. Each rule returns the cleaned value or records an error.
 *   const v = validator(req.body);
 *   const name = v.string('name', { required: true, max: 100 });
 *   v.done(); // throws 400 with field errors
 */
const { badRequest } = require('./errors');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^[+()\-\s\d]{6,25}$/;

function validator(src = {}, { partial = false } = {}) {
  const errors = {};
  const has = (k) => src[k] !== undefined && src[k] !== null && String(src[k]).trim() !== '';
  const skip = (k, required) => {
    if (has(k)) return false;
    if (required && !partial) errors[k] = 'This field is required';
    return true;
  };

  return {
    errors,
    present: (k) => src[k] !== undefined,
    string(k, { required = false, max = 255, min = 0 } = {}) {
      if (skip(k, required)) return undefined;
      const s = String(src[k]).trim();
      if (s.length < min) errors[k] = `Must be at least ${min} characters`;
      else if (s.length > max) errors[k] = `Must be at most ${max} characters`;
      return s;
    },
    email(k, { required = false } = {}) {
      if (skip(k, required)) return undefined;
      const s = String(src[k]).trim().toLowerCase();
      if (!EMAIL_RE.test(s) || s.length > 254) errors[k] = 'Enter a valid email address';
      return s;
    },
    phone(k, { required = false } = {}) {
      if (skip(k, required)) return undefined;
      const s = String(src[k]).trim();
      if (!PHONE_RE.test(s)) errors[k] = 'Enter a valid phone number';
      return s;
    },
    time(k, { required = false } = {}) {
      if (skip(k, required)) return undefined;
      const s = String(src[k]).trim();
      if (!TIME_RE.test(s)) errors[k] = 'Use HH:MM (24-hour) format';
      return s;
    },
    oneOf(k, values, { required = false } = {}) {
      if (skip(k, required)) return undefined;
      const s = String(src[k]).trim();
      if (!values.includes(s)) errors[k] = `Must be one of: ${values.join(', ')}`;
      return s;
    },
    int(k, { required = false, min = -Infinity, max = Infinity } = {}) {
      if (skip(k, required)) return undefined;
      const n = Number(src[k]);
      if (!Number.isInteger(n) || n < min || n > max) errors[k] = 'Enter a valid whole number';
      return n;
    },
    number(k, { required = false, min = -Infinity, max = Infinity } = {}) {
      if (skip(k, required)) return undefined;
      const n = Number(src[k]);
      if (!Number.isFinite(n) || n < min || n > max) errors[k] = `Enter a number between ${min} and ${max}`;
      return Math.round(n * 100) / 100;
    },
    bool(k) {
      if (src[k] === undefined) return undefined;
      return src[k] === true || src[k] === 'true' || src[k] === '1' || src[k] === 1 || src[k] === 'on';
    },
    days(k, { required = false } = {}) {
      if (skip(k, required)) return undefined;
      const list = Array.isArray(src[k]) ? src[k] : String(src[k]).split(',');
      const clean = [...new Set(list.map((d) => String(d).trim()).filter(Boolean))];
      if (!clean.length || clean.some((d) => !DAYS.includes(d))) {
        errors[k] = 'Select at least one valid operating day';
        return undefined;
      }
      return DAYS.filter((d) => clean.includes(d)).join(',');
    },
    password(k, { required = true } = {}) {
      if (skip(k, required)) return undefined;
      const s = String(src[k]);
      if (s.length < 8 || !/[A-Za-z]/.test(s) || !/\d/.test(s) || s.length > 128) {
        errors[k] = 'Password must be 8+ characters and include a letter and a number';
      }
      return s;
    },
    fail(k, msg) { errors[k] = msg; },
    done() {
      if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields', errors);
    },
  };
}

module.exports = { validator, DAYS };
