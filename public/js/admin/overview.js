import { icon } from '../icons.js';
import { esc, money, timeAgo, fmtDateTime, emptyState, restaurantImg } from '../ui.js';
import { pagerHtml } from '../components.js';
import { ctx, setTitle, mainError, adminApi as api } from './main.js';

const ACTION_LABEL = {
  'restaurant.create': ['Added restaurant', 'tint-green', 'plusCircle'],
  'restaurant.update': ['Edited restaurant', 'tint-blue', 'edit'],
  'restaurant.publish': ['Published restaurant', 'tint-green', 'eye'],
  'restaurant.unpublish': ['Unpublished restaurant', 'tint-amber', 'eye'],
  'restaurant.deactivate': ['Deactivated restaurant', 'tint-red', 'power'],
  'restaurant.reactivate': ['Reactivated restaurant', 'tint-green', 'rotate'],
  'category.create': ['Created category', 'tint-green', 'tag'],
  'category.update': ['Edited category', 'tint-blue', 'tag'],
  'category.deactivate': ['Deactivated category', 'tint-red', 'tag'],
  'category.reactivate': ['Reactivated category', 'tint-green', 'tag'],
  'invitation.send': ['Invited restaurant owner', 'tint-blue', 'mail'],
  'invitation.resend': ['Resent invitation', 'tint-blue', 'mail'],
  'invitation.revoke': ['Revoked invitation', 'tint-red', 'mail'],
  'invitation.accept': ['Owner activated account', 'tint-green', 'key'],
  'account.deactivate': ['Deactivated account', 'tint-red', 'user'],
  'account.reactivate': ['Reactivated account', 'tint-green', 'user'],
  'account.activate': ['Activated account', 'tint-green', 'user'],
  'account.reassign': ['Reassigned owner', 'tint-amber', 'user'],
  'account.unassign': ['Unassigned owner', 'tint-amber', 'user'],
  'account.reset_access': ['Reset account access', 'tint-amber', 'key'],
  'student.verify_id': ['Verified University ID', 'tint-green', 'check'],
  'request.approve': ['Approved application', 'tint-green', 'inbox'],
  'request.reject': ['Rejected application', 'tint-red', 'inbox'],
  'admin.login': ['Admin signed in', 'tint-slate', 'shield'],
  'admin.provision': ['Admin provisioned', 'tint-slate', 'shield'],
  'security.2fa_enable': ['Enabled 2FA', 'tint-green', 'shield'],
  'security.2fa_disable': ['Disabled 2FA', 'tint-red', 'shield'],
  'system.seed': ['Loaded demo data', 'tint-slate', 'settings'],
};

const fmtVal = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function describe(a) {
  let d = {};
  try { d = JSON.parse(a.details || '{}'); } catch { /* ignore */ }
  const subject = d.name || d.restaurant_name || d.email || d.restaurant || (a.entity_id ? `${a.entity_type} #${a.entity_id}` : '');
  const parts = [];
  if (d.reason) parts.push(`Reason: ${d.reason}`);
  if (d.note) parts.push(`Note: ${d.note}`);
  if (d.open_orders) parts.push(`${d.open_orders} open order(s) kept for completion`);
  if (d.mode === 'linked_existing') parts.push('Linked to existing restaurant');
  if (d.mode === 'new_restaurant') parts.push('Created new restaurant');
  if (d.email && subject !== d.email) parts.push(d.email);
  return { subject, extra: parts.join(' · '), meta: ACTION_LABEL[a.action] || [a.action, 'tint-slate', 'info'] };
}

/** "field: old → new" lines from before/after snapshots. */
export function diffHtml(a) {
  let before = {}; let after = {};
  try { before = JSON.parse(a.before_data || '{}'); after = JSON.parse(a.after_data || '{}'); } catch { /* ignore */ }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (!keys.length) return '';
  return `<ul class="small" style="margin:0;padding-left:16px">${keys.map((k) => `<li><strong>${esc(k.replace(/_/g, ' '))}</strong>: ${a.before_data ? `<span class="muted" style="text-decoration:line-through">${esc(fmtVal(before[k]))}</span> → ` : ''}${esc(fmtVal(after[k]))}</li>`).join('')}</ul>`;
}

