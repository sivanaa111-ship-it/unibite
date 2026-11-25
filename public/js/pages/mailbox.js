// Development-only viewer for emails written to the outbox (no SMTP configured).
import { api } from '../api.js';
import { mountChrome, esc, fmtDateTime, emptyState, $ } from '../ui.js';
import { hydrateIcons } from '../components.js';

hydrateIcons();
mountChrome();
const to = new URLSearchParams(location.search).get('to') || '';
$('#to').value = to;
$('#mb-filter').addEventListener('submit', (e) => { e.preventDefault(); location.search = $('#to').value ? `?to=${encodeURIComponent($('#to').value)}` : ''; });

api(`/dev/outbox${to ? `?to=${encodeURIComponent(to)}` : ''}`).then(({ items }) => {
  $('#list').innerHTML = items.length ? items.map((m) => {
    const url = (m.text_body.match(/https?:\/\/\S+/) || [])[0];
    return `<article class="card card-pad">
      <div class="row"><strong>${esc(m.subject)}</strong><span class="spacer"></span><span class="small muted">${fmtDateTime(m.created_at)}</span></div>
      <div class="small muted">To: ${esc(m.to_email)}</div>
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:.9rem;margin:12px 0">${esc(m.text_body)}</pre>
      ${url ? `<a class="btn btn-primary btn-sm" href="${esc(url)}">Open link</a>` : ''}
    </article>`;
  }).join('') : emptyState('mail', 'No emails yet');
}).catch((err) => { $('#list').innerHTML = emptyState('alert', 'Mailbox unavailable', err.message); });
