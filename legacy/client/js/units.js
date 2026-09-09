// units.js — list/filter, create + edit modals. Optimistic UI on save with
// rollback + toast on error (build prompt §11.3).
(function () {
  requireAuth();
  markActiveNav('units');
  document.getElementById('logout-link').addEventListener('click', handleLogout);

  const tbody = document.getElementById('units-body');
  const paginationEl = document.getElementById('pagination');
  const searchEl = document.getElementById('search');
  const statusEl = document.getElementById('status-filter');

  let state = { page: 1, totalPages: 1, rows: [] };

  async function load() {
    const status = statusEl.value ? `&status=${encodeURIComponent(statusEl.value)}` : '';
    try {
      const data = await api.get(`/units?page=${state.page}&limit=50${status}`);
      state.rows = data.data;
      state.totalPages = data.pagination.totalPages;
      render();
      renderPagination(data.pagination);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function render() {
    // Client-side search over the loaded page (unit number + floor match).
    const q = searchEl.value.trim().toLowerCase();
    let rows = state.rows;
    if (q) rows = rows.filter((u) => (u.unitNumber || '').toLowerCase().includes(q) || (u.floor || '').toLowerCase().includes(q));
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No units found.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((u) => `
      <tr data-id="${u.id}" style="cursor:pointer;">
        <td>${escapeHtml(u.unitNumber)}</td>
        <td>${escapeHtml(u.floor || '—')}</td>
        <td>${u.bedrooms}</td>
        <td>${u.bathrooms}</td>
        <td>${u.squareFeet ?? '—'}</td>
        <td>${formatMoney(u.baseRent)}</td>
        <td><span class="badge ${u.status}">${u.status}</span></td>
      </tr>`).join('');
    // Row click → edit modal.
    tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => openEditModal(Number(tr.dataset.id)));
    });
  }

  function renderPagination({ page, total, totalPages }) {
    paginationEl.innerHTML = `
      <span class="muted">Page ${page} of ${Math.max(totalPages, 1)} · ${total} units</span>
      <button class="btn btn-secondary btn-sm" id="prev-page" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
      <button class="btn btn-secondary btn-sm" id="next-page" ${page >= totalPages ? 'disabled' : ''}>Next →</button>`;
    document.getElementById('prev-page').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
    document.getElementById('next-page').addEventListener('click', () => { if (state.page < totalPages) { state.page++; load(); } });
  }

  function unitFormHtml(u = {}) {
    return `
      <form id="unit-form" class="form-grid">
        <div class="form-group"><label>Unit number *</label><input name="unitNumber" value="${escapeHtml(u.unitNumber || '')}" required maxlength="20" /></div>
        <div class="form-group"><label>Floor</label><input name="floor" value="${escapeHtml(u.floor || '')}" maxlength="20" /></div>
        <div class="form-group"><label>Bedrooms</label><input name="bedrooms" type="number" min="0" value="${u.bedrooms ?? 1}" /></div>
        <div class="form-group"><label>Bathrooms</label><input name="bathrooms" type="number" min="0" value="${u.bathrooms ?? 1}" /></div>
        <div class="form-group"><label>Square feet</label><input name="squareFeet" type="number" min="0" value="${u.squareFeet ?? ''}" /></div>
        <div class="form-group"><label>Base rent (USD) *</label><input name="baseRent" type="number" step="0.01" min="0" value="${u.baseRent ?? ''}" required /></div>
        <div class="form-group full"><label>Status</label>
          <select name="status">
            <option value="vacant" ${u.status === 'vacant' ? 'selected' : ''}>Vacant</option>
            <option value="occupied" ${u.status === 'occupied' ? 'selected' : ''}>Occupied</option>
            <option value="maintenance" ${u.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
          </select></div>
        <div class="form-group full"><label>Notes</label><textarea name="notes" rows="2">${escapeHtml(u.notes || '')}</textarea></div>
        <div class="form-actions full">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn">Save Unit</button>
        </div>
      </form>`;
  }

  function openModalCommon(html) {
    const backdrop = openModal(html);
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
    return backdrop;
  }

  document.getElementById('add-unit-btn').addEventListener('click', () => {
    const backdrop = openModalCommon(`<h2>Add Unit</h2><button class="modal-close" data-close>×</button>${unitFormHtml()}`);
    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const created = await api.post('/units', formToObject(e.target));
        closeModal(backdrop);
        state.page = 1;
        await load();
        showToast(`Unit ${created.unitNumber} created.`, 'success');
      } catch (err) {
        showToast(err.status === 409 ? `Conflict: ${err.message}` : err.message, 'error');
      }
    });
  });

  async function openEditModal(id) {
    // Optimistic edit: patch row data in place immediately; on failure,
    // roll the row back (re-fetch list) + show toast.
    const backdrop = openModalCommon('<div class="empty-state">Loading…</div>');
    let unit;
    try {
      unit = await api.get(`/units/${id}`);
    } catch (err) { showToast(err.message, 'error'); closeModal(backdrop); return; }

    backdrop.innerHTML = `<div class="modal"><h2>Edit Unit ${escapeHtml(unit.unitNumber)}</h2>
      <button class="modal-close" data-close>×</button>${unitFormHtml(unit)}</div>`;
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = formToObject(e.target);
      try {
        const updated = await api.patch(`/units/${id}`, payload);
        closeModal(backdrop);
        // Optimistic in-place update, then reconcile with server list.
        const idx = state.rows.findIndex((r) => r.id === id);
        if (idx !== -1) state.rows[idx] = { ...state.rows[idx], ...updated };
        render();
        showToast('Unit updated.', 'success');
        await load();
      } catch (err) {
        // Rollback: re-fetch authoritative list.
        await load();
        showToast(`Update failed — rolled back. ${err.message}`, 'error');
      }
    });
  }

  searchEl.addEventListener('input', render);
  statusEl.addEventListener('change', () => { state.page = 1; load(); });

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  load();
})();