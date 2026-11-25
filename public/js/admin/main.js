// Super Admin Dashboard router. Every action here is re-validated by /api/admin on the server.
import { getMe, logout, api } from '../api.js';
import { esc, initials, timeAgo, $, $$ } from '../ui.js';
import { icon } from '../icons.js';
import { hydrateIcons } from '../components.js';
import { renderOverview, renderAudit } from './overview.js';
import { renderRestaurantList, renderRestaurantDetail, renderRestaurantForm } from './restaurants.js';
import { renderCategories } from './categories.js';
import { renderAccounts } from './accounts.js';
import { renderStudents } from './students.js';
import { renderRequests } from './requests.js';
import { renderSecurity } from './security.js';

hydrateIcons();
const main = $('#main');
export const ctx = { me: null, main };

$('#logout').addEventListener('click', () => logout('/admin/login'));
$('#menu-toggle').addEventListener('click', () => { $('#dash').dataset.navOpen = $('#dash').dataset.navOpen !== 'true'; });

export function setTitle(t) {
  $('#page-title').textContent = t;
  document.title = `${t} · UniBite Admin`;
}

/** Wraps api(): an expired admin session sends you back to /admin/login. */
export async function adminApi(path, opts) {
  try { return await api(path, opts); }
  catch (err) {
    if (err.status === 401 || err.status === 403) location.href = `/admin/login?next=${encodeURIComponent('/admin/' + location.hash)}`;
    throw err;
  }
}

export async function refreshCounts() {
  try {
    const [{ stats }, notif] = await Promise.all([api('/admin/overview'), api('/admin/notifications')]);
    const el = $('#req-count');
    el.textContent = stats.pending_requests;
    el.classList.toggle('hidden', !stats.pending_requests);
    renderNotifications(notif);
  } catch { /* ignore */ }
}

function renderNotifications({ items, unread }) {
  const c = $('#notif-count');
  c.textContent = unread; c.classList.toggle('hidden', !unread);
  $('#notif-panel').innerHTML = `
    <div class="row" style="padding:6px 8px"><strong style="flex:1">Notifications</strong>${unread ? '<button class="btn btn-ghost btn-sm" id="notif-read" style="width:auto">Mark all read</button>' : ''}</div>
    ${items.length ? items.slice(0, 10).map((n) => `<a href="${esc(n.link || '#overview')}" style="align-items:flex-start;${n.read_at ? 'opacity:.65' : ''}">
      ${icon(n.type === 'restaurant_request' ? 'inbox' : 'bell', 'icon-sm')}<span style="flex:1;min-width:0"><strong style="display:block">${esc(n.title)}</strong>
      <span class="small muted" style="font-weight:500">${esc(n.body || '')}</span><span class="small muted" style="display:block;font-weight:500">${timeAgo(n.created_at)}</span></span></a>`).join('')
      : '<p class="small muted" style="padding:8px">No notifications yet.</p>'}`;
  $('#notif-read')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await api('/admin/notifications/read-all', { method: 'POST' }).catch(() => {});
    refreshCounts();
  });
}
const notif = $('#notif');
$('#notif-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = notif.dataset.open !== 'true';
  notif.dataset.open = open; $('#notif-btn').setAttribute('aria-expanded', open);
});
document.addEventListener('click', (e) => { if (!notif.contains(e.target)) { notif.dataset.open = 'false'; $('#notif-btn').setAttribute('aria-expanded', 'false'); } });

function route() {
  const [path, query = ''] = (location.hash.slice(1) || 'overview').split('?');
  const parts = path.split('/');
  const params = new URLSearchParams(query);
  let nav = parts[0];
  $('#dash').dataset.navOpen = 'false';
  notif.dataset.open = 'false';
  main.innerHTML = '<div class="skeleton" style="height:200px"></div>';

  if (parts[0] === 'restaurants' && parts[1] === 'new') { nav = 'new'; renderRestaurantForm(null, params); }
  else if (parts[0] === 'restaurants' && parts[1] && parts[2] === 'edit') renderRestaurantForm(Number(parts[1]), params);
  else if (parts[0] === 'restaurants' && parts[1]) renderRestaurantDetail(Number(parts[1]));
  else if (parts[0] === 'restaurants') renderRestaurantList(params);
  else if (parts[0] === 'categories') renderCategories();
  else if (parts[0] === 'accounts') renderAccounts(params);
  else if (parts[0] === 'students') renderStudents(params);
  else if (parts[0] === 'requests') renderRequests(params);
  else if (parts[0] === 'audit') renderAudit(params);
  else if (parts[0] === 'security') renderSecurity();
  else { nav = 'overview'; renderOverview(); }

  $$('#side-nav a').forEach((a) => (a.dataset.view === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

(async () => {
  ctx.me = await getMe();
  if (!ctx.me || ctx.me.role !== 'admin') return location.replace('/admin/login');
  $('#top-user').innerHTML = `<span class="small muted hide-mobile">${esc(ctx.me.name)}</span><span class="avatar" aria-hidden="true">${esc(initials(ctx.me.name))}</span>`;
  window.addEventListener('hashchange', route);
  route();
  refreshCounts();
  setInterval(refreshCounts, 60000);
})();

/** Generic helper: show an error inside the main area. */
export function mainError(err) {
  main.innerHTML = `<div class="card card-pad"><div class="notice notice-danger">${esc(err.message)}</div></div>`;
}
// Back-compat name used by older views
export const refreshRequestCount = refreshCounts;
