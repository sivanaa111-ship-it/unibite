// Manage Restaurant Accounts: owner accounts + invitations.
import { icon } from '../icons.js';
import { esc, fmtDate, fmtDateTime, toast, confirmDialog, openModal, showErrors, withBusy, emptyState, initials, $$ } from '../ui.js';
import { ctx, setTitle, mainError, adminApi as api } from './main.js';
import { inviteOwner } from './restaurants.js';

const INV_BADGE = { pending: 'badge-info', accepted: 'badge-success', revoked: 'badge-neutral', expired: 'badge-warning' };

export async function renderAccounts(params) {
  setTitle('Restaurant Accounts');
  const tab = params.get('tab') === 'invitations' ? 'invitations' : 'accounts';
  ctx.main.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div class="tabs" role="tablist" style="margin:0;border:0;flex:1">
        <button role="tab" aria-selected="${tab === 'accounts'}" data-tab="accounts">${icon('key', 'icon-sm')}Owner accounts</button>
        <button role="tab" aria-selected="${tab === 'invitations'}" data-tab="invitations">${icon('mail', 'icon-sm')}Invitations</button>
      </div>
      <button class="btn btn-primary btn-sm" id="send-invite">${icon('plus', 'icon-sm')}Send invitation</button>
    </div>
    <div id="acc-view"></div>`;
  $$('[data-tab]', ctx.main).forEach((b) => b.addEventListener('click', () => { location.hash = `accounts${b.dataset.tab === 'invitations' ? '?tab=invitations' : ''}`; }));
  ctx.main.querySelector('#send-invite').addEventListener('click', pickRestaurantAndInvite);
  if (tab === 'invitations') return invitations(params);
  return accounts(params);
}

async function pickRestaurantAndInvite() {
  const { items } = await api('/admin/restaurants?pageSize=100&sort=name_asc');
  const m = openModal({
    title: 'Send owner invitation',
    body: `<div class="field"><label for="pick-r">Restaurant</label><select id="pick-r" class="select"><option value="">Choose…</option>
      ${items.map((r) => `<option value="${r.id}">${esc(r.name)}${r.owner_email ? ` (owner: ${esc(r.owner_email)})` : r.account_status === 'invited' ? ' (invitation pending)' : ' (no owner)'}</option>`).join('')}</select></div>`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="pick-next">Continue</button>',
  });
  m.el.querySelector('#pick-next').addEventListener('click', () => {
    const r = items.find((x) => x.id === Number(m.el.querySelector('#pick-r').value));
    if (!r) return;
    m.close();
    inviteOwner(r, () => { location.hash = 'accounts?tab=invitations'; });
  });
}

async function accounts(params) {
  const view = ctx.main.querySelector('#acc-view');
  const state = { q: params.get('q') || '', status: params.get('status') || '', restaurant: params.get('restaurant') || '' };
  const { items: restaurants } = await api('/admin/restaurants?pageSize=100&sort=name_asc');
  view.innerHTML = `<div class="card">
    <form class="toolbar" id="a-filters" role="search">
      <div class="input-icon">${icon('search')}<label class="sr-only" for="a-q">Search accounts</label><input id="a-q" name="q" class="input" placeholder="Search by name, email or restaurant" value="${esc(state.q)}"></div>
      <label class="sr-only" for="a-rest">Restaurant</label>
      <select id="a-rest" name="restaurant" class="select"><option value="">Any restaurant</option>${restaurants.map((r) => `<option value="${r.id}" ${String(r.id) === state.restaurant ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <label class="sr-only" for="a-status">Status</label>
      <select id="a-status" name="status" class="select">${[['', 'Any status'], ['active', 'Active'], ['deactivated', 'Deactivated']].map(([v, l]) => `<option value="${v}" ${v === state.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </form>
    <div class="table-wrap" id="a-table"></div></div>`;
  const form = view.querySelector('#a-filters');
  const apply = () => { Object.assign(state, Object.fromEntries(new FormData(form))); history.replaceState(null, '', `#accounts?${new URLSearchParams(Object.entries(state).filter(([, v]) => v))}`); load(); };
  let t;
  form.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 300); });
  form.addEventListener('change', apply);
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });

  async function load() {
    const table = view.querySelector('#a-table');
    try {
      const { items } = await api(`/admin/restaurant-accounts?${new URLSearchParams(Object.entries(state).filter(([, v]) => v))}`);
      table.innerHTML = items.length ? `<table class="table">
        <thead><tr><th>Owner</th><th>Associated restaurant</th><th>Account status</th><th>Last login</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${items.map((u) => `<tr class="${u.is_active ? '' : 'inactive'}">
          <td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(u.name))}</span><div><div class="name-cell">${esc(u.name)}</div><div class="small muted">${esc(u.email)}</div></div></div></td>
          <td>${u.restaurant_id ? `<a href="#restaurants/${u.restaurant_id}">${esc(u.restaurant_name)}</a>${u.restaurant_active ? '' : ' <span class="badge badge-neutral">Restaurant deactivated</span>'}` : '<span class="badge badge-warning">Not assigned</span>'}</td>
          <td>${u.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Deactivated</span>'}</td>
          <td class="small">${u.last_login_at ? fmtDateTime(u.last_login_at) : '<span class="muted">Never</span>'}</td>
          <td class="small">${fmtDate(u.created_at)}</td>
          <td><div class="actions">
            <button class="icon-btn" data-reassign="${u.id}" aria-label="Reassign ${esc(u.name)}" title="Reassign to another restaurant">${icon('store')}</button>
            ${u.is_active ? `<button class="icon-btn" data-reset="${u.id}" aria-label="Reset access for ${esc(u.name)}" title="Reset access">${icon('key')}</button>` : ''}
            ${u.is_active
              ? `<button class="icon-btn" style="color:var(--color-danger)" data-off="${u.id}" aria-label="Deactivate ${esc(u.name)}" title="Deactivate">${icon('power')}</button>`
              : `<button class="icon-btn" style="color:var(--color-success)" data-on="${u.id}" aria-label="Reactivate ${esc(u.name)}" title="Reactivate">${icon('rotate')}</button>`}
          </div></td></tr>`).join('')}</tbody></table>`
        : emptyState('key', 'No restaurant accounts', 'Owners appear here once they accept an invitation.');
      const find = (id) => items.find((u) => u.id === Number(id));
      $$('[data-off]', table).forEach((b) => b.addEventListener('click', async () => {
        const u = find(b.dataset.off);
        const ok = await confirmDialog({ title: 'Deactivate restaurant account?', message: `<strong>${esc(u.name)}</strong> (${esc(u.email)}) will be signed out immediately and cannot log in or manage ${esc(u.restaurant_name || 'any restaurant')}. The restaurant itself stays online.`, confirmText: 'Deactivate account', danger: true });
        if (!ok) return;
        try { await api(`/admin/restaurant-accounts/${u.id}/deactivate`, { method: 'POST' }); toast('Account deactivated'); load(); } catch (err) { toast(err.message, 'error'); }
      }));
      $$('[data-on]', table).forEach((b) => b.addEventListener('click', async () => {
        try { await api(`/admin/restaurant-accounts/${b.dataset.on}/reactivate`, { method: 'POST' }); toast('Account reactivated'); load(); } catch (err) { toast(err.message, 'error'); }
      }));
      $$('[data-reset]', table).forEach((b) => b.addEventListener('click', async () => {
        const u = find(b.dataset.reset);
        const ok = await confirmDialog({ title: 'Reset account access?', message: `<strong>${esc(u.name)}</strong> will be signed out of all devices and emailed a single-use link (valid 60 minutes) to choose a new password. Passwords are never shown to anyone.`, confirmText: 'Reset access', danger: true });
        if (!ok) return;
        try { await api(`/admin/restaurant-accounts/${u.id}/reset-access`, { method: 'POST' }); toast(`Reset link emailed to ${u.email}`); } catch (err) { toast(err.message, 'error'); }
      }));
      $$('[data-reassign]', table).forEach((b) => b.addEventListener('click', () => reassign(find(b.dataset.reassign), restaurants, load)));
    } catch (err) { table.innerHTML = `<div class="card-pad"><div class="notice notice-danger">${esc(err.message)}</div></div>`; }
  }
  load();
}

