// Restaurant Management Interface (restaurant owners). All data is scoped server-side.
import { api, getMe, logout } from '../api.js';
import { icon } from '../icons.js';
import {
  esc, money, orderBadge, fmtDate, fmtDateTime, timeAgo, emptyState, toast, confirmDialog, openModal,
  showErrors, withBusy, initials, availabilityBadge, hoursText, restaurantImg, $, $$,
} from '../ui.js';
import { hydrateIcons } from '../components.js';

hydrateIcons();
const main = $('#main');
let me;
let info;
let poll;
const isOwner = () => info.staff_role === 'owner';
const active = () => info.restaurant.is_active;

$('#logout').addEventListener('click', () => logout('/login.html?as=restaurant'));
$('#menu-toggle').addEventListener('click', () => { $('#dash').dataset.navOpen = $('#dash').dataset.navOpen !== 'true'; });
window.addEventListener('hashchange', route);

/** Redirect to login when the session ends (e.g. account deactivated by an admin). */
async function call(path, opts) {
  try { return await api(path, opts); }
  catch (err) {
    if (err.status === 401) location.href = '/login.html?as=restaurant&msg=Your%20session%20ended.%20Please%20log%20in%20again.';
    throw err;
  }
}

(async () => {
  me = await getMe();
  if (!me || me.role !== 'restaurant') return location.replace('/login.html?as=restaurant');
  $('#top-right').innerHTML = `<span class="small muted hide-mobile">${esc(me.name)}</span><span class="avatar" aria-hidden="true">${esc(initials(me.name))}</span>`;
  try {
    info = await call('/restaurant/overview');
  } catch (err) {
    main.innerHTML = `<div class="card card-pad">${emptyState('power', 'Restaurant unavailable', err.message)}</div>`;
    $('#side-nav').classList.add('hidden');
    return;
  }
  $('#view-public').href = `/restaurant.html?id=${info.restaurant.id}`;
  renderBanner();
  route();
})();

function renderBanner() {
  $('#banner').innerHTML = active() ? '' : `<div class="notice notice-warning" style="border-radius:0;padding:14px 24px">${icon('power')}<div>
    <strong>${esc(info.restaurant.name)} has been deactivated by UniBite.</strong> It is hidden from students and cannot receive new orders.
    You can still view your data and complete orders that were already placed. Menu and restaurant details are read-only.</div></div>`;
  $('#view-public').classList.toggle('hidden', !active() || !info.restaurant.is_published);
}

function route() {
  const view = (location.hash || '#overview').slice(1);
  $$('#side-nav a').forEach((a) => { if (a.dataset.view !== view) a.removeAttribute('aria-current'); else a.setAttribute('aria-current', 'page'); });
  $('#dash').dataset.navOpen = 'false';
  clearInterval(poll);
  const views = { overview, orders, history: previous, menu, info: restaurantInfo, performance, account };
  (views[view] || overview)();
  main.focus({ preventScroll: true });
}
const title = (t) => { $('#page-title').textContent = t; document.title = `${t} · ${info.restaurant.name} · UniBite`; };
const kpi = (ic, tint, value, label) => `<div class="card kpi"><span class="kpi-icon ${tint}">${icon(ic)}</span><div><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div></div>`;
function setPending(n) { const c = $('#pending-count'); c.textContent = n; c.classList.toggle('hidden', !n); }

