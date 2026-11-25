// Reusable rendering helpers shared by public pages and dashboards.
import { icon } from './icons.js';
import { esc, $$, restaurantImg, availabilityBadge, hoursText } from './ui.js';

/** Replace data-icon placeholders in static HTML with SVGs. */
export function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    const svg = icon(el.dataset.icon);
    if (el.tagName === 'BUTTON' || el.tagName === 'A') el.insertAdjacentHTML('afterbegin', svg);
    else el.outerHTML = svg;
  });
  $$('[data-icon-big]', root).forEach((el) => { el.innerHTML = icon(el.dataset.iconBig); });
  $$('[data-icon-xl]', root).forEach((el) => { el.outerHTML = icon(el.dataset.iconXl, 'icon-xl'); });
}

/** Restaurant card used on Home and Restaurants pages. */
export function restaurantCard(r) {
  return `
    <a class="card r-card" href="/restaurant.html?id=${r.id}">
      <div class="r-cover">${restaurantImg(r, 'cover')}${availabilityBadge(r)}</div>
      <div class="r-logo">${restaurantImg(r, 'logo')}</div>
      <div class="r-body">
        <div class="row" style="justify-content:space-between;gap:8px">
          <h3>${esc(r.name)}</h3>
          ${r.avg_rating ? `<span class="stars small">${icon('star', 'icon-sm')}${r.avg_rating}<span class="muted" style="font-weight:500">(${r.rating_count})</span></span>` : '<span class="badge badge-accent plain">New</span>'}
        </div>
        <div class="r-meta"><span>${esc(r.category_name)}</span><span>${icon('pin', 'icon-sm')}${esc(r.campus_location)}</span></div>
        <div class="r-meta"><span>${icon('clock', 'icon-sm')}${esc(hoursText(r))}</span></div>
      </div>
    </a>`;
}

export function skeletonCards(n = 6) {
  return Array.from({ length: n }, () => '<div class="card r-card"><div class="r-cover skeleton"></div><div class="r-body"><div class="skeleton" style="height:20px;width:60%"></div><div class="skeleton" style="height:14px;width:80%"></div></div></div>').join('');
}

export function pagerHtml({ page, pages, total }, label = 'results') {
  if (pages <= 1) return total ? `<span>${total} ${label}</span>` : '';
  const range = [];
  for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 1) range.push(p);
  const btns = [];
  let last = 0;
  for (const p of range) {
    if (p - last > 1) btns.push('<span class="muted">…</span>');
    btns.push(`<button class="btn btn-secondary btn-sm" data-page="${p}" ${p === page ? 'aria-current="page"' : ''} aria-label="Page ${p}">${p}</button>`);
    last = p;
  }
  return `<span>Page ${page} of ${pages} · ${total} ${label}</span>
    <div class="row">
      <button class="btn btn-secondary btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft', 'icon-sm')}</button>
      ${btns.join('')}
      <button class="btn btn-secondary btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Next page">${icon('chevronRight', 'icon-sm')}</button>
    </div>`;
}

/** Order progress tracker. */
const FLOW = [['pending', 'Placed', 'receipt'], ['accepted', 'Accepted', 'check'], ['preparing', 'Preparing', 'chef'], ['ready', 'Ready', 'bag'], ['completed', 'Picked up', 'star']];
export function trackerHtml(status) {
  if (['cancelled', 'rejected'].includes(status)) return '';
  const idx = FLOW.findIndex(([s]) => s === status);
  return `<ol class="tracker" aria-label="Order progress">${FLOW.map(([s, label, ic], i) =>
    `<li class="tracker-step ${i < idx ? 'done' : i === idx ? 'current' : ''}" ${i === idx ? 'aria-current="step"' : ''}>
       <div class="dot">${icon(i < idx ? 'check' : ic, 'icon-sm')}</div>${label}</li>`).join('')}</ol>`;
}

/** Copyable one-time link box (used for account setup / reset links). */
export function linkBox(link) {
  return `<div class="notice notice-info">${icon('key')}<div>Share this single-use link with the account holder securely. It expires in ${link.expires_in_minutes} minutes and can only be used once.</div></div>
    <div class="copy-field" style="margin-top:12px"><label class="sr-only" for="setup-link">Setup link</label>
      <input class="input" id="setup-link" readonly value="${esc(link.url)}">
      <button class="btn btn-secondary" type="button" data-copy="#setup-link">${icon('copy', 'icon-sm')}Copy</button></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  const input = document.querySelector(b.dataset.copy);
  input.select();
  navigator.clipboard?.writeText(input.value).catch(() => document.execCommand('copy'));
  b.lastChild.textContent = 'Copied';
});
