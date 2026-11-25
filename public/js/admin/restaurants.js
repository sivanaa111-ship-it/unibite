import { icon } from '../icons.js';
import {
  esc, money, fmtDate, fmtDateTime, hoursText, restaurantImg, availabilityBadge, orderBadge, emptyState,
  toast, confirmDialog, openModal, showErrors, clearErrors, withBusy, $$,
} from '../ui.js';
import { pagerHtml } from '../components.js';
import { ctx, setTitle, mainError, refreshCounts, adminApi as api } from './main.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const availText = { open: 'Open', busy: 'Busy', closed: 'Closed' };

export function restaurantStatusBadge(r) {
  if (!r.is_active) return '<span class="badge badge-neutral">Deactivated</span>';
  if (!r.is_published) return '<span class="badge badge-warning">Draft</span>';
  return '<span class="badge badge-success">Active</span>';
}
export function accountBadge(r) {
  return {
    active: `<span class="badge badge-success">Owner active</span>`,
    deactivated: '<span class="badge badge-danger">Owner deactivated</span>',
    invited: '<span class="badge badge-info">Invitation sent</span>',
    none: '<span class="badge badge-neutral">No owner</span>',
  }[r.account_status] || '';
}

/* =========================================================================
   Management table
   ========================================================================= */
export async function renderRestaurantList(params) {
  setTitle('Manage Restaurants');
  const state = {
    q: params.get('q') || '', category: params.get('category') || '', status: params.get('status') || '',
    account: params.get('account') || '', sort: params.get('sort') || 'name_asc', page: Number(params.get('page')) || 1,
  };
  const { items: cats } = await api('/admin/categories').catch(() => ({ items: [] }));
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  ctx.main.innerHTML = `
    <div class="card">
      <form class="toolbar" id="r-filters" role="search">
        <div class="input-icon">${icon('search')}<label for="f-q" class="sr-only">Search by restaurant name</label>
          <input id="f-q" name="q" class="input" placeholder="Search by restaurant name or location" value="${esc(state.q)}"></div>
        <label class="sr-only" for="f-cat">Category</label>
        <select id="f-cat" name="category" class="select"><option value="">All categories</option>${cats.map((c) => `<option value="${c.id}" ${String(c.id) === state.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <label class="sr-only" for="f-status">Restaurant status</label>
        <select id="f-status" name="status" class="select">${opt([['', 'Any restaurant status'], ['active', 'Active'], ['draft', 'Draft (unpublished)'], ['inactive', 'Deactivated']], state.status)}</select>
        <label class="sr-only" for="f-account">Account status</label>
        <select id="f-account" name="account" class="select">${opt([['', 'Any account status'], ['active', 'Owner active'], ['invited', 'Invitation sent'], ['none', 'No owner'], ['deactivated', 'Owner deactivated']], state.account)}</select>
        <label class="sr-only" for="f-sort">Sort</label>
        <select id="f-sort" name="sort" class="select">${opt([['name_asc', 'Name A–Z'], ['name_desc', 'Name Z–A'], ['newest', 'Newest first'], ['oldest', 'Oldest first']], state.sort)}</select>
      </form>
      <div class="table-wrap" id="r-table" aria-live="polite"></div>
      <nav class="pager" id="r-pager" aria-label="Pagination"></nav>
    </div>`;

  const form = ctx.main.querySelector('#r-filters');
  const apply = (resetPage = true) => {
    Object.assign(state, Object.fromEntries(new FormData(form)));
    if (resetPage) state.page = 1;
    history.replaceState(null, '', `#restaurants?${new URLSearchParams(Object.entries(state).filter(([, v]) => v !== '' && v != null))}`);
    load();
  };
  let t;
  form.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 300); });
  form.addEventListener('change', () => apply());
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  ctx.main.querySelector('#r-pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
    state.page = Number(b.dataset.page); apply(false);
  });

  async function load() {
    const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v !== '' && v != null));
    const table = ctx.main.querySelector('#r-table');
    if (!table) return;
    table.innerHTML = '<div class="card-pad"><div class="skeleton" style="height:120px"></div></div>';
    try {
      const d = await api(`/admin/restaurants?${qs}&pageSize=10`);
      table.innerHTML = d.items.length ? `<table class="table">
        <thead><tr>
          <th scope="col"><span class="sr-only">Restaurant image</span></th>
          <th scope="col"><button class="sort-btn" id="sort-name">Restaurant name ${icon('arrowUpDown', 'icon-sm')}<span class="sr-only">(sort ${state.sort === 'name_desc' ? 'A–Z' : 'Z–A'})</span></button></th>
          <th scope="col">Category</th><th scope="col">Location</th>
          <th scope="col">Restaurant status</th><th scope="col">Account status</th><th scope="col">Date added</th><th scope="col" style="text-align:right">Actions</th>
        </tr></thead>
        <tbody>${d.items.map((r) => `
          <tr class="${r.is_active ? '' : 'inactive'}">
            <td><div class="thumb">${restaurantImg(r, 'logo')}</div></td>
            <td><a href="#restaurants/${r.id}" class="name-cell">${esc(r.name)}</a><div class="small muted">${esc(hoursText(r))} · ${availText[r.availability_status]}</div></td>
            <td>${esc(r.category_name)}</td>
            <td>${esc(r.campus_location)}</td>
            <td>${restaurantStatusBadge(r)}</td>
            <td>${accountBadge(r)}${r.owner_email ? `<div class="small muted">${esc(r.owner_email)}</div>` : r.pending_invite_email ? `<div class="small muted">${esc(r.pending_invite_email)}</div>` : ''}</td>
            <td class="small nowrap">${fmtDate(r.created_at)}</td>
            <td><div class="actions">
              <a class="icon-btn" href="#restaurants/${r.id}" aria-label="View ${esc(r.name)}" title="View">${icon('eye')}</a>
              <a class="icon-btn" href="#restaurants/${r.id}/edit" aria-label="Edit ${esc(r.name)}" title="Edit">${icon('edit')}</a>
              <button class="icon-btn" data-invite="${r.id}" aria-label="Invite owner for ${esc(r.name)}" title="Invite restaurant owner">${icon('mail')}</button>
              ${r.is_active
                ? `<button class="icon-btn" style="color:var(--color-danger)" data-deactivate="${r.id}" aria-label="Deactivate ${esc(r.name)}" title="Deactivate">${icon('power')}</button>`
                : `<button class="icon-btn" style="color:var(--color-success)" data-reactivate="${r.id}" aria-label="Reactivate ${esc(r.name)}" title="Reactivate">${icon('rotate')}</button>`}
            </div></td>
          </tr>`).join('')}</tbody></table>`
        : emptyState('store', 'No restaurants found', 'Try different filters, or add a new restaurant.', '<a class="btn btn-primary" href="#restaurants/new">Add Restaurant</a>');
      ctx.main.querySelector('#r-pager').innerHTML = pagerHtml(d, 'restaurants');
      table.querySelector('#sort-name')?.addEventListener('click', () => { form.sort.value = state.sort === 'name_asc' ? 'name_desc' : 'name_asc'; apply(false); });
      bindActions(table, d.items, load);
    } catch (err) { table.innerHTML = `<div class="card-pad"><div class="notice notice-danger">${esc(err.message)}</div></div>`; }
  }
  load();
}