/* ---------- Overview ---------- */
async function overview() {
  title('Overview');
  info = await call('/restaurant/overview');
  renderBanner();
  const r = info.restaurant;
  const s = info.stats;
  setPending(s.pending_orders);
  main.innerHTML = `
    <div class="card card-pad row" style="margin-bottom:20px">
      <div class="thumb" style="width:56px;height:56px;border-radius:14px;overflow:hidden;flex:none">${restaurantImg(r, 'logo')}</div>
      <div><h2 style="font-size:1.25rem;margin:0">${esc(r.name)}</h2><span class="muted small">${esc(r.category_name)} · ${esc(r.campus_location)} · ${esc(hoursText(r))}</span></div>
      <span class="spacer"></span>${active() ? availabilityBadge(r) : '<span class="badge badge-neutral">Deactivated</span>'}
      ${active() ? availabilityControl(r.availability_status) : ''}
    </div>
    ${active() && !r.is_published ? `<div class="notice notice-info" style="margin-bottom:16px">${icon('info')}<div>Your restaurant is not published yet, so students cannot see it. The UniBite team will publish it when it is ready.</div></div>` : ''}
    <div class="kpi-grid">
      ${kpi('bell', 'tint-amber', s.pending_orders, 'New orders awaiting you')}
      ${kpi('chef', 'tint-blue', s.active_orders, 'Orders in progress')}
      ${kpi('receipt', 'tint-red', s.today_orders, 'Orders today')}
      ${kpi('chart', 'tint-green', money(s.today_revenue), 'Completed revenue today')}
      ${kpi('star', 'tint-amber', s.avg_rating ? `${s.avg_rating} / 5` : '—', `Rating (${s.rating_count} reviews)`)}
      ${kpi('utensils', 'tint-slate', s.menu_items, 'Menu items')}
    </div>
    <div class="card card-pad"><h2 style="font-size:1rem;margin:0 0 8px">Quick actions</h2>
      <div class="row">
        <a class="btn btn-primary btn-sm" href="#orders">${icon('receipt', 'icon-sm')}Handle incoming orders</a>
        ${active() ? `<a class="btn btn-secondary btn-sm" href="#menu">${icon('plus', 'icon-sm')}Add menu item</a><a class="btn btn-secondary btn-sm" href="#info">${icon('edit', 'icon-sm')}Edit restaurant info</a>` : ''}
        <a class="btn btn-secondary btn-sm" href="#performance">${icon('star', 'icon-sm')}See reviews</a>
      </div></div>`;
  bindAvailability();
}

