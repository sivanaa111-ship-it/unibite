import { api } from '../api.js';
import { icon } from '../icons.js';
import { mountChrome, showErrors, withBusy, esc, $ } from '../ui.js';

mountChrome();
const form = $('#forgot-form');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy(form.querySelector('[type=submit]'), async () => {
    try {
      const r = await api('/auth/forgot-password', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      const cfg = await api('/public/config').catch(() => ({}));
      $('#view').innerHTML = `<div class="empty" style="padding:24px 0"><div class="empty-icon">${icon('mail', 'icon-lg')}</div>
        <h1 style="font-size:1.6rem">Check your email</h1><p>${esc(r.message)}</p>
        ${cfg.dev_mailbox ? `<p class="small"><a href="/dev/mailbox.html?to=${encodeURIComponent(form.email.value)}">Open the dev mailbox</a></p>` : ''}
        <a class="btn btn-secondary" href="/login.html">Back to login</a></div>`;
    } catch (err) { showErrors(form, err); }
  });
});
