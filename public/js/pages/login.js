import { api, getMe } from '../api.js';
import { mountChrome, showErrors, withBusy, toast, $, $$ } from '../ui.js';
import { hydrateIcons } from '../components.js';

hydrateIcons();
const form = $('#login-form');
const params = new URLSearchParams(location.search);
const next = params.get('next');
const safeNext = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/admin') ? next : null;

const HOME = { student: '/restaurants.html', restaurant: '/restaurant-dashboard.html', admin: '/admin/' };
const TEXT = {
  student: {
    label: 'University email', side: 'Log in to order from every restaurant, café and food truck on campus.',
    switch: 'New to UniBite? <a href="/register.html">Create a student account</a>',
  },
  restaurant: {
    label: 'Restaurant account email', side: 'Manage your menu, incoming orders and restaurant profile.',
    switch: 'Not on UniBite yet? <a href="/partner.html">Register your restaurant</a>. Restaurant accounts are activated through an invitation from the UniBite team.',
  },
};

function setPortal(p) {
  form.portal.value = p;
  $$('[data-portal]').forEach((b) => { const on = b.dataset.portal === p; b.setAttribute('aria-pressed', on); b.setAttribute('aria-selected', on); });
  $('#email-label').textContent = TEXT[p].label;
  $('#side-text').textContent = TEXT[p].side;
  $('#switch-text').innerHTML = TEXT[p].switch;
  $('#after-form').innerHTML = '';
}
$$('[data-portal]').forEach((b) => b.addEventListener('click', () => { setPortal(b.dataset.portal); history.replaceState(null, '', `?as=${b.dataset.portal}${next ? `&next=${encodeURIComponent(next)}` : ''}`); }));
setPortal(params.get('as') === 'restaurant' ? 'restaurant' : 'student');

mountChrome().then((u) => { if (u) location.replace(HOME[u.role]); });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const res = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      await getMe(true);
      location.href = safeNext || res.redirect;
    } catch (err) {
      showErrors(form, err);
      if (err.code === 'EMAIL_NOT_VERIFIED') offerResend();
      if (err.code === 'WRONG_PORTAL') {
        const other = form.portal.value === 'student' ? 'restaurant' : 'student';
        $('#after-form').innerHTML = `<button type="button" class="btn btn-secondary btn-block" style="margin-top:12px" id="switch-portal">Switch to Login as ${other === 'student' ? 'Student' : 'Restaurant'}</button>`;
        $('#switch-portal').addEventListener('click', () => { setPortal(other); form.requestSubmit(); });
      }
    }
  });
});

function offerResend() {
  $('#after-form').innerHTML = `<div class="notice notice-info" style="margin-top:12px"><div>Didn't get the email? <button type="button" class="btn btn-ghost btn-sm" id="resend">Resend verification link</button></div></div>`;
  $('#resend').addEventListener('click', async (e) => {
    try {
      const r = await api('/auth/resend-verification', { method: 'POST', body: { email: form.email.value } });
      toast(r.message);
      e.target.disabled = true;
    } catch (err) { toast(err.message, 'error'); }
  });
}
// Message after verification redirect, etc.
if (params.get('verified')) toast('Email verified. You can now log in.');
if (params.get('msg')) toast(params.get('msg'));
