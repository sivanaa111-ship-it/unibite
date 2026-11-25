const { DAYS } = require('./validate');

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Is the restaurant inside its configured opening hours right now? Handles overnight ranges. */
function isWithinHours(r, now = new Date()) {
  const days = (r.operating_days || '').split(',');
  const dayIdx = (now.getDay() + 6) % 7; // JS: 0=Sun -> our index 6
  const cur = now.getHours() * 60 + now.getMinutes();
  const open = toMin(r.opening_time);
  const close = toMin(r.closing_time);
  if (open === close) return days.includes(DAYS[dayIdx]); // 24h
  if (open < close) return days.includes(DAYS[dayIdx]) && cur >= open && cur < close;
  // Overnight: open today after `open`, or still open from yesterday before `close`
  const prev = DAYS[(dayIdx + 6) % 7];
  return (days.includes(DAYS[dayIdx]) && cur >= open) || (days.includes(prev) && cur < close);
}

/** Can students place orders right now? */
function canOrder(r, now = new Date()) {
  return !!r.is_active && !!r.published_at && r.availability_status !== 'closed' && isWithinHours(r, now);
}

module.exports = { isWithinHours, canOrder };
