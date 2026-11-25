import { api } from '../api.js';
import { icon } from '../icons.js';
import {
  mountChrome, esc, money, restaurantImg, availabilityBadge, hoursText, emptyState, toast,
  confirmDialog, withBusy, updateCartBadge, fmtDate, $,
} from '../ui.js';
import { getCart, canAdd, setQty, qtyOf, cartTotal, cartCount, clearCart } from '../cart.js';

const id = Number(new URLSearchParams(location.search).get('id'));
const view = $('#view');
let user = null;
let R = null;
let MENU = [];

(async () => {
  user = await mountChrome('restaurants');
  try {
    const data = await api(`/public/restaurants/${id}`);
    R = data.restaurant; MENU = data.menu;
    document.title = `${R.name} · UniBite`;
    render(data);
  } catch (err) {
    view.innerHTML = `<div class="container">${emptyState('store', 'Restaurant unavailable', err.status === 404 ? 'This outlet is not currently on UniBite.' : err.message, '<a class="btn btn-primary" href="/restaurants.html">Browse restaurants</a>')}</div>`;
  }
})();

function render({ reviews }) {
  const sections = {};
  for (const p of MENU) (sections[p.menu_section || 'Menu'] ||= []).push(p);
  const closedNotice = !R.accepting_orders
    ? `<div class="notice notice-warning" style="margin-bottom:16px">${icon('clock')}<div>${esc(R.name)} is not accepting orders right now. ${R.availability_status === 'closed' ? 'The outlet is closed.' : `Opening hours: ${esc(hoursText(R))} (${esc(R.operating_days.join(', '))}).`}</div></div>`
    : R.availability_status === 'busy' ? `<div class="notice notice-info" style="margin-bottom:16px">${icon('info')}<div>It is busy right now, so orders may take a little longer than usual.</div></div>` : '';

  view.innerHTML = `
    <div class="r-hero">${restaurantImg(R, 'cover')}</div>
    <div class="container">
      <div class="r-head">
        <div class="r-logo">${restaurantImg(R, 'logo')}</div>
        <div class="r-head-info">
          <div class="row">${availabilityBadge(R)}<span class="badge badge-accent plain">${esc(R.category_name)}</span>
            ${R.avg_rating ? `<span class="stars">${icon('star', 'icon-sm')}${R.avg_rating} <span class="muted small" style="font-weight:500">(${R.rating_count} ratings)</span></span>` : ''}</div>
          <h1 style="font-size:2.25rem;margin:8px 0 0">${esc(R.name)}</h1>
        </div>
      </div>
      <div class="detail-layout">
        <div>
          <p class="muted" style="font-size:1.05rem">${esc(R.description)}</p>
          ${closedNotice}
          ${MENU.length ? `<div class="filters" style="margin-bottom:16px" role="search">
            <div class="input-icon" style="flex:1 1 220px">${icon('search')}<label class="sr-only" for="menu-q">Search the menu</label><input id="menu-q" class="input" placeholder="Search this menu"></div>
            <label class="sr-only" for="menu-sec">Menu category</label>
            <select id="menu-sec" class="select" style="width:auto"><option value="">All categories</option>${Object.keys(sections).map((n) => `<option>${esc(n)}</option>`).join('')}</select>
          </div>` : ''}
          <div id="menu">${MENU.length ? Object.entries(sections).map(([name, items]) => `
            <section class="menu-section" data-section="${esc(name)}"><h3>${esc(name)}</h3>${items.map(itemHtml).join('')}</section>`).join('')
            : emptyState('utensils', 'Menu coming soon', 'This outlet has not published its menu yet.')}</div>
          ${reviews.length ? `<section class="menu-section"><h3>What students say</h3>${reviews.map((rv) => `
            <div class="review"><div class="row"><span class="stars small">${icon('star', 'icon-sm')}${rv.score}</span><strong>${esc(rv.student_name)}</strong><span class="muted small">${fmtDate(rv.created_at)}</span></div>
            ${rv.comment ? `<p style="margin:4px 0 0">${esc(rv.comment)}</p>` : ''}</div>`).join('')}</section>` : ''}
        </div>
        <aside class="stack sticky-panel">
          <div class="card card-pad" id="cart-panel" aria-live="polite"></div>
          <div class="card card-pad">
            <h3>Outlet info</h3>
            <ul class="info-list">
              <li>${icon('pin')}<span>${esc(R.campus_location)}</span></li>
              <li>${icon('clock')}<span>${esc(hoursText(R))}<br><span class="muted small">${esc(R.operating_days.join(' · '))}</span></span></li>
              <li>${icon('phone')}<a href="tel:${esc(R.contact_phone)}">${esc(R.contact_phone)}</a></li>
              <li>${icon('mail')}<a href="mailto:${esc(R.email)}">${esc(R.email)}</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
    <div class="mobile-cart-bar"><a href="#cart-panel" class="btn btn-primary btn-lg" id="mobile-cart">${icon('bag')}<span></span></a></div>`;
  renderCart();
  view.addEventListener('click', onClick);
  const filter = () => {
    const q = ($('#menu-q')?.value || '').trim().toLowerCase();
    const sec = $('#menu-sec')?.value || '';
    document.querySelectorAll('.menu-section[data-section]').forEach((s) => {
      let visible = 0;
      s.querySelectorAll('.menu-item').forEach((el) => {
        const p = MENU.find((x) => x.id === Number(el.dataset.pid));
        const show = (!sec || s.dataset.section === sec) && (!q || `${p.name} ${p.description || ''} ${p.menu_section || ''}`.toLowerCase().includes(q));
        el.classList.toggle('hidden', !show);
        if (show) visible++;
      });
      s.classList.toggle('hidden', !visible);
    });
  };
  $('#menu-q')?.addEventListener('input', filter);
  $('#menu-sec')?.addEventListener('change', filter);
}

