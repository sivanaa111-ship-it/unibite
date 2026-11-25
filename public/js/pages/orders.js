import { api } from '../api.js';
import { icon } from '../icons.js';
import {
  mountChrome, esc, money, orderBadge, fmtDateTime, timeAgo, emptyState, toast, confirmDialog,
  openModal, showErrors, withBusy, $, $$,
} from '../ui.js';
import { trackerHtml } from '../components.js';

const view = $('#tab-view');
const placed = Number(new URLSearchParams(location.search).get('placed')) || null;
let user;
let tab = 'active';
let poll;

const STATUS_MSG = {
  pending: 'Waiting for the restaurant to confirm your order.',
  accepted: 'Your order was accepted and will be prepared shortly.',
  preparing: 'The kitchen is preparing your order.',
  ready: 'Your order is ready! Show your pickup code at the counter.',
  completed: 'Picked up. Enjoy your meal!',
  cancelled: 'This order was cancelled.',
  rejected: 'The restaurant could not accept this order.',
};

(async () => {
  user = await mountChrome();
  if (placed) toast('Order placed! We will keep this page updated.');
  show('active');
})();

$$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

function show(t) {
  tab = t;
  $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
  clearInterval(poll);
  if (t === 'account') return renderAccount();
  load();
  if (t === 'active') poll = setInterval(() => load(true), 8000);
}

async function load(silent = false) {
  if (!silent) view.innerHTML = '<div class="skeleton" style="height:180px"></div>';
  try {
    const { items } = await api('/student/orders');
    const active = ['pending', 'accepted', 'preparing', 'ready'];
    const list = items.filter((o) => (tab === 'active' ? active.includes(o.status) : !active.includes(o.status)));
    if (!list.length) {
      view.innerHTML = tab === 'active'
        ? emptyState('bag', 'No active orders', 'Hungry? Browse campus outlets and order ahead.', '<a class="btn btn-primary" href="/restaurants.html">Browse restaurants</a>')
        : emptyState('history', 'No past orders yet', 'Completed and cancelled orders will appear here.');
      return;
    }
    view.innerHTML = `<div class="stack">${list.map(orderCard).join('')}</div>`;
  } catch (err) {
    if (!silent) view.innerHTML = emptyState('alert', 'Could not load orders', err.message);
  }
}

function orderCard(o) {
  const highlight = o.id === placed ? 'style="border-color:var(--color-primary);box-shadow:0 0 0 3px var(--color-primary-soft)"' : '';
  const showCode = ['pending', 'accepted', 'preparing', 'ready'].includes(o.status);
  return `
    <article class="card order-card" ${highlight} data-oid="${o.id}">
      <div class="order-head">
        <div><h3 style="margin:0">${esc(o.restaurant_name)}</h3><span class="muted small">Order #${o.id} · ${fmtDateTime(o.created_at)} · ${icon('pin', 'icon-sm')} ${esc(o.restaurant_location)}</span></div>
        <span class="spacer"></span>${orderBadge(o.status)}
      </div>
      ${trackerHtml(o.status)}
      <p class="small" style="margin:8px 0">${esc(STATUS_MSG[o.status])} <span class="muted">Updated ${timeAgo(o.updated_at)}.</span></p>
      <div class="row" style="align-items:flex-start;gap:24px">
        <ul style="margin:0;padding-left:18px;flex:1;min-width:200px" class="small">${o.items.map((i) => `<li>${i.quantity} × ${esc(i.product_name)} <span class="muted">${money(i.unit_price * i.quantity)}</span></li>`).join('')}</ul>
        ${showCode ? `<div><div class="muted small">Pickup code</div><div class="pickup-code">${esc(o.pickup_code)}</div></div>` : ''}
      </div>
      ${o.notes ? `<p class="small muted" style="margin-top:8px">Note: ${esc(o.notes)}</p>` : ''}
      <div class="row" style="margin-top:12px">
        <strong>Total ${money(o.total)}</strong><span class="spacer"></span>
        ${o.status === 'pending' ? `<button class="btn btn-secondary btn-sm" data-cancel="${o.id}">Cancel order</button>` : ''}
        ${o.status === 'completed' && !o.rating ? `<button class="btn btn-primary btn-sm" data-rate="${o.id}">${icon('star', 'icon-sm')}Rate order</button>` : ''}
        ${o.rating ? `<span class="stars small">${icon('star', 'icon-sm')}You rated ${o.rating.score}/5</span>` : ''}
        ${o.status === 'completed' && o.restaurant_active ? `<a class="btn btn-ghost btn-sm" href="/restaurant.html?id=${o.restaurant_id}">Order again</a>` : ''}
      </div>
    </article>`;
}