/** Wire deactivate / reactivate / invite / publish buttons inside `root`. */
function bindActions(root, list, after) {
  const find = (id) => list.find((r) => r.id === Number(id));
  $$('[data-deactivate]', root).forEach((b) => b.addEventListener('click', () => deactivate(find(b.dataset.deactivate), after)));
  $$('[data-reactivate]', root).forEach((b) => b.addEventListener('click', () => reactivate(find(b.dataset.reactivate), after)));
  $$('[data-invite]', root).forEach((b) => b.addEventListener('click', () => inviteOwner(find(b.dataset.invite), after)));
  $$('[data-publish]', root).forEach((b) => b.addEventListener('click', () => publish(find(b.dataset.publish), b.dataset.action, after)));
}

const entityBox = (r) => `<div class="entity-box"><div class="thumb">${restaurantImg(r, 'logo')}</div>
  <div><strong>${esc(r.name)}</strong><div class="small muted">${esc(r.category_name)} · ${esc(r.campus_location)} · ID #${r.id}</div></div></div>`;

async function deactivate(r, after) {
  const res = await confirmDialog({
    title: 'Deactivate restaurant?',
    message: 'You are about to deactivate this restaurant:',
    entityHtml: `${entityBox(r)}
      <ul class="small" style="padding-left:18px;margin:0 0 12px">
        <li>It will disappear from public browsing and cannot receive new orders.</li>
        <li>Its menu and restaurant information become read-only for the owner.</li>
        <li>The owner can still view and complete orders that were already placed.</li>
        <li>All orders, ratings and history are preserved. You can reactivate it at any time.</li>
      </ul>`,
    confirmText: 'Yes, deactivate restaurant', danger: true, withReason: true,
  });
  if (!res) return;
  try {
    const d = await api(`/admin/restaurants/${r.id}/deactivate`, { method: 'POST', body: { reason: res.reason } });
    toast(`${r.name} was deactivated${d.open_orders ? ` · ${d.open_orders} open order(s) can still be completed by the owner` : ''}`);
    after();
  } catch (err) { toast(err.message, 'error'); }
}

