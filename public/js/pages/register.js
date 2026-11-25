import { api } from '../api.js';
import { icon } from '../icons.js';
import { mountChrome, showErrors, withBusy, esc, toast, $ } from '../ui.js';
import { hydrateIcons } from '../components.js';

hydrateIcons();
mountChrome().then((u) => { if (u) location.replace('/'); });

let config = { university_email_domains: [], dev_mailbox: false };
api('/public/config').then((c) => {
  config = c;
  $('#domain-hint').textContent = `Must end with ${c.university_email_domains.map((d) => `@${d}`).join(' or ')}`;
}).catch(() => {});

const form = $('#register-form');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  if (body.password !== body.confirm_password) {
    return showErrors(form, { message: 'Please correct the highlighted fields', fields: { confirm_password: 'Passwords do not match' } });
  }
  withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await api('/auth/register', { method: 'POST', body });
      done(body.email);
    } catch (err) { showErrors(form, err); }
  });
});

function done(email) {
  $('#register-view').innerHTML = `
    <div class="empty" style="padding-top:0"><div class="empty-icon">${icon('mail', 'icon-lg')}</div>
      <h1 style="font-size:1.75rem">Check your inbox</h1>
      <p>We sent a verification link to <strong>${esc(email)}</strong>. Open it to activate your account. The link expires in 24 hours.</p>
      ${config.dev_mailbox ? `<div class="notice notice-warning" style="text-align:left;margin-bottom:12px">${icon('info')}<div>Development mode: email delivery is not configured. <a href="/dev/mailbox.html?to=${encodeURIComponent(email)}">Open the dev mailbox</a> to find the link.</div></div>` : ''}
      <button class="btn btn-secondary" id="resend">Resend link</button> <a class="btn btn-primary" href="/login.html">Go to login</a>
    </div>`;
  $('#resend').addEventListener('click', async (e) => {
    try { const r = await api('/auth/resend-verification', { method: 'POST', body: { email } }); toast(r.message); e.target.disabled = true; }
    catch (err) { toast(err.message, 'error'); }
  });
}
