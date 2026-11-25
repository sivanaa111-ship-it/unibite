// Manage Students. Only basic account information is shown — never passwords or auth secrets.
import { icon } from '../icons.js';
import { esc, money, fmtDate, fmtDateTime, toast, confirmDialog, openModal, emptyState, initials, orderBadge, $$ } from '../ui.js';
import { pagerHtml } from '../components.js';
import { ctx, setTitle, adminApi as api } from './main.js';

const STATUS_BADGE = {
  active: '<span class="badge badge-success">Active</span>',
  pending: '<span class="badge badge-warning">Email not verified</span>',
  deactivated: '<span class="badge badge-danger">Deactivated</span>',
};
const ID_BADGE = (s) => (s === 'verified' ? '<span class="badge badge-success plain">ID verified</span>' : '<span class="badge badge-neutral plain">ID unverified</span>');

export async function renderStudents(params) {
  setTitle('Students');
  const state = { q: params.get('q') || '', status: params.get('status') || '', verification: params.get('verification') || '', sort: params.get('sort') || 'newest', page: Number(params.get('page')) || 1 };
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  ctx.main.innerHTML = `<div class="card">
    <form class="toolbar" id="s-filters" role="search">
      <div class="input-icon">${icon('search')}<label class="sr-only" for="s-q">Search students</label><input id="s-q" name="q" class="input" placeholder="Search by name, email or University ID" value="${esc(state.q)}"></div>
      <label class="sr-only" for="s-status">Account status</label>
      <select id="s-status" name="status" class="select">${opt([['', 'Any status'], ['active', 'Active'], ['pending', 'Email not verified'], ['deactivated', 'Deactivated']], state.status)}</select>
      <label class="sr-only" for="s-ver">ID verification</label>
      <select id="s-ver" name="verification" class="select">${opt([['', 'Any ID status'], ['verified', 'ID verified'], ['unverified', 'ID unverified']], state.verification)}</select>
      <label class="sr-only" for="s-sort">Sort</label>
      <select id="s-sort" name="sort" class="select">${opt([['newest', 'Newest registrations'], ['oldest', 'Oldest registrations'], ['name', 'Name A–Z']], state.sort)}</select>
    </form>
    <div class="table-wrap" id="s-table"></div>
    <nav class="pager" id="s-pager" aria-label="Pagination"></nav></div>`;

  const form = ctx.main.querySelector('#s-filters');
  const apply = (reset = true) => {
    Object.assign(state, Object.fromEntries(new FormData(form)));
    if (reset) state.page = 1;
    history.replaceState(null, '', `#students?${new URLSearchParams(Object.entries(state).filter(([, v]) => v))}`);
    load();
  };
  let t;
  form.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 300); });
  form.addEventListener('change', () => apply());
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  ctx.main.querySelector('#s-pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
    state.page = Number(b.dataset.page); apply(false);
  });

  async function load() {
    const table = ctx.main.querySelector('#s-table');
    try {
      const d = await api(`/admin/students?${new URLSearchParams(Object.entries(state).filter(([, v]) => v))}`);
      table.innerHTML = d.items.length ? `<table class="table">
        <thead><tr><th>Student</th><th>University ID</th><th>Status</th><th>Orders</th><th>Registered</th><th>Last login</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${d.items.map((s) => `<tr class="${s.status === 'deactivated' ? 'inactive' : ''}">
          <td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(s.name))}</span><div><div class="name-cell">${esc(s.name)}</div><div class="small muted">${esc(s.email)}</div></div></div></td>
          <td><span style="font-family:ui-monospace,monospace">${esc(s.university_id || '—')}</span><div>${ID_BADGE(s.verification_status)}</div></td>
          <td>${STATUS_BADGE[s.status]}</td>
          <td>${s.order_count}</td>
          <td class="small">${fmtDate(s.created_at)}</td>
          <td class="small">${s.last_login_at ? fmtDateTime(s.last_login_at) : '<span class="muted">Never</span>'}</td>
          <td><div class="actions">
            <button class="icon-btn" data-view="${s.id}" aria-label="View ${esc(s.name)}" title="View">${icon('eye')}</button>
            ${s.status === 'deactivated' || s.status === 'pending'
              ? `<button class="icon-btn" style="color:var(--color-success)" data-on="${s.id}" aria-label="Activate ${esc(s.name)}" title="Activate">${icon('rotate')}</button>` : ''}
            ${s.status !== 'deactivated' ? `<button class="icon-btn" style="color:var(--color-danger)" data-off="${s.id}" aria-label="Deactivate ${esc(s.name)}" title="Deactivate">${icon('power')}</button>` : ''}
          </div></td></tr>`).join('')}</tbody></table>` : emptyState('users', 'No students found');
      ctx.main.querySelector('#s-pager').innerHTML = pagerHtml(d, 'students');
      const find = (id) => d.items.find((s) => s.id === Number(id));
      $$('[data-view]', table).forEach((b) => b.addEventListener('click', () => details(Number(b.dataset.view), load)));
      $$('[data-off]', table).forEach((b) => b.addEventListener('click', () => setStatus(find(b.dataset.off), false, load)));
      $$('[data-on]', table).forEach((b) => b.addEventListener('click', () => setStatus(find(b.dataset.on), true, load)));
    } catch (err) { table.innerHTML = `<div class="card-pad"><div class="notice notice-danger">${esc(err.message)}</div></div>`; }
  }
  load();
}