function availabilityControl(current) {
  return `<div class="segmented" role="group" aria-label="Availability status">
    ${['open', 'busy', 'closed'].map((s) => `<button type="button" data-avail="${s}" aria-pressed="${s === current}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>`;
}
function bindAvailability() {
  $$('[data-avail]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await call('/restaurant/availability', { method: 'PATCH', body: { availability_status: b.dataset.avail } });
      toast(`Status set to ${b.dataset.avail}`);
      overview();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

/* ---------- Incoming orders (kanban) ---------- */
const NEXT = {
  pending: [['accepted', 'Accept', 'btn-success'], ['rejected', 'Reject', 'btn-secondary']],
  accepted: [['preparing', 'Start preparing', 'btn-primary'], ['cancelled', 'Cancel', 'btn-secondary']],
  preparing: [['ready', 'Mark ready', 'btn-success']],
  ready: [['completed', 'Picked up', 'btn-primary']],
};
let activeOrders = [];
async function orders(silent = false) {
  title('Incoming orders');
  if (!silent) main.innerHTML = '<div class="skeleton" style="height:240px"></div>';
  try {
    const { items } = await call('/restaurant/orders?scope=active');
    activeOrders = items;
    setPending(items.filter((o) => o.status === 'pending').length);
    const cols = [['pending', 'New', 'bell'], ['accepted', 'Accepted', 'check'], ['preparing', 'Preparing', 'chef'], ['ready', 'Ready for pickup', 'bag']];
    main.innerHTML = `<p class="muted small" style="margin-top:0">Updates automatically every 10 seconds. Select an order number to see full details.</p>
      <div class="kanban">${cols.map(([s, label, ic]) => {
        const list = items.filter((o) => o.status === s);
        return `<section class="kanban-col" aria-label="${label}"><h3>${icon(ic, 'icon-sm')}${label} <span class="badge badge-neutral plain">${list.length}</span></h3>
          ${list.length ? list.map(ticket).join('') : '<p class="muted small">No orders</p>'}</section>`;
      }).join('')}</div>`;
  } catch (err) { if (!silent) main.innerHTML = emptyState('alert', 'Could not load orders', err.message); }
  if (!silent) poll = setInterval(() => { if ((location.hash || '#overview') === '#orders') orders(true); }, 10000);
}
function ticket(o) {
  const actions = (NEXT[o.status] || []).filter(([s]) => active() || s !== 'accepted');
  return `<article class="ticket">
    <div class="row"><button class="btn btn-ghost btn-sm" style="padding:0 6px;min-height:28px" data-detail="${o.id}">#${o.id}</button><span class="muted small">${timeAgo(o.created_at)}</span><span class="spacer"></span><span class="pickup-code" style="font-size:.9rem;padding:2px 8px">${esc(o.pickup_code)}</span></div>
    <div class="small">${esc(o.student_name)}</div>
    <ul>${o.items.map((i) => `<li>${i.quantity} × ${esc(i.product_name)}</li>`).join('')}</ul>
    ${o.notes ? `<div class="notice notice-warning small" style="padding:6px 10px">${icon('info', 'icon-sm')}${esc(o.notes)}</div>` : ''}
    <div class="row" style="margin-top:8px"><strong class="small">${money(o.total)}</strong><span class="spacer"></span>
      ${actions.map(([s, l, cls]) => `<button class="btn ${cls} btn-sm" data-order="${o.id}" data-status="${s}">${l}</button>`).join('')}</div>
  </article>`;
}
main.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-detail]');
  if (d) return orderDetails(Number(d.dataset.detail));
  const b = e.target.closest('[data-order]');
  if (!b) return;
  const { order, status } = b.dataset;
  if (['rejected', 'cancelled'].includes(status)) {
    const ok = await confirmDialog({ title: `${status === 'rejected' ? 'Reject' : 'Cancel'} order #${order}?`, message: 'The student will see this on their order page.', confirmText: status === 'rejected' ? 'Reject order' : 'Cancel order', danger: true, withReason: true });
    if (!ok) return;
    return updateStatus(order, status, ok.reason);
  }
  updateStatus(order, status);
});
async function updateStatus(id, status, note) {
  try { await call(`/restaurant/orders/${id}/status`, { method: 'PATCH', body: { status, note } }); toast(`Order #${id} updated`); orders(true); }
  catch (err) { toast(err.message, 'error'); }
}

