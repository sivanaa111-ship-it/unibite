import { icon } from '../icons.js';
import { esc, fmtDateTime, toast, confirmDialog, openModal, showErrors, withBusy, emptyState, $$ } from '../ui.js';
import { ctx, setTitle, mainError, refreshCounts, adminApi as api } from './main.js';

const BADGE = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-neutral' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export async function renderRequests(params) {
  setTitle('Restaurant Requests');
  const status = params.get('status') || '';
  try {
    const { items } = await api(`/admin/requests${status ? `?status=${status}` : ''}`);
    ctx.main.innerHTML = `
      <div class="row" style="margin-bottom:16px">
        <p class="muted small" style="margin:0;flex:1;min-width:260px">Applications submitted through <a href="/partner.html" target="_blank" rel="noopener">Register your restaurant</a>. Approve to create a new restaurant or link to an existing one. The applicant is emailed an owner invitation automatically.</p>
        <div class="segmented" role="group" aria-label="Filter applications">${[['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([v, l]) => `<button type="button" data-status="${v}" aria-pressed="${v === status}">${l}</button>`).join('')}</div>
      </div>
      <div class="stack">${items.length ? items.map((q) => `
        <article class="card card-pad">
          <div class="row"><h2 style="font-size:1.05rem;margin:0">${esc(q.restaurant_name)}</h2><span class="badge ${BADGE[q.status]}">${cap(q.status)}</span>
            ${q.category_name ? `<span class="badge badge-accent plain">${esc(q.category_name)}</span>` : ''}<span class="spacer"></span><span class="small muted">Submitted ${fmtDateTime(q.created_at)}</span></div>
          ${q.status === 'pending' && q.duplicate_restaurant_id ? `<div class="notice notice-warning" style="margin-top:12px">${icon('alert')}<div>A restaurant with this name already exists on UniBite. To avoid a duplicate, use <strong>Link to existing restaurant</strong>. <a href="#restaurants/${q.duplicate_restaurant_id}">View it</a></div></div>` : ''}
          <p style="margin:8px 0">${esc(q.description)}</p>
          ${q.additional_info ? `<p class="small muted" style="margin:0 0 8px"><strong>Additional information:</strong> ${esc(q.additional_info)}</p>` : ''}
          <dl class="detail-grid">
            <div><dt>Owner</dt><dd>${esc(q.contact_name)}</dd></div>
            <div><dt>Email</dt><dd><a href="mailto:${esc(q.email)}">${esc(q.email)}</a></dd></div>
            <div><dt>Phone</dt><dd>${esc(q.phone)}</dd></div>
            <div><dt>Campus location</dt><dd>${esc(q.campus_location)}</dd></div>
          </dl>
          ${q.status === 'pending' ? `<div class="row" style="margin-top:16px;justify-content:flex-end">
              <button class="btn btn-secondary btn-sm" data-reject="${q.id}">${icon('x', 'icon-sm')}Reject</button>
              <button class="btn btn-secondary btn-sm" data-link="${q.id}">${icon('store', 'icon-sm')}Link to existing restaurant</button>
              <a class="btn btn-success btn-sm" href="#restaurants/new?request=${q.id}">${icon('check', 'icon-sm')}Approve &amp; create restaurant</a></div>`
            : `<p class="small muted" style="margin:12px 0 0">${cap(q.status)} by ${esc(q.reviewed_by_name || 'admin')} on ${fmtDateTime(q.reviewed_at)}${q.admin_note ? ` · "${esc(q.admin_note)}"` : ''}${q.restaurant_id ? ` · <a href="#restaurants/${q.restaurant_id}">${esc(q.linked_restaurant_name || 'View restaurant')}</a>` : ''}</p>`}
        </article>`).join('') : `<div class="card">${emptyState('inbox', 'No applications', 'New restaurant applications will appear here.')}</div>`}</div>`;

    const find = (id) => items.find((x) => x.id === Number(id));
    $$('[data-status]').forEach((b) => b.addEventListener('click', () => { location.hash = `requests${b.dataset.status ? `?status=${b.dataset.status}` : ''}`; }));
    $$('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
      const q = find(b.dataset.reject);
      const res = await confirmDialog({ title: 'Reject application?', message: `The application for <strong>${esc(q.restaurant_name)}</strong> will be marked Rejected and <strong>${esc(q.email)}</strong> will be notified by email. No restaurant access is granted.`, confirmText: 'Reject application', danger: true, withReason: true });
      if (!res) return;
      try { await api(`/admin/requests/${q.id}/reject`, { method: 'POST', body: { note: res.reason } }); toast('Application rejected and applicant notified'); refreshCounts(); renderRequests(params); }
      catch (err) { toast(err.message, 'error'); }
    }));
    $$('[data-link]').forEach((b) => b.addEventListener('click', () => linkExisting(find(b.dataset.link), () => renderRequests(params))));
  } catch (err) { mainError(err); }
}

async function linkExisting(q, after) {
  const { items } = await api('/admin/restaurants?pageSize=100&sort=name_asc');
  const m = openModal({
    title: 'Link to existing restaurant',
    body: `<p class="small">Approve <strong>${esc(q.restaurant_name)}</strong> by associating it with a restaurant that already exists. <strong>${esc(q.email)}</strong> will receive an owner invitation for the selected restaurant.</p>
      <form id="link-form" class="stack" novalidate>
        <div class="field"><label for="link-r">Restaurant <span class="req">*</span></label>
          <select id="link-r" name="restaurant_id" class="select"><option value="">Choose…</option>${items.map((r) => `<option value="${r.id}" ${r.id === q.duplicate_restaurant_id ? 'selected' : ''} data-owner="${r.account_status === 'active' || r.account_status === 'deactivated'}">${esc(r.name)}${r.owner_email ? ` (owner: ${esc(r.owner_email)})` : ''}${r.is_active ? '' : ' · deactivated'}</option>`).join('')}</select></div>
        <label class="row small hidden" id="link-replace" style="align-items:flex-start;flex-wrap:nowrap"><input type="checkbox" name="replace_owner" value="true" style="margin-top:3px"><span>This restaurant already has an owner. Replace them with the applicant once the invitation is accepted.</span></label>
      </form>`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-success" id="link-save" data-busy="Approving…">Approve &amp; send invitation</button>',
  });
  const f = m.el.querySelector('#link-form');
  const sync = () => m.el.querySelector('#link-replace').classList.toggle('hidden', f.restaurant_id.selectedOptions[0]?.dataset.owner !== 'true');
  f.restaurant_id.addEventListener('change', sync); sync();
  const save = m.el.querySelector('#link-save');
  save.addEventListener('click', () => withBusy(save, async () => {
    try {
      await api(`/admin/requests/${q.id}/approve-link`, { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      m.close(); toast('Application approved and invitation sent'); refreshCounts(); after();
    } catch (err) { showErrors(f, err); }
  }));
}
