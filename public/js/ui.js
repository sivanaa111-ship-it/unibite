import { icon } from './icons.js';
import { getMe, logout } from './api.js';
import { cartCount } from './cart.js';

export const CURRENCY = 'EGP';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => `${CURRENCY} ${Number(n || 0).toFixed(2)}`;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// SQLite stores UTC "YYYY-MM-DD HH:MM:SS"
export const parseDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);
export const fmtDate = (s) => (s ? parseDate(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (s) => (s ? parseDate(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export function timeAgo(s) {
  const d = (Date.now() - parseDate(s).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return fmtDate(s);
}
export const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date(); d.setHours(h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
export const hoursText = (r) => (r.opening_time === r.closing_time ? 'Open 24 hours' : `${fmtTime(r.opening_time)} – ${fmtTime(r.closing_time)}`);
export const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const GRADIENTS = [
  ['#DC2626', '#F97316'], ['#B45309', '#F59E0B'], ['#9F1239', '#F43F5E'],
  ['#C2410C', '#FB923C'], ['#7C2D12', '#EA580C'], ['#BE123C', '#FB7185'],
];
const CAT_ICON = { 'Café': 'coffee', 'Food Truck': 'truck', Bakery: 'cake', Healthy: 'salad', Restaurant: 'utensils' };

/** Branded artwork used when a restaurant has no uploaded image. */
export function placeholderArt(name, seed = 0, iconName, mode = 'icon') {
  const [a, b] = GRADIENTS[Math.abs(Number(seed) || 0) % GRADIENTS.length];
  const inner = mode === 'initials' ? esc(initials(name)) : icon(iconName || 'utensils');
  return `<div class="placeholder-art" style="background:linear-gradient(135deg,${a},${b})" role="img" aria-label="${esc(name)}">${inner}</div>`;
}
export function restaurantImg(r, kind = 'cover') {
  const src = kind === 'logo' ? r.logo : r.cover_image;
  if (src) return `<img src="${esc(src)}" alt="${esc(r.name)} ${kind}" loading="lazy">`;
  return placeholderArt(r.name, r.id, r.category_icon || CAT_ICON[r.category_name], kind === 'logo' ? 'initials' : 'icon');
}

export function availabilityBadge(r) {
  if (r.is_active === false) return '<span class="badge badge-neutral">Deactivated</span>';
  if (r.availability_status === 'closed' || !r.open_now) return '<span class="badge badge-neutral">Closed</span>';
  if (r.availability_status === 'busy') return '<span class="badge badge-warning">Busy</span>';
  return '<span class="badge badge-success">Open now</span>';
}

export const ORDER_STATUS = {
  pending: ['Awaiting confirmation', 'badge-warning'],
  accepted: ['Accepted', 'badge-info'],
  preparing: ['Preparing', 'badge-info'],
  ready: ['Ready for pickup', 'badge-success'],
  completed: ['Completed', 'badge-neutral'],
  cancelled: ['Cancelled', 'badge-danger'],
  rejected: ['Rejected', 'badge-danger'],
};
export const orderBadge = (s) => `<span class="badge ${ORDER_STATUS[s]?.[1] || 'badge-neutral'}">${esc(ORDER_STATUS[s]?.[0] || s)}</span>`;

/* ---------------- Toasts ---------------- */
export function toast(message, type = 'success') {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* ---------------- Modals ---------------- */
export function openModal({ title, body, footer = '', size = '', iconHtml = '' }) {
  const prevFocus = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">${iconHtml}<h2 id="modal-title">${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Close dialog">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  const close = () => {
    back.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // focus trap
      const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', back).filter((x) => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close); // navigating away closes the dialog
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  setTimeout(() => (back.querySelector('[autofocus]') || back.querySelector('.modal-body input, .modal-body textarea, .modal-foot .btn'))?.focus(), 30);
  return { el: back, close };
}

/** Confirmation dialog. Resolves true/false (or the textarea value when withReason). */
export function confirmDialog({ title, message, entityHtml = '', confirmText = 'Confirm', danger = false, withReason = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      iconHtml: `<div class="modal-icon ${danger ? 'danger' : 'success'}">${icon(danger ? 'alert' : 'check')}</div>`,
      body: `<p>${message}</p>${entityHtml}${withReason ? `<div class="field"><label for="confirm-reason">Reason (optional)</label><textarea id="confirm-reason" class="textarea" maxlength="300"></textarea></div>` : ''}`,
      footer: `<button class="btn btn-secondary" data-close>Cancel</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      done = true;
      const reason = withReason ? m.el.querySelector('#confirm-reason').value.trim() : true;
      m.close();
      resolve(withReason ? { reason } : true);
    });
    new MutationObserver((_, obs) => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } })
      .observe(document.body, { childList: true });
  });
}

/* ---------------- Forms ---------------- */
export function clearErrors(form) {
  $$('.field-error', form).forEach((e) => e.remove());
  $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
  const alert = $('.form-alert', form); if (alert) alert.remove();
}
export function showErrors(form, err) {
  clearErrors(form);
  const fields = err.fields || {};
  let first = null;
  for (const [name, msg] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) continue;
    const field = input.closest('.field') || input.parentElement;
    input.setAttribute('aria-invalid', 'true');
    const id = `err-${name}`;
    input.setAttribute('aria-describedby', id);
    field.insertAdjacentHTML('beforeend', `<div class="field-error" id="${id}">${icon('alert', 'icon-sm')}${esc(msg)}</div>`);
    first = first || input;
  }
  form.insertAdjacentHTML('afterbegin', `<div class="form-alert" role="alert">${esc(err.message)}</div>`);
  (first || form).focus?.();
}
export async function withBusy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(btn.dataset.busy || 'Please wait…')}</span>`;
  try { return await fn(); }
  finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = html; }
}

export function emptyState(iconName, title, text = '', action = '') {
  return `<div class="empty"><div class="empty-icon">${icon(iconName, 'icon-lg')}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}

/* ---------------- Site chrome (public pages) ---------------- */
export function brandHtml(href = '/') {
  return `<a href="${href}" class="brand" aria-label="UniBite home"><span class="brand-mark">${icon('utensils')}</span><span>Uni<b>Bite</b></span></a>`;
}

function dashLink(u) {
  if (u.role === 'admin') return ['/admin/', 'Admin dashboard', 'shield'];
  if (u.role === 'restaurant') return ['/restaurant-dashboard.html', 'Manage my restaurant', 'store'];
  return ['/orders.html', 'My orders', 'receipt'];
}

export async function mountChrome(active = '') {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a href="#main" class="skip-link">Skip to content</a>
    <div class="container">
      ${brandHtml()}
      <nav class="nav-links" id="nav-links" aria-label="Main">
        <a href="/" ${active === 'home' ? 'aria-current="page"' : ''}>Home</a>
        <a href="/restaurants.html" ${active === 'restaurants' ? 'aria-current="page"' : ''}>Restaurants</a>
        <a href="/partner.html" ${active === 'partner' ? 'aria-current="page"' : ''}>Register your restaurant</a>
        <a href="/student/login" class="show-mobile">Student login</a>
        <a href="/restaurant/login" class="show-mobile">Restaurant login</a>
      </nav>
      <div class="nav-actions" id="nav-actions"></div>
      <button class="icon-btn mobile-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav-links">${icon('menu')}</button>
    </div>`;
  document.body.prepend(header);
  const toggle = header.querySelector('.mobile-toggle');
  toggle.addEventListener('click', () => {
    const nav = header.querySelector('#nav-links');
    const open = nav.dataset.open !== 'true';
    nav.dataset.open = open; toggle.setAttribute('aria-expanded', open);
  });

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div>${brandHtml()}<p class="small" style="margin-top:12px;max-width:340px"><strong style="color:#fff">Your Campus. Your Cravings. One Click.</strong><br>Order from every restaurant, café and food truck on campus. Skip the queue, pick up when it's ready.</p></div>
        <div><h4>Explore</h4><ul><li><a href="/restaurants.html">All restaurants</a></li><li><a href="/restaurants.html?availability=open">Open now</a></li><li><a href="/orders.html">My orders</a></li><li><a href="/student/login">Student login</a></li></ul></div>
        <div><h4>For restaurants</h4><ul><li><a href="/partner.html">Register your restaurant</a></li><li><a href="/restaurant/login">Restaurant login</a></li></ul></div>
      </div>
      <div class="footer-bottom">© ${new Date().getFullYear()} UniBite · Campus food, made simple.</div>
    </div>`;
  document.body.appendChild(footer);

  const user = await getMe();
  renderNavActions(user);
  return user;
}

export function renderNavActions(user) {
  const box = $('#nav-actions');
  if (!box) return;
  const showCart = !user || user.role === 'student';
  const cart = showCart ? `<a href="/restaurants.html" class="icon-btn cart-btn" id="cart-link" aria-label="Cart">${icon('bag')}<span class="cart-count ${cartCount() ? '' : 'hidden'}" id="cart-count">${cartCount()}</span></a>` : '';
  if (!user) {
    box.innerHTML = `${cart}<a href="/student/login" class="btn btn-ghost btn-sm">Log in</a><a href="/register.html" class="btn btn-primary btn-sm"><span class="hide-mobile">Student&nbsp;</span>Sign up</a>`;
  } else {
    const [href, label, ic] = dashLink(user);
    box.innerHTML = `${cart}
      <div class="user-menu">
        <button class="btn btn-ghost btn-sm" aria-haspopup="true" aria-expanded="false" id="user-menu-btn">
          <span class="avatar">${esc(initials(user.name))}</span><span class="hide-mobile">${esc(user.name.split(' ')[0])}</span>${icon('chevronDown', 'icon-sm')}
        </button>
        <div class="user-menu-panel" role="menu">
          <a href="${href}" role="menuitem">${icon(ic)}${label}</a>
          <button role="menuitem" id="logout-btn">${icon('logout')}Log out</button>
        </div>
      </div>`;
    const menu = box.querySelector('.user-menu');
    const btn = box.querySelector('#user-menu-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.dataset.open !== 'true';
      menu.dataset.open = open; btn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', () => { menu.dataset.open = 'false'; btn.setAttribute('aria-expanded', 'false'); });
    box.querySelector('#logout-btn').addEventListener('click', logout);
  }
  const cl = $('#cart-link');
  if (cl) {
    const c = JSON.parse(localStorage.getItem('unibite_cart') || 'null');
    if (c && c.restaurantId) cl.href = `/restaurant.html?id=${c.restaurantId}`;
  }
}

export function updateCartBadge() {
  const el = $('#cart-count');
  if (!el) return;
  const n = cartCount();
  el.textContent = n; el.classList.toggle('hidden', !n);
}
