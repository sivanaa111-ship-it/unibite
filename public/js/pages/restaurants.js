import { api } from '../api.js';
import { icon } from '../icons.js';
import { mountChrome, esc, money, emptyState, $, $$ } from '../ui.js';
import { hydrateIcons, restaurantCard, skeletonCards, pagerHtml } from '../components.js';

hydrateIcons();
mountChrome('restaurants');

const params = new URLSearchParams(location.search);
const state = {
  mode: params.get('mode') === 'dishes' ? 'dishes' : 'restaurants',
  q: params.get('q') || '', category: params.get('category') || '', availability: params.get('availability') || '',
  section: params.get('section') || '', sort: params.get('sort') || 'name_asc', page: Number(params.get('page')) || 1,
};
$('#q').value = state.q; $('#availability').value = state.availability; $('#sort').value = state.sort;

api('/public/categories').then(({ items }) => {
  const chips = [{ id: '', name: 'All', icon: 'grid' }, ...items];
  $('#cat-chips').innerHTML = chips.map((c) =>
    `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${String(c.id) === state.category}">${icon(c.icon, 'icon-sm')}${esc(c.name)}</button>`).join('');
});
$('#cat-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  state.category = b.dataset.cat; state.page = 1;
  $$('#cat-chips .chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
  load();
});

function syncMode() {
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === state.mode));
  const dishes = state.mode === 'dishes';
  $('#q').placeholder = dishes ? 'Search dishes and drinks, e.g. latte, burger, vegan' : 'Search by name or location';
  $('#section').classList.toggle('hidden', !dishes);
  $('#availability').classList.toggle('hidden', dishes);
  $('#sort').classList.toggle('hidden', dishes);
}
$$('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; state.page = 1; syncMode(); load(); }));
syncMode();

let t;
$('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; load(); }, 300); });
$('#filters').addEventListener('submit', (e) => { e.preventDefault(); state.q = $('#q').value.trim(); load(); });
$('#availability').addEventListener('change', (e) => { state.availability = e.target.value; state.page = 1; load(); });
$('#section').addEventListener('change', (e) => { state.section = e.target.value; load(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; load(); });
$('#pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
  state.page = Number(b.dataset.page); load(); window.scrollTo({ top: 0, behavior: 'smooth' });
});

function dishCard(p) {
  return `<a class="card menu-item" href="/restaurant.html?id=${p.restaurant.id}" style="color:inherit;text-decoration:none">
    <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<div class="placeholder-art" style="background:var(--color-muted);color:var(--color-primary)">${icon('utensils')}</div>`}</div>
    <div class="info"><h4>${esc(p.name)}</h4>${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <div class="row" style="margin-top:6px;gap:8px"><span class="price">${money(p.price)}</span>${p.menu_section ? `<span class="badge badge-accent plain">${esc(p.menu_section)}</span>` : ''}
        ${!p.is_available ? '<span class="badge badge-neutral">Sold out</span>' : !p.restaurant.accepting_orders ? '<span class="badge badge-neutral">Closed now</span>' : ''}</div>
      <div class="small muted" style="margin-top:4px">${icon('store', 'icon-sm')} ${esc(p.restaurant.name)} · ${esc(p.restaurant.campus_location)}</div></div>
    ${icon('chevronRight')}</a>`;
}

async function load() {
  const qs = new URLSearchParams(Object.entries(state).filter(([k, v]) => v !== '' && v != null && !(k === 'mode' && v === 'restaurants')));
  history.replaceState(null, '', `?${qs}`);
  $('#grid').innerHTML = skeletonCards(6);
  try {
    if (state.mode === 'dishes') {
      const data = await api(`/public/menu-items?${new URLSearchParams({ q: state.q, section: state.section, category: state.category })}`);
      const sel = $('#section');
      if (sel.options.length <= 1) sel.insertAdjacentHTML('beforeend', data.sections.map((s) => `<option ${s === state.section ? 'selected' : ''}>${esc(s)}</option>`).join(''));
      $('#result-count').textContent = `${data.items.length} ${data.items.length === 1 ? 'item' : 'items'} found`;
      $('#grid').innerHTML = data.items.length ? data.items.map(dishCard).join('') : emptyState('search', 'No dishes match', 'Try another name or menu category.');
      $('#pager').innerHTML = '';
      return;
    }
    const data = await api(`/public/restaurants?${qs}&pageSize=12`);
    $('#result-count').textContent = `${data.total} ${data.total === 1 ? 'outlet' : 'outlets'} found`;
    $('#grid').innerHTML = data.items.length ? data.items.map(restaurantCard).join('')
      : emptyState('search', 'No restaurants match', 'Try a different search or clear the filters.');
    $('#pager').innerHTML = pagerHtml(data, 'outlets');
  } catch (err) {
    $('#grid').innerHTML = emptyState('alert', 'Could not load results', err.message);
  }
}
load();
