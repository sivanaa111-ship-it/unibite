// Super Admin account security: two-factor authentication + password.
import { icon } from '../icons.js';
import { esc, toast, showErrors, withBusy, fmtDateTime, $ } from '../ui.js';
import { ctx, setTitle, mainError, adminApi as api } from './main.js';

export async function renderSecurity() {
  setTitle('Admin Security');
  try {
    const s = await api('/admin/security');
    ctx.main.innerHTML = `<div class="grid-2" style="align-items:start">
      <section class="card card-pad" id="tfa">
        <div class="row"><h2 style="font-size:1rem;margin:0;flex:1">Two-factor authentication</h2>${s.totp_enabled ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-warning">Not enabled</span>'}</div>
        <p class="muted small">Require a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) every time you sign in at /admin/login.</p>
        <div id="tfa-body">${s.totp_enabled
          ? `<form id="tfa-off" class="stack" novalidate><div class="form-grid">
              <div class="field"><label for="off-pw">Password</label><input id="off-pw" name="password" type="password" class="input" autocomplete="current-password"></div>
              <div class="field"><label for="off-code">Current code</label><input id="off-code" name="code" class="input" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div></div>
              <div><button class="btn btn-secondary" type="submit" data-busy="Disabling…">Disable two-factor authentication</button></div></form>`
          : `<button class="btn btn-primary" id="tfa-start">${icon('shield', 'icon-sm')}Set up two-factor authentication</button>`}</div>
      </section>
      <form class="card card-pad stack" id="pw-form" novalidate>
        <h2 style="font-size:1rem;margin:0">Change password</h2>
        <p class="muted small" style="margin:0">Signed in as ${esc(s.email)}${s.last_login_at ? ` · last sign-in ${fmtDateTime(s.last_login_at)}` : ''}. Changing your password signs out all other sessions.</p>
        <div class="field"><label for="cur">Current password</label><input id="cur" name="current_password" type="password" class="input" autocomplete="current-password"></div>
        <div class="field"><label for="np">New password</label><input id="np" name="new_password" type="password" class="input" autocomplete="new-password"></div>
        <div><button class="btn btn-primary" type="submit" data-busy="Updating…">Update password</button></div>
      </form></div>
      <div class="notice notice-info" style="margin-top:16px">${icon('info')}<div>Administrator accounts cannot be created from the website. Additional administrators can only be provisioned on the server with <code>npm run admin:create</code>, which requires your credentials as authorization.</div></div>`;

    $('#tfa-start')?.addEventListener('click', setup);
    const off = $('#tfa-off');
    off?.addEventListener('submit', (e) => {
      e.preventDefault();
      withBusy(off.querySelector('[type=submit]'), async () => {
        try { await api('/admin/security/2fa/disable', { method: 'POST', body: Object.fromEntries(new FormData(off)) }); toast('Two-factor authentication disabled'); renderSecurity(); }
        catch (err) { showErrors(off, err); }
      });
    });
    const pw = $('#pw-form');
    pw.addEventListener('submit', (e) => {
      e.preventDefault();
      withBusy(pw.querySelector('[type=submit]'), async () => {
        try { await api('/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(pw)) }); toast('Password updated'); pw.reset(); }
        catch (err) { showErrors(pw, err); }
      });
    });
  } catch (err) { mainError(err); }
}

async function setup() {
  try {
    const d = await api('/admin/security/2fa/setup', { method: 'POST' });
    $('#tfa-body').innerHTML = `
      <ol class="small" style="padding-left:18px">
        <li>Scan this QR code with your authenticator app.</li>
        <li>Enter the 6-digit code it shows to confirm.</li>
      </ol>
      <div class="row" style="align-items:flex-start">
        <img src="${d.qr}" alt="QR code for your authenticator app" width="180" height="180" style="border:1px solid var(--admin-border);border-radius:8px">
        <div class="small" style="flex:1;min-width:180px">Can't scan? Enter this key manually:<br><code style="word-break:break-all;font-size:.85rem">${esc(d.secret)}</code></div>
      </div>
      <form id="tfa-on" class="stack" novalidate style="margin-top:12px">
        <div class="field"><label for="on-code">Verification code</label><input id="on-code" name="code" class="input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="max-width:200px;letter-spacing:.3em"></div>
        <div><button class="btn btn-primary" type="submit" data-busy="Verifying…">Enable</button></div>
      </form>`;
    const f = $('#tfa-on');
    f.code.focus();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      withBusy(f.querySelector('[type=submit]'), async () => {
        try { await api('/admin/security/2fa/enable', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); toast('Two-factor authentication enabled'); renderSecurity(); }
        catch (err) { showErrors(f, err); }
      });
    });
  } catch (err) { toast(err.message, 'error'); }
}
