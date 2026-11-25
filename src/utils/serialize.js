const { isWithinHours, canOrder } = require('./hours');

function restaurant(r) {
  if (!r) return r;
  return {
    ...r,
    is_active: !!r.is_active,
    is_published: !!r.published_at,
    operating_days: r.operating_days ? r.operating_days.split(',') : [],
    avg_rating: r.avg_rating != null ? Math.round(r.avg_rating * 10) / 10 : null,
    rating_count: r.rating_count || 0,
    open_now: isWithinHours(r),
    accepting_orders: canOrder(r),
  };
}

function user(u) {
  if (!u) return u;
  // Never expose credentials or 2FA secrets
  const { password_hash, token_version, totp_secret, totp_pending_secret, ...rest } = u;
  return {
    ...rest,
    is_active: rest.status === 'active',
    totp_enabled: !!rest.totp_enabled,
    must_change_password: !!rest.must_change_password,
    restaurant_active: rest.restaurant_active == null ? null : !!rest.restaurant_active,
  };
}

function product(p) {
  return p && { ...p, is_available: !!p.is_available, is_active: !!p.is_active };
}

module.exports = { restaurant, user, product };
