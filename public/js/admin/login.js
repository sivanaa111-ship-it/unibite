import { api } from '../api.js';
import { showErrors, withBusy, $ } from '../ui.js';
import { hydrateIcons } from '../components.js';

hydrateIcons();
const loginForm = $('#admin-login');
const mfaForm = $('#admin-mfa');
const next = new URLSearchParams(location.search).get('next');
const dest = next && next.startsWith('/admin') && !next.startsWith('/admin/login') ? next : '/admin/';
let mfaToken = null;

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy(loginForm.querySelector('[type=submit]'), async () => {
    try {
      const r = await api('/auth/admin/login', { method: 'POST', body: Object.fromEntries(new FormData(loginForm)) });
      if (r.mfa_required) {
        mfaToken = r.mfa_token;
        loginForm.classList.add('hidden');
        mfaForm.classList.remove('hidden');
        mfaForm.code.focus();
        return;
      }
      location.href = dest;
    } catch (err) { showErrors(loginForm, err); }
  });
});

mfaForm.addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy(mfaForm.querySelector('[type=submit]'), async () => {
    try {
      await api('/auth/admin/mfa', { method: 'POST', body: { mfa_token: mfaToken, code: mfaForm.code.value.trim() } });
      location.href = dest;
    } catch (err) {
      if (err.status === 401) { location.reload(); return; }
      showErrors(mfaForm, err);
    }
  });
});
