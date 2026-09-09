// dashboard.js — summary cards, upcoming expirations, quick-action modals.
(function () {
  requireAuth();
  markActiveNav('dashboard');

  document.getElementById('logout-link').addEventListener('click', handleLogout);

  const errorEl = document.getElementById('load-error');

  async function load() {
    try {
      const today = new Date();
      const [occupancy, balances, maintenance] = await Promise.all([
        api.get(`/reports/occupancy?month=${today.getMonth() + 1}&year=${today.getFullYear()}`),
        api.get('/reports/outstanding-balances'),
        api.get('/maintenance?status=open&limit=100'),
      ]);

      document.getElementById('stat-occupancy').textContent = `${occupancy.occupancyRate}%`;
      document.getElementById('stat-units').textContent =
        `${occupancy.occupiedUnits} of ${occupancy.totalUnits} units held`;
      document.getElementById('stat-occupied').textContent = `${occupancy.occupiedUnits} / ${occupancy.vacantUnits}`;
      document.getElementById('stat-vacant').textContent =
        `${occupancy.vacantUnits} vacant${occupancy.maintenanceUnits ? ` · ${occupancy.maintenanceUnits} offline` : ''}`;
      document.getElementById('stat-outstanding').textContent = formatMoney(balances.totalOutstanding);
      document.getElementById('stat-maintenance').textContent = maintenance.pagination.total;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  }

  async function loadExpirations() {
    const tbody = document.querySelector('#expiry-table tbody');
    try {
      const data = await api.get('/reports/upcoming-lease-expirations?withinDays=60');
      tbody.innerHTML = data.leases.length === 0
        ? '<tr><td colspan="5" class="empty-state">No leases expire in the next 60 days.</td></tr>'
        : data.leases.map((l) => `
            <tr>
              <td>${escapeHtml(l.unitNumber)}</td>
              <td>${escapeHtml(l.tenantName)}</td>
              <td>${escapeHtml(l.endDate)}</td>
              <td>${l.daysUntilExpiry} day${l.daysUntilExpiry === 1 ? '' : 's'}</td>
              <td><span class="badge active">active</span></td>
            </tr>`).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // ---- Quick actions: modal forms ----

  async function addTenantModal() {
    const backdrop = openModal(`
      <h2>Add Tenant</h2>
      <button class="modal-close" data-close>×</button>
      <form id="quick-tenant-form" class="form-grid">
        <div class="form-group"><label>First name *</label><input name="firstName" required /></div>
        <div class="form-group"><label>Last name *</label><input name="lastName" required /></div>
        <div class="form-group"><label>Email *</label><input name="email" type="email" required /></div>
        <div class="form-group"><label>Phone *</label><input name="phone" required /></div>
        <div class="form-group"><label>National ID</label><input name="nationalId" /></div>
        <div class="form-group"><label>Emergency contact</label><input name="emergencyContactName" /></div>
        <div class="form-group full"><label>Emergency phone</label><input name="emergencyContactPhone" /></div>
        <div class="form-actions full">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn">Save Tenant</button>
        </div>
      </form>`);
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/tenants', formToObject(e.target));
        closeModal(backdrop);
        showToast('Tenant added.', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  async function recordPaymentModal() {
    const backdrop = openModal(`
      <h2>Record Payment</h2>
      <button class="modal-close" data-close>×</button>
      <form id="quick-payment-form" class="form-grid">
        <div class="form-group full"><label>Lease (unit — tenant)</label><select name="leaseId" id="lease-select" required></select></div>
        <div class="form-group"><label>Amount (USD) *</label><input name="amount" type="number" step="0.01" min="0.01" required /></div>
        <div class="form-group"><label>Payment date *</label><input name="paymentDate" type="date" required /></div>
        <div class="form-group"><label>Method *</label>
          <select name="paymentMethod" required>
            <option value="cash">Cash</option><option value="mpesa">M-Pesa</option>
            <option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option>
          </select></div>
        <div class="form-group full"><label>Reference number</label><input name="referenceNumber" /></div>
        <div class="form-group full"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        <div class="form-actions full">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn">Record Payment</button>
        </div>
      </form>`);
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));

    const select = backdrop.querySelector('#lease-select');
    select.innerHTML = '<option value="">Loading…</option>';
    try {
      const leases = await api.get('/leases?status=active&limit=100');
      select.innerHTML = leases.data.length === 0
        ? '<option value="">No active leases</option>'
        : `<option value="">Select lease…</option>` + leases.data.map((l) =>
            `<option value="${l.id}">Unit ${escapeHtml(l.unitNumber)} — ${escapeHtml(l.tenantName)} ($${l.monthlyRent}/mo)</option>`).join('');
    } catch (err) { showToast(err.message, 'error'); }

    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formToObject(e.target);
      if (!data.leaseId) return showToast('Choose a lease.', 'error');
      try {
        const created = await api.post('/payments', data);
        closeModal(backdrop);
        showToast(`Payment recorded. Balance due: ${formatMoney(created.balanceDue)}`, 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  async function newMaintenanceModal() {
    const backdrop = openModal(`
      <h2>New Maintenance Request</h2>
      <button class="modal-close" data-close>×</button>
      <form id="quick-maint-form" class="form-grid">
        <div class="form-group"><label>Unit *</label><select name="unitId" id="maint-unit-select" required></select></div>
        <div class="form-group"><label>Priority *</label>
          <select name="priority" required><option value="low">Low</option><option value="medium" selected>Medium</option>
          <option value="high">High</option><option value="urgent">Urgent</option></select></div>
        <div class="form-group full"><label>Description *</label><textarea name="description" rows="3" required></textarea></div>
        <div class="form-actions full">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn">Submit Request</button>
        </div>
      </form>`);
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));

    const select = backdrop.querySelector('#maint-unit-select');
    try {
      const units = await api.get('/units?limit=100');
      select.innerHTML = units.data.map((u) =>
        `<option value="${u.id}">Unit ${escapeHtml(u.unitNumber)} (${u.status})</option>`).join('');
    } catch (err) { showToast(err.message, 'error'); }

    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/maintenance', formToObject(e.target));
        closeModal(backdrop);
        showToast('Maintenance request submitted.', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  document.getElementById('qa-tenant').addEventListener('click', addTenantModal);
  document.getElementById('qa-payment').addEventListener('click', recordPaymentModal);
  document.getElementById('qa-maintenance').addEventListener('click', newMaintenanceModal);

  load();
  loadExpirations();
})();