async function orderDetails(id) {
  try {
    const { order: o } = await call(`/restaurant/orders/${id}`);
    openModal({
      title: `Order #${o.id}`, size: 'modal-lg',
      body: `<div class="row" style="margin-bottom:12px">${orderBadge(o.status)}<span class="muted small">Placed ${fmtDateTime(o.created_at)} by ${esc(o.student_name)}</span><span class="spacer"></span><span class="pickup-code">${esc(o.pickup_code)}</span></div>
        <table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th style="text-align:right">Subtotal</th></tr></thead>
          <tbody>${o.items.map((i) => `<tr><td>${esc(i.product_name)}</td><td>${i.quantity}</td><td>${money(i.unit_price)}</td><td style="text-align:right">${money(i.unit_price * i.quantity)}</td></tr>`).join('')}
          <tr><td colspan="3"><strong>Total</strong></td><td style="text-align:right"><strong>${money(o.total)}</strong></td></tr></tbody></table>
        ${o.notes ? `<div class="notice notice-warning" style="margin-top:12px">${icon('info')}<div>Student note: ${esc(o.notes)}</div></div>` : ''}
        ${o.rating ? `<p style="margin-top:12px"><span class="stars">${icon('star', 'icon-sm')}${o.rating.score}/5</span> ${esc(o.rating.comment || '')}</p>` : ''}
        <h3 style="margin-top:16px">Status history</h3>
        <ul class="list-plain">${o.history.map((h) => `<li style="padding:8px 0">${orderBadge(h.status)}<span class="small muted">${fmtDateTime(h.created_at)}${h.changed_by_name ? ` · ${esc(h.changed_by_name)}` : ''}</span>${h.note ? `<span class="small">“${esc(h.note)}”</span>` : ''}</li>`).join('')}</ul>`,
      footer: '<button class="btn btn-primary" data-close>Close</button>',
    });
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- Previous orders ---------- */
async function previous() {
  title('Previous orders');
  main.innerHTML = '<div class="skeleton" style="height:240px"></div>';
  const { items } = await call('/restaurant/orders?scope=history');
  main.innerHTML = `<div class="card"><div class="table-wrap">${items.length ? `<table class="table">
    <thead><tr><th>Order</th><th>Student</th><th>Items</th><th>Total</th><th>Status</th><th>Rating</th><th>Date</th></tr></thead>
    <tbody>${items.map((o) => `<tr><td><button class="btn btn-ghost btn-sm" data-detail="${o.id}">#${o.id}</button></td><td>${esc(o.student_name)}</td>
      <td class="small">${o.items.map((i) => `${i.quantity}× ${esc(i.product_name)}`).join(', ')}</td><td>${money(o.total)}</td>
      <td>${orderBadge(o.status)}</td><td>${o.rating ? `<span class="stars small">${icon('star', 'icon-sm')}${o.rating.score}</span>` : '<span class="muted">—</span>'}</td>
      <td class="small">${fmtDateTime(o.created_at)}</td></tr>`).join('')}</tbody></table>` : emptyState('history', 'No previous orders yet')}</div></div>`;
}

/* ---------- Menu management ---------- */
async function menu() {
  title('Menu management');
  const canEdit = isOwner() && active();
  const { items, sections } = await call('/restaurant/products');
  const grouped = {};
  for (const p of items) (grouped[p.menu_section || 'Uncategorized'] ||= []).push(p);
  main.innerHTML = `
    <div class="row" style="margin-bottom:16px"><p class="muted small" style="margin:0">${canEdit ? 'Add, edit and remove items. Changes appear on your public menu immediately.' : active() ? 'Only the owner can edit the menu.' : 'Your restaurant is deactivated. The menu is read-only.'}</p>
      <span class="spacer"></span>${canEdit ? `<button class="btn btn-primary" id="add-product">${icon('plus')}Add menu item</button>` : ''}</div>
    ${items.length ? Object.entries(grouped).map(([sec, list]) => `
      <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${esc(sec)} <span class="badge badge-neutral plain">${list.length}</span></h2></div>
      <div class="table-wrap" style="margin-top:8px"><table class="table">
      <thead><tr><th><span class="sr-only">Photo</span></th><th>Item</th><th>Price</th><th>Availability</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>${list.map((p) => `<tr>
        <td><div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div class="placeholder-art" style="background:var(--color-muted);color:var(--color-primary)">${icon('utensils', 'icon-sm')}</div>`}</div></td>
        <td><div class="name-cell">${esc(p.name)}</div><div class="muted small">${esc(p.description || '')}</div></td>
        <td>${money(p.price)}</td>
        <td>${active()
          ? `<button class="btn btn-sm ${p.is_available ? 'btn-secondary' : 'btn-ghost'}" data-toggle="${p.id}" data-on="${p.is_available}" aria-label="${p.is_available ? 'Mark sold out' : 'Mark available'}: ${esc(p.name)}">${p.is_available ? '<span class="badge badge-success">Available</span>' : '<span class="badge badge-neutral">Sold out</span>'}</button>`
          : (p.is_available ? '<span class="badge badge-success">Available</span>' : '<span class="badge badge-neutral">Sold out</span>')}</td>
        <td><div class="actions">${canEdit ? `<button class="icon-btn" data-edit="${p.id}" aria-label="Edit ${esc(p.name)}">${icon('edit')}</button><button class="icon-btn" style="color:var(--color-danger)" data-del="${p.id}" aria-label="Remove ${esc(p.name)}">${icon('trash')}</button>` : ''}</div></td>
      </tr>`).join('')}</tbody></table></div></div>`).join('')
    : `<div class="card">${emptyState('utensils', 'Your menu is empty', canEdit ? 'Add your first item so students can start ordering.' : '')}</div>`}`;

  $('#add-product')?.addEventListener('click', () => productForm(null, sections));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => productForm(items.find((p) => p.id === Number(b.dataset.edit)), sections)));
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    try { await call(`/restaurant/products/${b.dataset.toggle}/availability`, { method: 'PATCH', body: { is_available: b.dataset.on !== 'true' } }); menu(); }
    catch (err) { toast(err.message, 'error'); }
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const p = items.find((x) => x.id === Number(b.dataset.del));
    const ok = await confirmDialog({ title: 'Remove menu item?', message: `<strong>${esc(p.name)}</strong> will be removed from your menu. Past orders keep their record.`, confirmText: 'Remove item', danger: true });
    if (!ok) return;
    try { await call(`/restaurant/products/${p.id}`, { method: 'DELETE' }); toast('Item removed'); menu(); }
    catch (err) { toast(err.message, 'error'); }
  }));
}

function productForm(p, sections) {
  const m = openModal({
    title: p ? 'Edit menu item' : 'Add menu item',
    body: `<form id="product-form" class="form-grid" novalidate>
      <div class="field full"><label for="pf-name">Name <span class="req">*</span></label><input id="pf-name" name="name" class="input" maxlength="100" value="${esc(p?.name || '')}" required></div>
      <div class="field"><label for="pf-price">Price (EGP) <span class="req">*</span></label><input id="pf-price" name="price" type="number" min="0" step="0.5" class="input" value="${p?.price ?? ''}" required></div>
      <div class="field"><label for="pf-section">Menu category</label><input id="pf-section" name="menu_section" class="input" list="pf-sections" value="${esc(p?.menu_section || '')}" placeholder="e.g. Burgers, Drinks"><datalist id="pf-sections">${sections.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field full"><label for="pf-desc">Description</label><textarea id="pf-desc" name="description" class="textarea" maxlength="500">${esc(p?.description || '')}</textarea></div>
      <div class="field full"><label for="pf-image">Photo</label>
        <div class="file-drop"><div class="preview">${p?.image ? `<img src="${esc(p.image)}" alt="">` : icon('image')}</div>
        <div style="flex:1"><input id="pf-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" class="input" style="min-height:auto;padding:8px"><span class="hint">JPG, PNG or WEBP, up to 3 MB.</span></div></div></div>
      <label class="row full small"><input type="checkbox" name="is_available" value="true" ${!p || p.is_available ? 'checked' : ''}> Available to order</label>
    </form>`,
    footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="pf-save" data-busy="Saving…">${p ? 'Save changes' : 'Add item'}</button>`,
  });
  const form = m.el.querySelector('#product-form');
  form.image.addEventListener('change', () => { const f = form.image.files[0]; if (f) form.querySelector('.preview').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; });
  const save = m.el.querySelector('#pf-save');
  save.addEventListener('click', () => withBusy(save, async () => {
    const fd = new FormData(form);
    if (!form.is_available.checked) fd.set('is_available', 'false');
    if (!form.image.files.length) fd.delete('image');
    try {
      await call(p ? `/restaurant/products/${p.id}` : '/restaurant/products', { method: p ? 'PUT' : 'POST', form: fd });
      m.close(); toast(p ? 'Item updated' : 'Item added'); menu();
    } catch (err) { showErrors(form, err); }
  }));
}

