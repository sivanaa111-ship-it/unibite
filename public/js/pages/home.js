import { api } from '../api.js';
import { icon } from '../icons.js';
import { mountChrome, esc, emptyState } from '../ui.js';
import { hydrateIcons, restaurantCard, skeletonCards } from '../components.js';

hydrateIcons();
mountChrome('home');

const featured = document.getElementById('featured');
featured.innerHTML = skeletonCards(3);

api('/public/stats').then((s) => {
  document.getElementById('stats').innerHTML = `
    <div><strong>${s.restaurants}</strong><span>Campus outlets</span></div>
    <div><strong>${s.orders}+</strong><span>Orders picked up</span></div>
    <div><strong>${s.students}</strong><span>Students</span></div>`;
}).catch(() => {});

api('/public/categories').then(({ items }) => {
  document.getElementById('categories').innerHTML = items.map((c) => `
    <a class="cat-card" href="/restaurants.html?category=${c.id}">
      <span class="cat-icon">${icon(c.icon)}</span>${esc(c.name)}
      <small>${c.restaurant_count} ${c.restaurant_count === 1 ? 'outlet' : 'outlets'}</small>
    </a>`).join('');
}).catch(() => {});

api('/public/restaurants?sort=rating&pageSize=6').then(({ items }) => {
  featured.innerHTML = items.length ? items.map(restaurantCard).join('') : emptyState('store', 'No restaurants yet', 'Check back soon.');
}).catch((e) => { featured.innerHTML = emptyState('alert', 'Could not load restaurants', e.message); });