function reassign(u, restaurants, after) {
  const free = restaurants.filter((r) => r.account_status !== 'active' && r.account_status !== 'deactivated' && r.id !== u.restaurant_id);
  const m = openModal({
    title: 'Reassign owner',
    body: `<p class="small">Move <strong>${esc(u.name)}</strong> ${u.restaurant_name ? `from <strong>${esc(u.restaurant_name)}</strong> ` : ''}to another restaurant. They will be signed out and lose access to their current restaurant. Only restaurants without an owner are listed.</p>
      <form id="ra-form" class="stack" novalidate><div class="field"><label for="ra-r">New restaurant</label>
        <select id="ra-r" name="restaurant_id" class="select"><option value="">Choose…</option>${free.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div></form>
      ${u.restaurant_id ? '<p class="small muted">To remove the owner from their restaurant without moving them, use Unassign.</p>' : ''}`,
    footer: `${u.restaurant_id ? '<button class="btn btn-ghost" id="ra-unassign">Unassign</button>' : ''}<span class="spacer"></span><button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="ra-save" data-busy="Saving…">Reassign</button>`,
  });
  const f = m.el.querySelector('#ra-form');
  const save = m.el.querySelector('#ra-save');
  save.addEventListener('click', () => withBusy(save, async () => {
    try { await api(`/admin/restaurant-accounts/${u.id}/reassign`, { method: 'POST', body: Object.fromEntries(new FormData(f)) }); m.close(); toast('Owner reassigned'); after(); }
    catch (err) { showErrors(f, err); }
  }));
  m.el.querySelector('#ra-unassign')?.addEventListener('click', async () => {
    try { await api(`/admin/restaurant-accounts/${u.id}/unassign`, { method: 'POST' }); m.close(); toast('Owner unassigned'); after(); }
    catch (err) { toast(err.message, 'error'); }
  });
}

