// Thin fetch wrapper. All mutating calls send the CSRF header expected by the server.
export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields || {}; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'UniBite' } };
  if (form) opts.body = form;                       // FormData (multipart, for images)
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(`/api${path}`, opts); }
  catch { throw new ApiError(0, 'Network error. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new ApiError(res.status, data.error || 'Request failed', data.fields); e.code = data.code; throw e; }
  return data;
}

let mePromise;
export function getMe(force = false) {
  if (!mePromise || force) mePromise = api('/auth/me').then((d) => d.user).catch(() => null);
  return mePromise;
}

export async function logout(to = '/') {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  try { localStorage.removeItem('unibite_cart'); } catch { /* ignore */ }
  location.href = to;
}