/* ---------- Restaurant information ---------- */
async function restaurantInfo() {
  title('Restaurant information');
  const { restaurant: r } = await call('/restaurant/profile');
  const canEdit = isOwner() && active();
  main.innerHTML = `
    <div class="grid-2" style="align-items:start">
      <form class="card" id="info-form" novalidate>
        <section class="form-section"><h2>Public profile</h2><p>${canEdit ? 'These details appear on your public restaurant page.' : 'Read-only.'}</p>
          <div class="form-grid">
            <div class="field full"><label for="ri-desc">Description</label><textarea id="ri-desc" name="description" class="textarea" maxlength="1000" ${canEdit ? '' : 'disabled'}>${esc(r.description)}</textarea></div>
            <div class="field"><label for="ri-phone">Contact phone</label><input id="ri-phone" name="contact_phone" type="tel" class="input" value="${esc(r.contact_phone)}" ${canEdit ? '' : 'disabled'}></div>
            <div class="field"><label for="ri-email">Contact email</label><input id="ri-email" name="email" type="email" class="input" value="${esc(r.email)}" ${canEdit ? '' : 'disabled'}></div>
            ${imageField('logo', 'Logo', r)}${imageField('cover_image', 'Cover image', r)}
          </div></section>
        ${canEdit ? '<div class="form-actions"><button class="btn btn-primary" type="submit" data-busy="Saving…">Save changes</button></div>' : ''}
      </form>
      <div class="card card-pad">
        <h2 style="font-size:1rem">Managed by UniBite</h2>
        <p class="muted small">Contact the UniBite administrator to change these.</p>
        <dl class="detail-grid">
          <div><dt>Name</dt><dd>${esc(r.name)}</dd></div>
          <div><dt>Category</dt><dd>${esc(r.category_name)}</dd></div>
          <div><dt>Campus location</dt><dd>${esc(r.campus_location)}</dd></div>
          <div><dt>Opening hours</dt><dd>${esc(hoursText(r))}</dd></div>
          <div><dt>Operating days</dt><dd>${esc(r.operating_days.join(', '))}</dd></div>
          <div><dt>Listed since</dt><dd>${fmtDate(r.created_at)}</dd></div>
        </dl>
      </div>
    </div>`;
  if (!canEdit) return;
  const form = $('#info-form');
  $$('input[type=file]', form).forEach((input) => input.addEventListener('change', () => {
    const f = input.files[0];
    if (f) input.closest('.field').querySelector('.preview').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
  }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    for (const k of ['logo', 'cover_image']) if (!form[k].files.length) fd.delete(k);
    withBusy(form.querySelector('[type=submit]'), async () => {
      try { await call('/restaurant/profile', { method: 'PUT', form: fd }); toast('Restaurant information updated'); restaurantInfo(); }
      catch (err) { showErrors(form, err); }
    });
  });
}
function imageField(name, label, r) {
  const canEdit = isOwner() && active();
  return `<div class="field"><label for="ri-${name}">${label}</label>
    <div class="file-drop ${name === 'cover_image' ? 'cover' : ''}"><div class="preview">${restaurantImg(r, name === 'logo' ? 'logo' : 'cover')}</div>
    ${canEdit ? `<div style="flex:1;min-width:0"><input id="ri-${name}" name="${name}" type="file" accept="image/jpeg,image/png,image/webp" class="input" style="min-height:auto;padding:8px"><span class="hint">Up to 3 MB</span></div>` : ''}</div></div>`;
}

