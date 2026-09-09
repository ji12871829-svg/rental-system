// tenants.js — list/filter (including archived toggle), create + edit modals,
// archive-with-confirmation (never delete from the UI). See build prompt §11.4.
(function () {
  requireAuth();
  markActiveNav('tenants');
  document.getElementById('logout-link').addEventListener('click', handleLogout);

  const tbody = document.getElementById('tenants-body');
  const paginationEl = document.getElementById('pagination');
  const searchEl = document.getElementById('search');
  const includeArchivedEl = document.getElementById('include-archived');

  let state = { page: 1, totalPages: 1, rows: [] };

  async function load() {
    const incl = includeArchivedEl.checked ? '&includeArchived=true' : '';
    try {
      const data = await api.get(`/tenants?page=${state.page}&limit=50${incl}`);
      state.rows = data.data;
      state.totalPages = data.pagination.totalPages;
      render();
      paginationEl.innerHTML = `
        <span class="muted">Page ${state.page} of ${Math.max(state.totalPages, 1)} · ${data.pagination.total} tenants</span>
        <button class="btn btn-secondary btn-sm" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <button class="btn btn-secondary btn-sm" id="next-page" ${state.page >= state.totalPages ? 'disabled' : ''}>Next →</button>`;
      document.getElementById('prev-page').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
      document.getElementById('next-page').addEventListener('click', () => { if (state.page < state.totalPages) { state.page++; load(); } });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function render() {
    const q = searchEl.value.trim().toLowerCase();
    let rows = state.rows;
    if (q) rows = rows.filter((t) => `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) || (t.email || '').toLowerCase().includes(q));

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No tenants found.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((t) => `
      <tr>
        <td>${escapeHtml(`${t.firstName} ${t.lastName}`)}</td>
        <td>${escapeHtml(t.email)}</td>
        <td>${escapeHtml(t.phone)}</td>
        <td>${escapeHtml(t.nationalId || '—')}</td>
        <td>${t.isArchived ? '<span class="badge cancelled">archived</span>' : '<span class="badge active">active</span>'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-edit="${t.id}">Edit</button>
          ${t.isArchived ? '' : `<button class="btn btn-danger btn-sm" data-archive="${t.id}">Archive</button>`}
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditModal(Number(b.dataset.edit))));
    tbody.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', () => confirmArchive(Number(b.dataset.archive))));
  }

  function tenantFormHtml(t = {}) {
    return `
      <form id="tenant-form" class="form-grid">
        <div class="form-group"><label>First name *</label><input name="firstName" value="${escapeHtml(t.firstName || '')}" required /></div>
        <div class="form-group"><label>Last name *</label><input name="lastName" value="${escapeHtml(t.lastName || '')}" required /></div>
        <div class="form-group"><label>Email *</label><input type="email" name="email" value="${escapeHtml(t.email || '')}" required /></div>
        <div class="form-group"><label>Phone *</label><input name="phone" value="${escapeHtml(t.phone || '')}" required /></div>
        <div class="form-group"><label>National ID</label><input name="nationalId" value="${escapeHtml(t.nationalId || '')}" /></div>
        <div class="form-group"><label>Emergency contact name</label><input name="emergencyContactName" value="${escapeHtml(t.emergencyContactName || '')}" /></div>
        <div class="form-group full"><label>Emergency contact phone</label><input name="emergencyContactPhone" value="${escapeHtml(t.emergencyContactPhone || '')}" /></div>
        <div class="form-actions full">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn">Save Tenant</button>
        </div>
      </form>`;
  }

  document.getElementById('add-tenant-btn').addEventListener('click', () => {
    const backdrop = openModal(`<h2>Add Tenant</h2><button class="modal-close" data-close>×</button>${tenantFormHtml()}`);
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/tenants', formToObject(e.target));
        closeModal(backdrop);
        await load();
        showToast('Tenant added.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  async function openEditModal(id) {
    const backdrop = openModal('<div class="empty-state">Loading…</div>');
    let tenant;
    try {
      tenant = await api.get(`/tenants/${id}`);
    } catch (err) { showToast(err.message, 'error'); closeModal(backdrop); return; }
    backdrop.innerHTML = `<div class="modal"><h2>Edit ${escapeHtml(`${tenant.firstName} ${tenant.lastName}`)}</h2>
      <button class="modal-close" data-close>×</button>${tenantFormHtml(tenant)}</div>`;
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.patch(`/tenants/${id}`, formToObject(e.target));
        closeModal(backdrop);
        await load();
        showToast('Tenant updated.', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  // Archive instead of delete, with a confirmation dialog that explains the
  // tenant will be hidden from active lists (build prompt §11.4).
  function confirmArchive(id) {
    const backdrop = openModal(`<div class="modal">
      <h2>Archive tenant?</h2>
      <p>Archiving hides this tenant from default lists. Their lease and payment history is kept.</p>
      <p class="muted">Note: tenants with an active lease cannot be archived — end the lease first.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
        <button type="button" class="btn btn-danger" id="confirm-archive">Archive Tenant</button>
      </div>
    </div>`);
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
    backdrop.querySelector('#confirm-archive').addEventListener('click', async () => {
      try {
        await api.patch(`/tenants/${id}/archive`);
        closeModal(backdrop);
        await load();
        showToast('Tenant archived.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  searchEl.addEventListener('input', render);
  includeArchivedEl.addEventListener('change', () => { state.page = 1; load(); });

  load();
})();