async function invitations(params) {
  const view = ctx.main.querySelector('#acc-view');
  const status = params.get('status') || 'pending';
  try {
    const { items } = await api(`/admin/invitations?status=${status}`);
    view.innerHTML = `<div class="card">
      <div class="toolbar"><p class="muted small" style="margin:0;flex:1">Invitation links are single-use and expire after 72 hours. Resending revokes the old link and emails a new one.</p>
        <div class="segmented" role="group" aria-label="Filter invitations">${[['pending', 'Pending'], ['accepted', 'Accepted'], ['expired', 'Expired'], ['revoked', 'Revoked'], ['all', 'All']].map(([v, l]) => `<button type="button" data-istatus="${v}" aria-pressed="${v === status}">${l}</button>`).join('')}</div></div>
      <div class="table-wrap">${items.length ? `<table class="table">
        <thead><tr><th>Email</th><th>Restaurant</th><th>Status</th><th>Sent</th><th>Expires / accepted</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${items.map((i) => `<tr>
          <td class="name-cell">${esc(i.email)}${i.replace_owner ? ' <span class="badge badge-warning plain">replaces owner</span>' : ''}</td>
          <td><a href="#restaurants/${i.restaurant_id}">${esc(i.restaurant_name)}</a></td>
          <td><span class="badge ${INV_BADGE[i.status]}">${esc(i.status)}</span></td>
          <td class="small">${fmtDateTime(i.created_at)}${i.invited_by_name ? `<div class="muted">by ${esc(i.invited_by_name)}</div>` : ''}</td>
          <td class="small">${i.accepted_at ? fmtDateTime(i.accepted_at) : fmtDateTime(i.expires_at)}</td>
          <td><div class="actions">
            ${i.status !== 'accepted' ? `<button class="btn btn-ghost btn-sm" data-resend="${i.id}">Resend</button>` : ''}
            ${i.status === 'pending' ? `<button class="btn btn-ghost btn-sm" style="color:var(--color-danger)" data-revoke="${i.id}">Revoke</button>` : ''}
          </div></td></tr>`).join('')}</tbody></table>` : emptyState('mail', `No ${status === 'all' ? '' : status} invitations`)}</div></div>`;
    $$('[data-istatus]', view).forEach((b) => b.addEventListener('click', () => { location.hash = `accounts?tab=invitations&status=${b.dataset.istatus}`; }));
    $$('[data-resend]', view).forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/admin/invitations/${b.dataset.resend}/resend`, { method: 'POST' }); toast('New invitation link sent'); invitations(params); }
      catch (err) { toast(err.message, 'error'); }
    }));
    $$('[data-revoke]', view).forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Revoke invitation?', message: 'The invitation link will stop working immediately.', confirmText: 'Revoke', danger: true });
      if (!ok) return;
      try { await api(`/admin/invitations/${b.dataset.revoke}/revoke`, { method: 'POST' }); toast('Invitation revoked'); invitations(params); }
      catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) { mainError(err); }
}