/* ---------- Ratings & performance ---------- */
async function performance() {
  title('Ratings & performance');
  const d = await call('/restaurant/performance');
  const t = d.totals;
  const maxDist = Math.max(...d.rating.distribution.map((x) => x.count), 1);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 864e5); const key = dt.toISOString().slice(0, 10);
    days.push({ label: dt.toLocaleDateString(undefined, { weekday: 'short' }), value: d.by_day.find((x) => x.day === key)?.orders || 0 });
  }
  const maxDay = Math.max(...days.map((x) => x.value), 1);
  main.innerHTML = `
    <div class="kpi-grid">
      ${kpi('star', 'tint-amber', d.rating.average ? `${d.rating.average} / 5` : '—', `Average rating · ${d.rating.count} reviews`)}
      ${kpi('receipt', 'tint-blue', t.total || 0, 'Total orders')}
      ${kpi('check', 'tint-green', t.completed || 0, 'Completed')}
      ${kpi('x', 'tint-red', t.cancelled || 0, 'Cancelled / rejected')}
      ${kpi('chart', 'tint-green', money(t.revenue), 'Completed revenue')}
      ${kpi('bag', 'tint-slate', money(t.avg_order), 'Average order')}
    </div>
    <div class="grid-2">
      <section class="card"><div class="card-head"><h2>Orders · last 7 days</h2></div>
        <div class="bar-chart" role="img" aria-label="Orders per day: ${days.map((x) => `${x.label} ${x.value}`).join(', ')}">
          ${days.map((x) => `<div class="bar-col"><span class="bar-val">${x.value}</span><div class="bar" style="height:${(x.value / maxDay) * 100}%"></div><span class="bar-lbl">${x.label}</span></div>`).join('')}</div></section>
      <section class="card card-pad"><h2 style="font-size:1rem">Rating breakdown</h2>
        ${d.rating.distribution.map((x) => `<div class="row" style="gap:8px;margin:6px 0;flex-wrap:nowrap"><span class="small" style="width:44px">${x.score} ${icon('star', 'icon-sm')}</span>
          <div style="flex:1;height:10px;background:var(--color-muted);border-radius:5px;overflow:hidden"><div style="height:100%;width:${(x.count / maxDist) * 100}%;background:#F59E0B"></div></div><span class="small muted" style="width:28px;text-align:right">${x.count}</span></div>`).join('')}
        <h2 style="font-size:1rem;margin-top:16px">Best sellers</h2>
        ${d.top_items.length ? `<ol class="small" style="padding-left:18px;margin:0">${d.top_items.map((i) => `<li>${esc(i.name)} <span class="muted">· ${i.qty} sold</span></li>`).join('')}</ol>` : '<p class="muted small">No completed orders yet.</p>'}
      </section>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Customer reviews</h2></div>
      <ul class="list-plain" style="margin-top:8px">${d.reviews.length ? d.reviews.map((r) => `<li style="align-items:flex-start">
        <span class="stars small">${icon('star', 'icon-sm')}${r.score}</span>
        <div style="flex:1"><strong>${esc(r.student_name)}</strong> <span class="muted small">· order #${r.order_id} · ${fmtDate(r.created_at)}</span>${r.comment ? `<div>${esc(r.comment)}</div>` : '<div class="muted small">No comment</div>'}</div></li>`).join('')
        : `<li>${emptyState('star', 'No reviews yet', 'Students can rate their order after picking it up.')}</li>`}</ul></section>`;
}

/* ---------- Account ---------- */
function account() {
  title('Account');
  main.innerHTML = `<div class="grid-2">
    <div class="card card-pad">
      <h2 style="font-size:1rem">Your account</h2>
      <dl class="detail-grid"><div><dt>Name</dt><dd>${esc(me.name)}</dd></div><div><dt>Email</dt><dd>${esc(me.email)}</dd></div>
        <div><dt>Role</dt><dd>Restaurant owner</dd></div><div><dt>Restaurant</dt><dd>${esc(info.restaurant.name)}</dd></div></dl>
      <p class="muted small" style="margin-top:12px">Your role and restaurant assignment are managed by UniBite and cannot be changed here.</p>
    </div>
    <form class="card card-pad stack" id="pw-form" novalidate>
      <h2 style="font-size:1rem">Change password</h2>
      <div class="field"><label for="cur">Current password</label><input id="cur" name="current_password" type="password" class="input" autocomplete="current-password"></div>
      <div class="field"><label for="np">New password</label><input id="np" name="new_password" type="password" class="input" autocomplete="new-password"><span class="hint">8+ characters with a letter and a number. Other devices will be signed out.</span></div>
      <div><button class="btn btn-primary" type="submit" data-busy="Updating…">Update password</button></div>
    </form></div>`;
  const f = $('#pw-form');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(f.querySelector('[type=submit]'), async () => {
      try { await call('/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); toast('Password updated'); f.reset(); }
      catch (err) { showErrors(f, err); }
    });
  });
}