view.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-cancel]');
  const r = e.target.closest('[data-rate]');
  if (c) {
    const ok = await confirmDialog({ title: 'Cancel this order?', message: `Order #${c.dataset.cancel} will be cancelled. This cannot be undone.`, confirmText: 'Cancel order', danger: true });
    if (!ok) return;
    try { await api(`/student/orders/${c.dataset.cancel}/cancel`, { method: 'POST' }); toast('Order cancelled'); load(); }
    catch (err) { toast(err.message, 'error'); }
  }
  if (r) rate(Number(r.dataset.rate));
});

function rate(orderId) {
  let score = 0;
  const m = openModal({
    title: 'Rate your order',
    body: `<form id="rate-form" class="stack">
      <div class="field"><span class="label" id="score-label">Your rating</span>
        <div class="rating-input" role="radiogroup" aria-labelledby="score-label">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" data-score="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star')}</button>`).join('')}</div>
        <input type="hidden" name="score"></div>
      <div class="field"><label for="rate-comment">Comment (optional)</label><textarea id="rate-comment" name="comment" class="textarea" maxlength="500"></textarea></div>
    </form>`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="rate-submit" data-busy="Saving…">Submit rating</button>',
  });
  const form = m.el.querySelector('#rate-form');
  m.el.querySelectorAll('[data-score]').forEach((b) => b.addEventListener('click', () => {
    score = Number(b.dataset.score);
    form.score.value = score;
    m.el.querySelectorAll('[data-score]').forEach((x) => { const on = Number(x.dataset.score) <= score; x.classList.toggle('on', on); x.setAttribute('aria-checked', Number(x.dataset.score) === score); });
  }));
  const submit = m.el.querySelector('#rate-submit');
  submit.addEventListener('click', () => withBusy(submit, async () => {
    try {
      await api(`/student/orders/${orderId}/rating`, { method: 'POST', body: { score, comment: form.comment.value } });
      m.close(); toast('Thanks for your rating!'); load();
    } catch (err) { showErrors(form, err); }
  }));
}

function renderAccount() {
  view.innerHTML = `
    <div class="grid-2">
      <form class="card card-pad stack" id="profile-form" novalidate>
        <h3>Profile</h3>
        <div class="field"><label for="p-name">Full name</label><input id="p-name" name="name" class="input" value="${esc(user.name)}"></div>
        <div class="field"><label for="p-email">University email</label><input id="p-email" class="input" value="${esc(user.email)}" disabled></div>
        <div class="field"><label for="p-uid">University ID</label><input id="p-uid" class="input" value="${esc(user.university_id || '')}" disabled>
          <span class="hint">${user.verification_status === 'verified' ? 'Verified against university records' : 'Pending verification by UniBite'}</span></div>
        <div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone" class="input" type="tel" value="${esc(user.phone || '')}"></div>
        <div><button class="btn btn-primary" type="submit" data-busy="Saving…">Save profile</button></div>
      </form>
      <form class="card card-pad stack" id="pw-form" novalidate>
        <h3>Change password</h3>
        <div class="field"><label for="cur">Current password</label><input id="cur" name="current_password" type="password" class="input" autocomplete="current-password"></div>
        <div class="field"><label for="np">New password</label><input id="np" name="new_password" type="password" class="input" autocomplete="new-password"><span class="hint">8+ characters with a letter and a number. Other devices will be signed out.</span></div>
        <div><button class="btn btn-primary" type="submit" data-busy="Updating…">Update password</button></div>
      </form>
    </div>`;
  bindForm('#profile-form', '/student/profile', 'PATCH', 'Profile saved');
  bindForm('#pw-form', '/auth/change-password', 'POST', 'Password updated', (f) => f.reset());
}

function bindForm(sel, path, method, msg, after) {
  const f = $(sel);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(f.querySelector('[type=submit]'), async () => {
      try { await api(path, { method, body: Object.fromEntries(new FormData(f)) }); toast(msg); after && after(f); }
      catch (err) { showErrors(f, err); }
    });
  });
}