export async function renderOverview() {
  setTitle('Overview');
  try {
    const d = await api('/admin/overview');
    const s = d.stats;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 864e5);
      const key = dt.toISOString().slice(0, 10);
      days.push({ label: dt.toLocaleDateString(undefined, { weekday: 'short' }), value: d.orders_by_day.find((x) => x.day === key)?.orders || 0 });
    }
    const max = Math.max(...days.map((x) => x.value), 1);
    ctx.main.innerHTML = `
      <div class="kpi-grid">
        ${kpi('store', 'tint-red', s.total_restaurants, 'Total restaurants', s.draft_restaurants ? `${s.draft_restaurants} unpublished draft(s)` : '')}
        ${kpi('check', 'tint-green', s.active_restaurants, 'Active restaurants', '<a href="#restaurants?status=active">View</a>')}
        ${kpi('power', 'tint-slate', s.inactive_restaurants, 'Inactive restaurants', '<a href="#restaurants?status=inactive">View</a>')}
        ${kpi('users', 'tint-blue', s.students, 'Registered students', s.pending_students ? `${s.pending_students} awaiting email verification` : '<a href="#students">Manage</a>')}
        ${kpi('key', 'tint-amber', s.restaurant_accounts, 'Restaurant accounts', s.pending_invitations ? `${s.pending_invitations} pending invitation(s)` : '<a href="#accounts">Manage</a>')}
        ${kpi('inbox', 'tint-amber', s.pending_requests, 'Pending applications', s.pending_requests ? '<a href="#requests?status=pending">Review now</a>' : 'All caught up')}
        ${kpi('receipt', 'tint-blue', s.total_orders, 'Total platform orders', `${s.orders_today} today · ${s.active_orders} in progress`)}
        ${kpi('chart', 'tint-green', money(s.revenue_7d), 'Completed revenue · 7 days')}
      </div>
      <div class="grid-2">
        <section class="card" aria-labelledby="chart-title">
          <div class="card-head"><h2 id="chart-title">Orders · last 7 days</h2></div>
          <div class="bar-chart" role="img" aria-label="Orders per day: ${days.map((x) => `${x.label} ${x.value}`).join(', ')}">
            ${days.map((x) => `<div class="bar-col" title="${x.value} orders"><span class="bar-val">${x.value}</span><div class="bar" style="height:${(x.value / max) * 100}%"></div><span class="bar-lbl">${x.label}</span></div>`).join('')}
          </div>
        </section>
        <section class="card" aria-labelledby="top-title">
          <div class="card-head"><h2 id="top-title">Busiest outlets · 30 days</h2><a href="#restaurants" class="small">View all</a></div>
          <ul class="list-plain" style="margin-top:8px">${d.top_restaurants.map((r) => `
            <li><div class="thumb" style="width:36px;height:36px;border-radius:8px;overflow:hidden;flex:none">${restaurantImg(r, 'logo')}</div>
              <a href="#restaurants/${r.id}" class="name-cell" style="flex:1">${esc(r.name)}</a>
              ${r.is_active ? '' : '<span class="badge badge-neutral">Inactive</span>'}<strong>${r.orders}</strong><span class="muted small">orders</span></li>`).join('')}</ul>
        </section>
      </div>
      <section class="card" style="margin-top:16px" aria-labelledby="act-title">
        <div class="card-head"><h2 id="act-title">Recent administrative activity</h2><a href="#audit" class="small">Full audit log</a></div>
        <ul class="list-plain" style="margin-top:8px">${d.recent_activity.length ? d.recent_activity.map(activityRow).join('') : `<li>${emptyState('shield', 'No activity yet')}</li>`}</ul>
      </section>`;
  } catch (err) { mainError(err); }
}

const kpi = (ic, tint, value, label, sub = '') => `
  <div class="card kpi"><span class="kpi-icon ${tint}">${icon(ic)}</span>
    <div><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div>${sub ? `<div class="small muted" style="margin-top:2px">${sub}</div>` : ''}</div></div>`;

function activityRow(a) {
  const { subject, extra, meta } = describe(a);
  return `<li><span class="kpi-icon ${meta[1]}" style="width:34px;height:34px;border-radius:8px;display:grid;place-items:center;flex:none">${icon(meta[2], 'icon-sm')}</span>
    <div style="flex:1;min-width:0"><strong>${esc(meta[0])}</strong> ${esc(subject)}<div class="muted small">${esc(a.admin_name || 'System')}${extra ? ` · ${esc(extra)}` : ''}</div></div>
    <span class="muted small" title="${esc(fmtDateTime(a.created_at))}">${timeAgo(a.created_at)}</span></li>`;
}

export async function renderAudit(params) {
  setTitle('Audit Log');
  const page = Number(params.get('page')) || 1;
  const entity = params.get('entity') || '';
  try {
    const d = await api(`/admin/audit-logs?page=${page}${entity ? `&entity=${entity}` : ''}`);
    ctx.main.innerHTML = `
      <div class="card">
        <div class="toolbar"><p class="muted small" style="margin:0;flex:1">Every administrative change is recorded with who made it, when, what changed and from which IP address. The log is append-only: no one can edit or delete entries.</p>
          <label class="sr-only" for="audit-entity">Filter by type</label>
          <select id="audit-entity" class="select">${[['', 'All types'], ['restaurant', 'Restaurants'], ['category', 'Categories'], ['user', 'Accounts'], ['restaurant_request', 'Applications']].map(([v, l]) => `<option value="${v}" ${v === entity ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>When</th><th>Administrator</th><th>Action</th><th>Target</th><th>Details</th><th>Previous → updated</th><th>IP</th></tr></thead>
          <tbody>${d.items.map((a) => { const x = describe(a); return `<tr>
            <td class="small" style="white-space:nowrap">${fmtDateTime(a.created_at)}</td><td>${esc(a.admin_name || (a.action === 'invitation.accept' ? 'Restaurant owner' : 'System'))}</td>
            <td><span class="badge ${x.meta[1].replace('tint-', 'badge-').replace('red', 'danger').replace('green', 'success').replace('blue', 'info').replace('amber', 'warning').replace('slate', 'neutral')}">${esc(x.meta[0])}</span></td>
            <td class="name-cell">${esc(x.subject)}</td><td class="small muted">${esc(x.extra)}</td><td>${diffHtml(a)}</td><td class="small muted">${esc(a.ip_address || '')}</td></tr>`; }).join('')}</tbody>
        </table></div>
        <nav class="pager" aria-label="Pagination">${pagerHtml(d, 'entries')}</nav>
      </div>`;
    ctx.main.querySelector('#audit-entity').addEventListener('change', (e) => { location.hash = `audit?entity=${e.target.value}`; });
    ctx.main.querySelector('.pager').addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
      location.hash = `audit?page=${b.dataset.page}${entity ? `&entity=${entity}` : ''}`;
    });
  } catch (err) { mainError(err); }
}
