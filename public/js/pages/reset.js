import { api } from '../api.js';
import { mountChrome, showErrors, withBusy, esc, $ } from '../ui.js';

mountChrome();
const token = new URLSearchParams(location.search).get('token') || '';
const intro = $('#reset-intro');
const form = $('#reset-form');

api(`/auth/reset-password/${encodeURIComponent(token)}`).then(({ valid, email }) => {
  if (!valid) {
    intro.innerHTML = 'This link is invalid, has expired, or has already been used. <a href="/forgot-password.html">Request a new one</a>.';
    return;
  }
  intro.innerHTML = `Choose a new password for <strong>${esc(email)}</strong>. You will be signed out on all other devices.`;
  form.classList.remove('hidden');
}).catch(() => { intro.textContent = 'Could not verify this link. Please try again.'; });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = { token, ...Object.fromEntries(new FormData(form)) };
  if (body.password !== body.confirm_password) {
    return showErrors(form, { message: 'Passwords do not match', fields: { confirm_password: 'Passwords do not match' } });
  }
  withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await api('/auth/reset-password', { method: 'POST', body });
      $('#reset-view').innerHTML = `<h1 style="font-size:1.75rem">Password saved</h1>
        <p class="muted">You can now log in with your new password.</p><a class="btn btn-primary btn-block" href="/login.html">Go to login</a>`;
    } catch (err) { showErrors(form, err); }
  });
});