async function setStatus(s, activate, after) {
  const ok = await confirmDialog({
    title: activate ? 'Activate student account?' : 'Deactivate student account?',
    message: activate
      ? `<strong>${esc(s.name)}</strong> (${esc(s.email)}) will be able to log in${s.status === 'pending' ? '. This also marks their email as verified' : ''}.`
      : `<strong>${esc(s.name)}</strong> (${esc(s.email)}) will be signed out and blocked from logging in. Their order history and ratings are kept.`,
    confirmText: activate ? 'Activate' : 'Deactivate account', danger: !activate,
  });
  if (!ok) return;
  try { await api(`/admin/students/${s.id}/${activate ? 'activate' : 'deactivate'}`, { method: 'POST' }); toast(activate ? 'Account activated' : 'Account deactivated'); after(); }
  catch (err) { toast(err.message, 'error'); }
}

async function details(id, after) {
  try {
    const { student: s, recent_orders: orders } = await api(`/admin/students/${id}`);
    const m = openModal({
      title: s.name, size: 'modal-lg',
      body: `<dl class="detail-grid">
          <div><dt>Email</dt><dd>${esc(s.email)}</dd></div>
          <div><dt>University ID</dt><dd>${esc(s.university_id || '—')} ${ID_BADGE(s.verification_status)}</dd></div>
          <div><dt>Account status</dt><dd>${STATUS_BADGE[s.status]}</dd></div>
          <div><dt>Email verified</dt><dd>${s.email_verified_at ? fmtDateTime(s.email_verified_at) : 'Not yet'}</dd></div>
          <div><dt>Registered</dt><dd>${fmtDateTime(s.created_at)}</dd></div>
          <div><dt>Last login</dt><dd>${s.last_login_at ? fmtDateTime(s.last_login_at) : 'Never'}</dd></div>
          <div><dt>Orders</dt><dd>${s.order_count}</dd></div><div><dt>Ratings given</dt><dd>${s.rating_count}</dd></div>
        </dl>
        <h3 style="margin-top:16px">Recent orders</h3>
        ${orders.length ? `<table class="table"><tbody>${orders.map((o) => `<tr><td>#${o.id}</td><td>${esc(o.restaurant_name)}</td><td>${money(o.total)}</td><td>${orderBadge(o.status)}</td><td class="small">${fmtDate(o.created_at)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No orders yet.</p>'}`,
      footer: `${s.verification_status !== 'verified' ? '<button class="btn btn-secondary" id="verify-id">Mark University ID verified</button>' : ''}<button class="btn btn-primary" data-close>Close</button>`,
    });
    m.el.querySelector('#verify-id')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Verify University ID?', message: `Confirm that you checked <strong>${esc(s.university_id)}</strong> against official university records.`, confirmText: 'Mark verified' });
      if (!ok) return;
      try { await api(`/admin/students/${s.id}/verify-id`, { method: 'POST' }); toast('University ID verified'); after(); }
      catch (err) { toast(err.message, 'error'); }
    });
  } catch (err) { toast(err.message, 'error'); }
}
