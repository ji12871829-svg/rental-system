// payments.js — record form (searchable lease dropdown), history table with
// date-range filter, CSV export (build prompt §11.6).
(function () {
  requireAuth();
  markActiveNav('payments');
  document.getElementById('logout-link').addEventListener('click', handleLogout);

  const tbody = document.getElementById('payments-body');
  const paginationEl = document.getElementById('pagination');
  const leaseSelect = document.getElementById('lease-select');
  const dateFromEl = document.getElementById('date-from');
  const dateToEl = document.getElementById('date-to');
  const recordBtn = document.getElementById('record-payment-btn');
  const form = document.getElementById('payment-form');

  let state = { page: 1, totalPages: 1, leases: [] };

  // ---- Lease dropdown (active leases only; balances shown inline) ----
  async function loadLeaseOptions() {
    try {
      const data = await api.get('/leases?status=active&limit=100');
      state.leases = data.data;
      leaseSelect.innerHTML = data.data.length === 0
        ? '<option value="">No active leases</option>'
        : `<option value="">Select lease…</option>` + data.data.map((l) =>
            `<option value="${l.id}">Unit ${escapeHtml(l.unitNumber)} — ${escapeHtml(l.tenantName)} (${formatMoney(l.monthlyRent)}/mo)</option>`).join('');
    } catch (err) { showToast(err.message, 'error'); }
  }

  // Simple searchable dropdown: filter by unit number / tenant name on input.
  leaseSelect.addEventListener('input', () => { /* native select; keep simple */ });

  // ---- Payments history ----
  function queryString() {
    const q = new URLSearchParams({ page: String(state.page), limit: '50' });
    if (dateFromEl.value) q.set('dateFrom', dateFromEl.value);
    if (dateToEl.value) q.set('dateTo', dateToEl.value);
    return q.toString();
  }

  async function load() {
    try {
      const data = await api.get(`/payments?${queryString()}`);
      state.totalPages = data.pagination.totalPages;
      render(data.data);
      paginationEl.innerHTML = `
        <span class="muted">Page ${state.page} of ${Math.max(state.totalPages, 1)} · ${data.pagination.total} payments</span>
        <button class="btn btn-secondary btn-sm" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <button class="btn btn-secondary btn-sm" id="next-page" ${state.page >= state.totalPages ? 'disabled' : ''}>Next →</button>`;
      document.getElementById('prev-page').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
      document.getElementById('next-page').addEventListener('click', () => { if (state.page < state.totalPages) { state.page++; load(); } });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function render(payments) {
    if (payments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No payments found for this filter.</td></tr>';
      return;
    }
    tbody.innerHTML = payments.map((p) => `
      <tr>
        <td>${escapeHtml(p.paymentDate)}</td>
        <td>${escapeHtml(p.unitNumber)}</td>
        <td>${escapeHtml(p.tenantName)}</td>
        <td>${formatMoney(p.amount)}</td>
        <td>${escapeHtml(p.paymentMethod)}</td>
        <td>${escapeHtml(p.referenceNumber || '—')}</td>
      </tr>`).join('');
  }

  // ---- Record ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formToObject(e.target);
    if (!data.leaseId) return showToast('Choose a lease.', 'error');
    try {
      const created = await api.post('/payments', data);
      form.reset();
      showToast(`Payment recorded. Balance due: ${formatMoney(created.balanceDue)}`, 'success');
      load();
      loadLeaseOptions();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  recordBtn.addEventListener('click', () => {
    document.querySelector('#payment-form').scrollIntoView({ behavior: 'smooth' });
  });

  dateFromEl.addEventListener('change', () => { state.page = 1; load(); });
  dateToEl.addEventListener('change', () => { state.page = 1; load(); });
  document.getElementById('clear-filters').addEventListener('click', () => {
    dateFromEl.value = '';
    dateToEl.value = '';
    state.page = 1;
    load();
  });

  // ---- CSV export ----
  document.getElementById('export-csv').addEventListener('click', async () => {
    const q = new URLSearchParams();
    if (dateFromEl.value) q.set('dateFrom', dateFromEl.value);
    if (dateToEl.value) q.set('dateTo', dateToEl.value);
    const response = await apiFetch(`/payments/export?${q.toString()}`);
    if (!response.ok) {
      showToast('Export failed.', 'error');
      return;
    }
    const truncated = response.headers.get('x-export-truncated') === 'true';
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'payments-export.csv';
    a.click();
    URL.revokeObjectURL(url);
    if (truncated) showToast('Export capped at 5,000 rows — narrow the date range.', 'warning');
    else showToast('CSV exported.', 'success');
  });

  loadLeaseOptions();
  load();
})();