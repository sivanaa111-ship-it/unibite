import { icon, CATEGORY_ICONS } from '../icons.js';
import { esc, fmtDate, toast, confirmDialog, openModal, showErrors, withBusy, emptyState, $$ } from '../ui.js';
import { ctx, setTitle, mainError } from './main.js';
import { adminApi as api } from './main.js';

export async function renderCategories() {
  setTitle('Manage Categories');
  try {
    const { items } = await api('/admin/categories');
    ctx.main.innerHTML = `
      <div class="row" style="margin-bottom:16px"><p class="muted small" style="margin:0">Categories group outlets on the public site (e.g. Café, Food Truck). A category can only be deactivated when no active restaurant uses it.</p>
        <span class="spacer"></span><button class="btn btn-primary" id="add-cat">${icon('plus')}Add category</button></div>
      <div class="card"><div class="table-wrap">${items.length ? `<table class="table">
        <thead><tr><th>Icon</th><th>Name</th><th>Description</th><th>Restaurants</th><th>Status</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${items.map((c) => `<tr class="${c.is_active ? '' : 'inactive'}">
          <td><span class="kpi-icon tint-red" style="width:38px;height:38px;border-radius:10px;display:grid;place-items:center">${icon(c.icon)}</span></td>
          <td class="name-cell">${esc(c.name)}</td><td class="small muted">${esc(c.description || '—')}</td>
          <td>${c.active_restaurants} active <span class="muted small">/ ${c.total_restaurants} total</span></td>
          <td>${c.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
          <td class="small">${fmtDate(c.created_at)}</td>
          <td><div class="actions">
            <button class="icon-btn" data-edit="${c.id}" aria-label="Edit ${esc(c.name)}">${icon('edit')}</button>
            ${c.is_active ? `<button class="icon-btn" style="color:var(--color-danger)" data-off="${c.id}" aria-label="Deactivate ${esc(c.name)}">${icon('power')}</button>`
              : `<button class="icon-btn" style="color:var(--color-success)" data-on="${c.id}" aria-label="Reactivate ${esc(c.name)}">${icon('rotate')}</button>`}
          </div></td></tr>`).join('')}</tbody></table>` : emptyState('tag', 'No categories yet')}</div></div>`;

    ctx.main.querySelector('#add-cat').addEventListener('click', () => form());
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => form(items.find((c) => c.id === Number(b.dataset.edit)))));
    $$('[data-off]').forEach((b) => b.addEventListener('click', async () => {
      const c = items.find((x) => x.id === Number(b.dataset.off));
      const ok = await confirmDialog({ title: 'Deactivate category?', message: `<strong>${esc(c.name)}</strong> will no longer be offered on the public site or in the restaurant form.`, confirmText: 'Deactivate', danger: true });
      if (!ok) return;
      try { await api(`/admin/categories/${c.id}/deactivate`, { method: 'POST' }); toast('Category deactivated'); renderCategories(); }
      catch (err) { toast(err.message, 'error'); }
    }));
    $$('[data-on]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/admin/categories/${b.dataset.on}/reactivate`, { method: 'POST' }); toast('Category reactivated'); renderCategories(); }
      catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) { mainError(err); }
}

function form(c = null) {
  const m = openModal({
    title: c ? 'Edit category' : 'Add category',
    body: `<form id="cat-form" class="stack" novalidate>
      <div class="field"><label for="cat-name">Name <span class="req">*</span></label><input id="cat-name" name="name" class="input" maxlength="60" value="${esc(c?.name || '')}" required></div>
      <div class="field"><label for="cat-desc">Description</label><input id="cat-desc" name="description" class="input" maxlength="300" value="${esc(c?.description || '')}"></div>
      <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:6px">Icon</legend>
        <div class="day-picker">${CATEGORY_ICONS.map((i) => `<label title="${i}"><input type="radio" name="icon" value="${i}" ${(c?.icon || 'utensils') === i ? 'checked' : ''}><span>${icon(i)}<span class="sr-only">${i}</span></span></label>`).join('')}</div></fieldset>
    </form>`,
    footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="cat-save" data-busy="Saving…">${c ? 'Save changes' : 'Add category'}</button>`,
  });
  const f = m.el.querySelector('#cat-form');
  const save = m.el.querySelector('#cat-save');
  const submit = () => withBusy(save, async () => {
    try {
      await api(c ? `/admin/categories/${c.id}` : '/admin/categories', { method: c ? 'PUT' : 'POST', body: Object.fromEntries(new FormData(f)) });
      m.close(); toast(c ? 'Category updated' : 'Category added'); renderCategories();
    } catch (err) { showErrors(f, err); }
  });
  save.addEventListener('click', submit);
  f.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}