function itemHtml(p) {
  const q = qtyOf(p.id);
  const can = p.is_available && R.accepting_orders;
  return `
    <div class="menu-item ${p.is_available ? '' : 'unavailable'}" data-pid="${p.id}">
      <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<div class="placeholder-art" style="background:var(--color-muted);color:var(--color-primary)">${icon('utensils')}</div>`}</div>
      <div class="info"><h4>${esc(p.name)}</h4>${p.description ? `<p>${esc(p.description)}</p>` : ''}
        <div class="row" style="margin-top:6px"><span class="price">${money(p.price)}</span>${p.is_available ? '' : '<span class="badge badge-neutral">Sold out</span>'}</div></div>
      <div class="qty-slot">${!can ? '' : q
        ? `<div class="qty"><button data-act="dec" aria-label="Remove one ${esc(p.name)}">${icon('minus', 'icon-sm')}</button><span aria-label="Quantity">${q}</span><button data-act="inc" aria-label="Add one ${esc(p.name)}">${icon('plus', 'icon-sm')}</button></div>`
        : `<button class="btn btn-secondary btn-sm" data-act="inc" aria-label="Add ${esc(p.name)} to cart">${icon('plus', 'icon-sm')}Add</button>`}</div>
    </div>`;
}

async function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'checkout') return checkout(btn);
  if (act === 'clear') { clearCart(); refresh(); return; }
  const row = btn.closest('[data-pid]');
  const p = MENU.find((x) => x.id === Number(row.dataset.pid));
  if (!canAdd(R.id)) {
    const ok = await confirmDialog({ title: 'Start a new cart?', message: `Your cart has items from <strong>${esc(getCart().restaurantName)}</strong>. Orders can only include one outlet. Clear it and add this item instead?`, confirmText: 'Start new cart' });
    if (!ok) return;
    clearCart();
  }
  setQty(R, p, qtyOf(p.id) + (act === 'inc' ? 1 : -1));
  refresh();
}

function refresh() {
  document.querySelectorAll('.menu-item').forEach((el) => {
    const p = MENU.find((x) => x.id === Number(el.dataset.pid));
    const hidden = el.classList.contains('hidden');
    el.outerHTML = itemHtml(p);
    if (hidden) document.querySelector(`.menu-item[data-pid="${p.id}"]`)?.classList.add('hidden');
  });
  renderCart();
  updateCartBadge();
}

function renderCart() {
  const c = getCart();
  const mine = c.restaurantId === R.id ? c.items : [];
  const panel = $('#cart-panel');
  const mobile = $('#mobile-cart span');
  if (mobile) {
    mobile.textContent = mine.length ? `View cart · ${money(cartTotal())}` : 'Your cart is empty';
    $('.mobile-cart-bar').classList.toggle('hidden', !mine.length);
  }
  if (!mine.length) {
    panel.innerHTML = `<h3>Your order</h3>${emptyState('bag', 'Cart is empty', 'Add items from the menu to get started.')}`;
    return;
  }
  let action;
  if (!user) action = `<a class="btn btn-primary btn-block btn-lg" href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">Log in to order</a>`;
  else if (user.role !== 'student') action = `<div class="notice notice-info">${icon('info')}<div>Only student accounts can place orders.</div></div>`;
  else if (!R.accepting_orders) action = `<button class="btn btn-primary btn-block btn-lg" disabled>Not accepting orders</button>`;
  else action = `<button class="btn btn-primary btn-block btn-lg" data-act="checkout" data-busy="Placing order…">Place order · ${money(cartTotal())}</button>`;

  panel.innerHTML = `
    <div class="row"><h3 style="margin:0">Your order</h3><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="clear">Clear</button></div>
    <div>${mine.map((i) => `<div class="cart-line" data-pid="${i.product_id}"><span class="name">${esc(i.name)}</span>
      <div class="qty"><button data-act="dec" aria-label="Remove one ${esc(i.name)}">${icon('minus', 'icon-sm')}</button><span>${i.quantity}</span><button data-act="inc" aria-label="Add one ${esc(i.name)}">${icon('plus', 'icon-sm')}</button></div>
      <span class="price small">${money(i.price * i.quantity)}</span></div>`).join('')}</div>
    <div class="field" style="margin-top:12px"><label for="order-notes">Notes for the kitchen</label>
      <textarea id="order-notes" class="textarea" maxlength="300" placeholder="Allergies, no onions, extra sauce…" style="min-height:64px"></textarea></div>
    <div class="cart-total"><span>Total (${cartCount()} items)</span><span>${money(cartTotal())}</span></div>
    <p class="muted small">Pay at pickup. You will get a pickup code once your order is placed.</p>
    ${action}`;
}

async function checkout(btn) {
  const c = getCart();
  await withBusy(btn, async () => {
    try {
      const { order } = await api('/student/orders', {
        method: 'POST',
        body: { restaurant_id: R.id, notes: $('#order-notes').value, items: c.items.map(({ product_id, quantity }) => ({ product_id, quantity })) },
      });
      clearCart();
      location.href = `/orders.html?placed=${order.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
