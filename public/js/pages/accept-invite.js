import { api, getMe } from '../api.js';
import { mountChrome, showErrors, withBusy, esc, $, $$ } from '../ui.js';

mountChrome();
const token = new URLSearchParams(location.search).get('token') || '';
const form = $('#invite-form');
let existing = false;

api(`/auth/invitations/${encodeURIComponent(token)}`).then((inv) => {
  if (!inv.valid) {
    $('#intro').innerHTML = 'This invitation is invalid, has expired, or was revoked. Ask the UniBite administrator to send a new one.';
    return;
  }
  existing = inv.existing_account;
  $('#intro').innerHTML = `You have been invited to manage <strong>${esc(inv.restaurant_name)}</strong> on UniBite as <strong>${esc(inv.email)}</strong>.`
    + (existing ? ' You already have a restaurant account, so enter your current password to accept.' : ' Create your password to activate your owner account.');
  $('#email-ro').value = inv.email;
  if (existing) {
    $$('[data-new]', form).forEach((el) => el.classList.add('hidden'));
    $('#pw-label').innerHTML = 'Your current password <span class="req">*</span>';
    $('#password').setAttribute('autocomplete', 'current-password');
  }
  form.classList.remove('hidden');
}).catch(() => { $('#intro').textContent = 'Could not check this invitation. Please try again.'; });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = { token, ...Object.fromEntries(new FormData(form)) };
  if (!existing && body.password !== body.confirm_password) {
    return showErrors(form, { message: 'Passwords do not match', fields: { confirm_password: 'Passwords do not match' } });
  }
  withBusy(form.querySelector('[type=submit]'), async () => {
    try {
      const r = await api('/auth/invitations/accept', { method: 'POST', body });
      await getMe(true);
      location.href = r.redirect;
    } catch (err) { showErrors(form, err); }
  });
});
