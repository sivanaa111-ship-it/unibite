import { api } from '../api.js';
import { icon } from '../icons.js';
import { mountChrome, showErrors, withBusy, esc } from '../ui.js';

mountChrome('partner');
const form = document.getElementById('partner-form');

api('/public/categories').then(({ items }) => {
  form.category_id.insertAdjacentHTML('beforeend', items.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(''));
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await api('/public/restaurant-requests', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.outerHTML = `<div class="card card-pad"><div class="empty"><div class="empty-icon">${icon('check', 'icon-lg')}</div>
        <h3>Application submitted</h3><p>Thank you! Your application is now <strong>pending review</strong>. We sent a confirmation to your email and will let you know the outcome. If you are approved, you will receive a link to activate your owner account.</p>
        <a class="btn btn-secondary" href="/">Back to home</a></div></div>`;
    } catch (err) { showErrors(form, err); }
  });
});
