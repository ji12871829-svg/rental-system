// maintenance.js — new-request form + status tabs + inline status changes.
// The client validates allowed transitions BEFORE calling the API (the server
// enforces the same state machine authoritatively — utils/transitions.js).
(function () {
  requireAuth();
  markActiveNav('maintenance');
  document.getElementById('logout-link').addEventListener('click', handleLogout);

  const tbody = document.getElementById('requests-body');
  const paginationEl = document.getElementById('pagination');
  const tabs = document.querySelectorAll('#status-tabs button');
  const formCard = document.getElementById('request-form-card');
  const unitSelect = document.getElementById('unit-select');

  let currentStatus = '';
  let state = { page: 1, totalPages: 1 };

  // Mirror of the server's state machine (utils/transitions.js) — if these
  // drift, the server still rejects illegal transitions; the client copy is
  // purely a UX shortcut with the validation call as the authoritative check.
  const TRANSITIONS = {
    open: ['in_progress', 'cancelled'],
    in_progress: ['resolved', 'cancelled'],
    resolved: [],
    cancelled: [],
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    currentStatus = tab.dataset.status;
    state.page = 1;
    load();
  }));

  async function load() {
    try {
      const statusQ = currentStatus ? `&status=${currentStatus}` : '';
      const data = await api.get(`/maintenance?page=${state.page}&limit=50${statusQ}`);
      state.totalPages = data.pagination.totalPages;
      render(data.data);
      paginationEl.innerHTML = `
        <span class="muted">Page ${state.page} of ${Math.max(state.totalPages, 1)} · ${data.pagination.total} requests</span>
        <button class="btn btn-secondary btn-sm" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <button class="btn btn-secondary btn-sm" id="next-page" ${state.page >= state.totalPages ? 'disabled' : ''}>Next →</button>`;
      document.getElementById('prev-page').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
      document.getElementById('next-page').addEventListener('click', () => { if (state.page < state.totalPages) { state.page++; load(); } });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function render(requests) {
    if (requests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No maintenance requests.</td></tr>';
      return;
    }
    tbody.innerHTML = requests.map((m) => `
      <tr>
        <td>${escapeHtml(m.unitNumber)}</td>
        <td>${escapeHtml(m.description)}</td>
        <td><span class="badge ${m.priority}">${m.priority}</span></td>
        <td><span class="badge ${m.status}">${m.status.replace('_', ' ')}</span></td>
        <td>${escapeHtml(m.assignedVendor || '—')}</td>
        <td>${m.cost !== null ? formatMoney(m.cost) : '—'}</td>
        <td>${m.status === 'resolved' || m.status === 'cancelled'
          ? `<span class="muted">${m.resolvedAt ? `Resolved ${new Date(m.resolvedAt).toLocaleDateString()}` : 'Closed'}</span>`
          : `<select class="status-select" data-id="${m.id}" data-status="${m.status}">
              <option value="">Change…</option>
              ${(TRANSITIONS[m.status] || []).map((s) => `<option value="${s}">${s.replace('_', ' ')}</option>`).join('')}
            </select>`}</td>
      </tr>`).join('');

    tbody.querySelectorAll('.status-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const target = sel.value;
        sel.value = '';
        if (!target) return;
        try {
          const updated = await api.patch(`/maintenance/${sel.dataset.id}`, { status: target });
          showToast(`Status changed to ${updated.status}.`, 'success');
          load();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  // ---- New request form (toggle) ----
  document.getElementById('new-request-btn').addEventListener('click', async () => {
    formCard.classList.toggle('hidden');
    if (formCard.classList.contains('hidden')) return;
    try {
      const units = await api.get('/units?limit=100');
      unitSelect.innerHTML = units.data.map((u) =>
        `<option value="${u.id}">Unit ${escapeHtml(u.unitNumber)} (${u.status})</option>`).join('');
    } catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('cancel-request').addEventListener('click', () => {
    formCard.classList.add('hidden');
    document.getElementById('request-form').reset();
  });
  document.getElementById('request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/maintenance', formToObject(e.target));
      e.target.reset();
      formCard.classList.add('hidden');
      showToast('Request submitted.', 'success');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  });

  load();
})();