async function reactivate(r, after) {
  const ok = await confirmDialog({
    title: 'Reactivate restaurant?',
    message: 'The restaurant returns to public browsing (if published) and can receive orders again. No new record is created.',
    entityHtml: entityBox(r), confirmText: 'Reactivate',
  });
  if (!ok) return;
  try { await api(`/admin/restaurants/${r.id}/reactivate`, { method: 'POST' }); toast(`${r.name} is active again`); after(); }
  catch (err) { toast(err.message, 'error'); }
}

async function publish(r, action, after) {
  const pub = action === 'publish';
  const ok = await confirmDialog({
    title: pub ? 'Publish restaurant?' : 'Unpublish restaurant?',
    message: pub ? 'Students will be able to see and order from this restaurant.' : 'The restaurant will be hidden from students until you publish it again.',
    entityHtml: entityBox(r), confirmText: pub ? 'Publish' : 'Unpublish', danger: !pub,
  });
  if (!ok) return;
  try { await api(`/admin/restaurants/${r.id}/${action}`, { method: 'POST' }); toast(pub ? `${r.name} is now live` : `${r.name} is hidden`); after(); }
  catch (err) { toast(err.message, 'error'); }
}

/** Invite Restaurant Owner dialog. */
export function inviteOwner(r, after, { email = '', replace = false } = {}) {
  const hasOwner = r.account_status === 'active' || r.account_status === 'deactivated';
  const m = openModal({
    title: 'Invite restaurant owner',
    body: `${entityBox(r)}
      <form id="invite-form" class="stack" novalidate>
        <div class="field"><label for="inv-email">Owner email <span class="req">*</span></label><input id="inv-email" name="email" type="email" class="input" value="${esc(email)}" required autofocus></div>
        ${hasOwner || replace ? `<label class="row small" style="align-items:flex-start;flex-wrap:nowrap"><input type="checkbox" name="replace_owner" value="true" ${replace ? 'checked' : ''} style="margin-top:3px">
          <span>Replace the current owner${r.owner_email ? ` (${esc(r.owner_email)})` : ''}. When the invitation is accepted, the current owner loses access to this restaurant.</span></label>` : ''}
        <div class="notice notice-info">${icon('key')}<div>We email a unique, single-use link that expires in 72 hours. The owner creates their password and is linked to <strong>${esc(r.name)}</strong> automatically. Sending a new invitation revokes any earlier pending one.</div></div>
      </form>`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="inv-send" data-busy="Sending…">Send invitation</button>',
  });
  const f = m.el.querySelector('#invite-form');
  const send = m.el.querySelector('#inv-send');
  const submit = () => withBusy(send, async () => {
    try {
      await api(`/admin/restaurants/${r.id}/invitations`, { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      m.close(); toast(`Invitation sent to ${f.email.value}`); after && after();
    } catch (err) { showErrors(f, err); }
  });
  send.addEventListener('click', submit);
  f.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

/* =========================================================================
   Detail view
   ========================================================================= */
const INV_BADGE = { pending: 'badge-info', accepted: 'badge-success', revoked: 'badge-neutral', expired: 'badge-warning' };

export async function renderRestaurantDetail(id) {
  try {
    const d = await api(`/admin/restaurants/${id}`);
    const r = d.restaurant;
    setTitle(r.name);
    const reload = () => renderRestaurantDetail(id);
    ctx.main.innerHTML = `
      <div class="row" style="margin-bottom:16px">
        <a href="#restaurants" class="btn btn-ghost btn-sm">${icon('arrowLeft', 'icon-sm')}All restaurants</a><span class="spacer"></span>
        ${r.is_active && r.is_published ? `<a class="btn btn-secondary btn-sm" href="/restaurant.html?id=${r.id}" target="_blank" rel="noopener">${icon('external', 'icon-sm')}Public page</a>` : ''}
        <a class="btn btn-secondary btn-sm" href="#restaurants/${r.id}/edit">${icon('edit', 'icon-sm')}Edit</a>
        <button class="btn btn-secondary btn-sm" data-invite="${r.id}">${icon('mail', 'icon-sm')}Invite Restaurant Owner</button>
        ${r.is_active ? (r.is_published
          ? `<button class="btn btn-secondary btn-sm" data-publish="${r.id}" data-action="unpublish">${icon('eye', 'icon-sm')}Unpublish</button>`
          : `<button class="btn btn-success btn-sm" data-publish="${r.id}" data-action="publish">${icon('eye', 'icon-sm')}Publish</button>`) : ''}
        ${r.is_active ? `<button class="btn btn-danger btn-sm" data-deactivate="${r.id}">${icon('power', 'icon-sm')}Deactivate</button>`
          : `<button class="btn btn-success btn-sm" data-reactivate="${r.id}">${icon('rotate', 'icon-sm')}Reactivate</button>`}
      </div>
      ${r.is_active ? '' : `<div class="notice notice-warning" style="margin-bottom:16px">${icon('power')}<div>Deactivated on ${fmtDateTime(r.deactivated_at)}. Hidden from students and closed to new orders. Historical orders and ratings remain below.${d.stats.open_orders ? ` ${d.stats.open_orders} order(s) placed before deactivation can still be completed by the owner.` : ''}</div></div>`}
      ${r.is_active && !r.is_published ? `<div class="notice notice-info" style="margin-bottom:16px">${icon('info')}<div>This restaurant is a <strong>draft</strong> and is not visible to students yet. Publish it when it is ready.</div></div>` : ''}
      <div class="card" style="overflow:hidden;margin-bottom:16px">
        <div style="height:160px;position:relative">${restaurantImg(r, 'cover')}</div>
        <div class="card-pad row" style="align-items:flex-start">
          <div class="r-logo" style="margin:-56px 0 0;width:88px;height:88px;border-radius:20px">${restaurantImg(r, 'logo')}</div>
          <div style="flex:1;min-width:240px"><div class="row">${restaurantStatusBadge(r)}${accountBadge(r)}${r.is_active && r.is_published ? availabilityBadge(r) : ''}<span class="badge badge-accent plain">${esc(r.category_name)}</span></div>
            <h2 style="margin:8px 0 4px">${esc(r.name)}</h2><p class="muted" style="margin:0">${esc(r.description)}</p></div>
        </div>
        <dl class="detail-grid card-pad" style="padding-top:0">
          <div><dt>Campus location</dt><dd>${esc(r.campus_location)}</dd></div>
          <div><dt>Opening hours</dt><dd>${esc(hoursText(r))}</dd></div>
          <div><dt>Operating days</dt><dd>${esc(r.operating_days.join(', '))}</dd></div>
          <div><dt>Phone</dt><dd>${esc(r.contact_phone)}</dd></div>
          <div><dt>Email</dt><dd>${esc(r.email)}</dd></div>
          <div><dt>Rating</dt><dd>${r.avg_rating ? `${r.avg_rating} / 5 (${r.rating_count})` : 'No ratings yet'}</dd></div>
          <div><dt>Date added</dt><dd>${fmtDate(r.created_at)}${r.created_by_name ? ` by ${esc(r.created_by_name)}` : ''}</dd></div>
          <div><dt>Last updated</dt><dd>${fmtDateTime(r.updated_at)}</dd></div>
        </dl>
      </div>
      <div class="kpi-grid">
        ${kpi('receipt', 'tint-blue', d.stats.total_orders, 'Total orders')}
        ${kpi('check', 'tint-green', d.stats.completed_orders || 0, 'Completed orders')}
        ${kpi('chart', 'tint-amber', money(d.stats.revenue), 'Completed revenue')}
        ${kpi('utensils', 'tint-slate', d.stats.menu_items, 'Menu items')}
      </div>
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h2>Recent orders</h2></div>
          <div class="table-wrap" style="margin-top:8px">${d.recent_orders.length ? `<table class="table"><thead><tr><th>Order</th><th>Student</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>${d.recent_orders.map((o) => `<tr><td class="name-cell">#${o.id}</td><td>${esc(o.student_name)}</td><td>${money(o.total)}</td><td>${orderBadge(o.status)}</td><td class="small">${fmtDateTime(o.created_at)}</td></tr>`).join('')}</tbody></table>`
            : emptyState('receipt', 'No orders yet')}</div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Owner account</h2><a class="small" href="#accounts?restaurant=${r.id}">Manage accounts</a></div>
          <ul class="list-plain" style="margin-top:8px">${d.accounts.length ? d.accounts.map((u) => `
            <li><span class="avatar">${esc(u.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>
              <div style="flex:1;min-width:0"><strong>${esc(u.name)}</strong> <span class="badge badge-neutral plain">${esc(u.assigned_role)}</span><div class="small muted">${esc(u.email)}</div></div>
              ${u.association_status !== 'active' ? '<span class="badge badge-neutral">Former</span>' : u.status === 'active' ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Deactivated</span>'}</li>`).join('')
            : '<li class="small muted"><span>No owner yet. Use <strong>Invite Restaurant Owner</strong> to send an activation link.</span></li>'}</ul>
          <div class="card-head" style="padding-top:8px"><h2>Invitations</h2></div>
          <ul class="list-plain" style="margin-top:8px">${d.invitations.length ? d.invitations.map((i) => `
            <li><div style="flex:1;min-width:0"><strong>${esc(i.email)}</strong><div class="small muted">Sent ${fmtDateTime(i.created_at)}${i.effective_status === 'pending' ? ` · expires ${fmtDateTime(i.expires_at)}` : ''}${i.replace_owner ? ' · replaces owner' : ''}</div></div>
              <span class="badge ${INV_BADGE[i.effective_status]}">${esc(i.effective_status)}</span>
              ${['pending', 'expired', 'revoked'].includes(i.effective_status) ? `<button class="btn btn-ghost btn-sm" data-resend="${i.id}">Resend</button>` : ''}
              ${i.effective_status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-revoke="${i.id}">Revoke</button>` : ''}</li>`).join('')
            : '<li class="small muted"><span>No invitations sent.</span></li>'}</ul>
        </section>
      </div>`;
    bindActions(ctx.main, [r], reload);
    $$('[data-resend]', ctx.main).forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/admin/invitations/${b.dataset.resend}/resend`, { method: 'POST' }); toast('A new invitation link was sent'); reload(); }
      catch (err) { toast(err.message, 'error'); }
    }));
    $$('[data-revoke]', ctx.main).forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Revoke invitation?', message: 'The invitation link will stop working immediately.', confirmText: 'Revoke', danger: true });
      if (!ok) return;
      try { await api(`/admin/invitations/${b.dataset.revoke}/revoke`, { method: 'POST' }); toast('Invitation revoked'); reload(); }
      catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) { mainError(err); }
}
const kpi = (ic, tint, value, label) => `<div class="card kpi"><span class="kpi-icon ${tint}">${icon(ic)}</span><div><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div></div>`;

/* =========================================================================
   Add / edit form
   ========================================================================= */
export async function renderRestaurantForm(id, params) {
  const editing = !!id;
  setTitle(editing ? 'Edit Restaurant' : 'Add Restaurant');
  try {
    const [{ items: cats }, existing, request] = await Promise.all([
      api('/admin/categories'),
      editing ? api(`/admin/restaurants/${id}`).then((d) => d.restaurant) : null,
      !editing && params.get('request') ? api(`/admin/requests/${params.get('request')}`).then((d) => d.request) : null,
    ]);
    const r = existing || {
      name: request?.restaurant_name || '', description: request?.description || '', category_id: request?.category_id || '',
      campus_location: request?.campus_location || '', contact_phone: request?.phone || '', email: request?.email || '',
      opening_time: '08:00', closing_time: '20:00', operating_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], availability_status: 'open',
    };
    const activeCats = cats.filter((c) => c.is_active || c.id === r.category_id);

    ctx.main.innerHTML = `
      <div class="row" style="margin-bottom:16px"><a href="${editing ? `#restaurants/${id}` : request ? '#requests' : '#restaurants'}" class="btn btn-ghost btn-sm">${icon('arrowLeft', 'icon-sm')}Back</a></div>
      ${request ? `<div class="notice notice-info" style="margin-bottom:16px">${icon('inbox')}<div>Approving the application from <strong>${esc(request.contact_name)}</strong> (${esc(request.email)}) by creating a new restaurant. When you submit, the application is marked <strong>Approved</strong> and the applicant receives an owner invitation by email.${request.additional_info ? `<br><span class="small">Additional information: ${esc(request.additional_info)}</span>` : ''}</div></div>` : ''}
      <form class="card" id="r-form" novalidate style="max-width:960px">
        ${request ? `<input type="hidden" name="request_id" value="${request.id}">` : ''}
        <section class="form-section">
          <h2>Basic information</h2><p>How the restaurant appears to students across UniBite.</p>
          <div class="form-grid">
            <div class="field"><label for="name">Restaurant name <span class="req">*</span></label><input id="name" name="name" class="input" maxlength="120" required value="${esc(r.name)}"></div>
            <div class="field"><label for="category_id">Category <span class="req">*</span></label>
              <select id="category_id" name="category_id" class="select" required><option value="">Choose a category</option>
                ${activeCats.map((c) => `<option value="${c.id}" ${c.id === Number(r.category_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
              <span class="hint">Missing one? <a href="#categories">Manage categories</a></span></div>
            <div class="field full"><label for="description">Description <span class="req">*</span></label><textarea id="description" name="description" class="textarea" maxlength="1000" required>${esc(r.description)}</textarea><span class="hint">10–1000 characters.</span></div>
          </div>
        </section>
        <section class="form-section">
          <h2>Images</h2><p>JPG, PNG or WEBP up to 3 MB. A branded placeholder is shown when no image is uploaded.</p>
          <div class="form-grid">
            ${fileField('logo', 'Logo', r.logo, 'Square image works best', '')}
            ${fileField('cover_image', 'Cover image', r.cover_image, 'Wide 16:9 image works best', 'cover')}
          </div>
        </section>
        <section class="form-section">
          <h2>Location &amp; contact</h2><p>Where students pick up, and how UniBite reaches the restaurant.</p>
          <div class="form-grid">
            <div class="field full"><label for="campus_location">Campus location <span class="req">*</span></label><input id="campus_location" name="campus_location" class="input" required placeholder="e.g. Student Union, Ground Floor" value="${esc(r.campus_location)}"></div>
            <div class="field"><label for="contact_phone">Contact phone <span class="req">*</span></label><input id="contact_phone" name="contact_phone" type="tel" class="input" required value="${esc(r.contact_phone)}"></div>
            <div class="field"><label for="email">Email address <span class="req">*</span></label><input id="email" name="email" type="email" class="input" required value="${esc(r.email)}"></div>
          </div>
        </section>
        <section class="form-section">
          <h2>Hours &amp; availability</h2><p>Students can only order during opening hours on operating days, while the status is Open or Busy. Set opening and closing to the same time for 24-hour service.</p>
          <div class="form-grid">
            <div class="field"><label for="opening_time">Opening time <span class="req">*</span></label><input id="opening_time" name="opening_time" type="time" class="input" required value="${esc(r.opening_time)}"></div>
            <div class="field"><label for="closing_time">Closing time <span class="req">*</span></label><input id="closing_time" name="closing_time" type="time" class="input" required value="${esc(r.closing_time)}"></div>
            <fieldset class="field full" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:6px">Operating days <span class="req">*</span></legend>
              <div class="day-picker"><input type="hidden" name="operating_days">${DAYS.map((d) => `<label><input type="checkbox" value="${d}" data-day ${r.operating_days.includes(d) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></fieldset>
            <div class="field"><label for="availability_status">Availability status <span class="req">*</span></label>
              <select id="availability_status" name="availability_status" class="select">${['open', 'busy', 'closed'].map((s) => `<option value="${s}" ${s === r.availability_status ? 'selected' : ''}>${availText[s]}</option>`).join('')}</select></div>
          </div>
        </section>
        ${editing ? '' : `<section class="form-section">
          <h2>Publishing &amp; owner</h2><p>Publish now to make the restaurant visible immediately, or save it as a draft and publish later.</p>
          <div class="form-grid">
            <label class="row full" style="align-items:flex-start;flex-wrap:nowrap"><input type="checkbox" name="publish" value="true" checked style="margin-top:4px"><span><strong>Publish immediately</strong><br><span class="small muted">Visible on the public Restaurants page as soon as it is added.</span></span></label>
            ${request ? `<div class="field full"><span class="label">Owner invitation</span><span class="small muted">An invitation will be sent to the applicant: <strong>${esc(request.email)}</strong></span></div>`
              : `<div class="field full"><label for="invite_email">Invite owner by email <span class="badge badge-neutral plain">Optional</span></label><input id="invite_email" name="invite_email" type="email" class="input" placeholder="owner@example.com"><span class="hint">We email a secure, single-use activation link (valid 72 hours). You can also invite later from the restaurant page.</span></div>`}
          </div>
        </section>`}
        <div class="form-actions">
          <a href="${editing ? `#restaurants/${id}` : '#restaurants'}" class="btn btn-secondary">Cancel</a>
          <button type="submit" class="btn btn-primary btn-lg" data-busy="${editing ? 'Saving…' : 'Adding restaurant…'}">${icon(editing ? 'check' : 'plus')}${editing ? 'Save changes' : request ? 'Approve & Add Restaurant' : 'Add Restaurant'}</button>
        </div>
      </form>`;

    const form = ctx.main.querySelector('#r-form');
    $$('input[type=file]', form).forEach((input) => input.addEventListener('change', () => {
      const f = input.files[0];
      const box = input.closest('.field').querySelector('.preview');
      if (f) box.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="Selected ${input.name.replace('_', ' ')} preview">`;
    }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearErrors(form);
      const days = $$('[data-day]:checked', form).map((x) => x.value);
      form.operating_days.value = days.join(',');
      const fd = new FormData(form);
      for (const k of ['logo', 'cover_image']) if (!form[k].files.length) fd.delete(k);
      if (!editing) fd.set('publish', form.publish.checked ? 'true' : 'false');
      if (!editing && !request && !String(fd.get('invite_email') || '').trim()) fd.delete('invite_email');
      const missing = {};
      for (const k of ['name', 'description', 'category_id', 'campus_location', 'contact_phone', 'email', 'opening_time', 'closing_time']) if (!String(fd.get(k) || '').trim()) missing[k] = 'This field is required';
      if (!days.length) missing.operating_days = 'Select at least one operating day';
      if (Object.keys(missing).length) return showErrors(form, { message: 'Please complete the required fields', fields: missing });

      withBusy(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await api(editing ? `/admin/restaurants/${id}` : '/admin/restaurants', { method: editing ? 'PUT' : 'POST', form: fd });
          if (editing) { toast('Restaurant updated. Changes are live across UniBite.'); location.hash = `restaurants/${id}`; return; }
          refreshCounts();
          created(res);
        } catch (err) { showErrors(form, err); }
      });
    });
  } catch (err) { mainError(err); }
}

function fileField(name, label, current, hint, cls) {
  return `<div class="field"><label for="${name}">${label}</label>
    <div class="file-drop ${cls}"><div class="preview">${current ? `<img src="${esc(current)}" alt="Current ${label.toLowerCase()}">` : icon('image')}</div>
      <div style="flex:1;min-width:0"><input id="${name}" name="${name}" type="file" accept="image/jpeg,image/png,image/webp" class="input" style="min-height:auto;padding:8px">
      <span class="hint">${hint}${current ? ' · Upload a new file to replace the current one' : ''}</span></div></div></div>`;
}

function created({ restaurant: r, invitation, invite_error: inviteError }) {
  const m = openModal({
    title: 'Restaurant added',
    iconHtml: `<div class="modal-icon success">${icon('check')}</div>`,
    body: `<p><strong>${esc(r.name)}</strong> was saved${r.is_published ? ' and is now <strong>live</strong> on the public Restaurants page' : ' as a <strong>draft</strong>. Publish it when it is ready'}.</p>
      ${invitation ? `<div class="notice notice-success">${icon('mail')}<div>Owner invitation sent to <strong>${esc(invitation.email)}</strong>.</div></div>`
        : inviteError ? `<div class="notice notice-danger">${icon('alert')}<div>The restaurant was created, but the invitation could not be sent: ${esc(inviteError)}</div></div>`
        : `<div class="notice notice-info">${icon('info')}<div>No owner invited yet. Use <strong>Invite Restaurant Owner</strong> on the restaurant page.</div></div>`}`,
    footer: `<button class="btn btn-secondary" data-go="new">Add another</button><button class="btn btn-primary" data-go="view">Open restaurant</button>`,
  });
  m.el.querySelector('[data-go=view]').addEventListener('click', () => { m.close(); location.hash = `restaurants/${r.id}`; });
  m.el.querySelector('[data-go=new]').addEventListener('click', () => {
    m.close();
    if (location.hash === '#restaurants/new') renderRestaurantForm(null, new URLSearchParams());
    else location.hash = 'restaurants/new';
  });
}
