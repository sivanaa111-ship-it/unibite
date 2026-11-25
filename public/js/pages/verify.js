import { api } from '../api.js';
import { icon } from '../icons.js';
import { mountChrome, esc, $ } from '../ui.js';

mountChrome();
const token = new URLSearchParams(location.search).get('token') || '';
const view = $('#view');

api('/auth/verify-email', { method: 'POST', body: { token } })
  .then(({ user }) => {
    view.innerHTML = `<div class="empty" style="padding:24px 0"><div class="empty-icon">${icon('check', 'icon-lg')}</div>
      <h1 style="font-size:1.75rem">Email verified</h1><p>Welcome to UniBite, ${esc(user.name.split(' ')[0])}! Your student account is active.</p>
      <a class="btn btn-primary" href="/restaurants.html">Start ordering</a></div>`;
  })
  .catch((err) => {
    view.innerHTML = `<h1 style="font-size:1.75rem">Link not valid</h1><p class="muted">${esc(err.message)}</p>
      <a class="btn btn-primary" href="/login.html">Go to login</a>`;
  });
