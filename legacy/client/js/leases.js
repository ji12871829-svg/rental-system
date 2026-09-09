// leases.js — tabbed lease list + 4-step creation wizard + terminate action.
// The wizard surfaces the API's 409 overlap error clearly (build prompt §11.5).
(function () {
  requireAuth();
  markActiveNav('leases');
  document.getElementById('logout-link').addEventListener('click', handleLogout);

  const tbody = document.getElementById('leases-body');
  const paginationEl = document.getElementById('pagination');
  const tabs = document.querySelectorAll('#lease-tabs button');

  let currentStatus = 'active';
  let state = { page: 1, totalPages: 1 };

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    currentStatus = tab.dataset.status;
    state.page = 1;
    load();
  }));

  async function load() {
    try {
      const data = await api.get(`/leases?status=${currentStatus}&page=${state.page}&limit=50`);
      state.totalPages = data.pagination.totalPages;
      render(data.data);
      paginationEl.innerHTML = `
        <span class="muted">Page ${state.page} of ${Math.max(state.totalPages, 1)} · ${data.pagination.total} leases</span>
        <button class="btn btn-secondary btn-sm" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <button class="btn btn-secondary btn-sm" id="next-page" ${state.page >= state.totalPages ? 'disabled' : ''}>Next →</button>`;
      document.getElementById('prev-page').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
      document.getElementById('next-page').addEventListener('click', () => { if (state.page < state.totalPages) { state.page++; load(); } });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function render(leases) {
    if (leases.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No ${currentStatus} leases.</td></tr>`;
      return;
    }
    tbody.innerHTML = leases.map((l) => `
      <tr>
        <td>${escapeHtml(l.unitNumber)}</td>
        <td>${escapeHtml(l.tenantName)}</td>
        <td>${escapeHtml(l.startDate)}</td>
        <td>${escapeHtml(l.endDate)}</td>
        <td>${formatMoney(l.monthlyRent)}</td>
        <td><span class="badge ${l.status}">${l.status}</span></td>
        <td>${l.status === 'active' ? `<button class="btn btn-danger btn-sm" data-terminate="${l.id}" data-unit="${escapeHtml(l.unitNumber)}">Terminate</button>` : ''}</td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-terminate]').forEach((b) => b.addEventListener('click', () => confirmTerminate(Number(b.dataset.terminate), b.dataset.unit)));
  }

  function confirmTerminate(id, unitNumber) {
    const backdrop = openModal(`<div class="modal">
      <h2>Terminate lease for unit ${unitNumber}?</h2>
      <p>Terminating releases the unit back to <strong>vacant</strong> and blocks new payments against this lease.</p>
      <p>If you prefer to mark the lease <strong>expired</strong> instead, cancel and edit it directly.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
        <button type="button" class="btn btn-danger" id="confirm-terminate">Terminate Lease</button>
      </div>
    </div>`);
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
    backdrop.querySelector('#confirm-terminate').addEventListener('click', async () => {
      try {
        await api.patch(`/leases/${id}`, { status: 'terminated' });
        closeModal(backdrop);
        showToast('Lease terminated; unit released.', 'success');
        load();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  // ---------------- CREATE WIZARD: 4 steps ----------------
  const wizard = { unitId: null, tenantId: null, startDate: '', endDate: '', monthlyRent: '', depositAmount: '' };
  let unitCache = [];
  let tenantCache = [];

  function wizardStep(step, html) {
    return `
      <div class="steps">
        ${[1, 2, 3, 4].map((n) => `<div class="step-dot ${n === step ? 'active' : ''}">Step ${n}</div>`).join('')}
      </div>
      ${html}`;
  }

  document.getElementById('create-lease-btn').addEventListener('click', async () => {
    const backdrop = openModal('<div class="empty-state">Loading…</div>', { wide: true });

    // Preload units + tenants once for the whole wizard.
    try {
      const [units, tenants] = await Promise.all([
        api.get('/units?limit=100'),
        api.get('/tenants?limit=100&includeArchived=true'),
      ]);
      unitCache = units.data;
      tenantCache = tenants.data;
    } catch (err) {
      showToast(err.message, 'error');
      closeModal(backdrop);
      return;
    }

    backdrop.innerHTML = `<div class="modal wide"><h2>Create Lease</h2>
      <button class="modal-close" data-close>×</button>
      <div id="wizard-body"></div></div>`;
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
    showStep(backdrop, 1);
  });

  function showStep(backdrop, step) {
    const body = backdrop.querySelector('#wizard-body');
    const renderNext = () => {
      backdrop.querySelectorAll('.btn[data-next]').forEach((b) =>
        b.addEventListener('click', () => showStep(backdrop, step + 1)));
    };

    if (step === 1) {
      const vacant = unitCache.filter((u) => u.status === 'vacant');
      body.innerHTML = wizardStep(1, `
        <p class="muted">Step 1 of 4 — pick a vacant unit</p>
        ${vacant.length === 0 ? '<div class="alert warning">No vacant units available. Mark a unit vacant on the Units page first (or create one).</div>' : `
        <table class="data">
          <thead><tr><th></th><th>Unit</th><th>Floor</th><th>Beds</th><th>Rent</th></tr></thead>
          <tbody>${vacant.map((u) => `<tr><td><input type="radio" name="unit" value="${u.id}" data-number="${escapeHtml(u.unitNumber)}"></td><td>${escapeHtml(u.unitNumber)}</td><td>${escapeHtml(u.floor || '—')}</td><td>${u.bedrooms}</td><td>${formatMoney(u.baseRent)}</td></tr>`).join('')}</tbody>
        </table>`}
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="button" class="btn" data-next ${vacant.length === 0 ? 'disabled' : ''}>Next →</button>
        </div>`);
      body.querySelectorAll('input[name="unit"]').forEach((r) => {
        r.addEventListener('change', () => {
          wizard.unitId = Number(r.value);
          const unit = unitCache.find((u) => u.id === Number(r.value));
          if (unit && !wizard.monthlyRent) wizard.monthlyRent = String(unit.base_rent);
          if (unit && !wizard.depositAmount) wizard.depositAmount = String(unit.base_rent);
        });
      });
      body.querySelector('[data-next]')?.addEventListener('click', () => {
        if (!wizard.unitId) return showToast('Select a vacant unit first.', 'error');
        showStep(backdrop, 2);
      });
    } else if (step === 2) {
      const active = tenantCache.filter((t) => !t.isArchived);
      body.innerHTML = wizardStep(2, `
        <p class="muted">Step 2 of 4 — pick the tenant</p>
        <div class="toolbar"><input type="text" id="tenant-search" placeholder="Search tenant…" style="flex:1" /></div>
        <table class="data" id="tenant-table">
          <thead><tr><th></th><th>Name</th><th>Email</th><th>Phone</th></tr></thead>
          <tbody>${active.map((t) => `<tr class="tenant-row" data-name="${escapeHtml(`${t.firstName} ${t.lastName}`.toLowerCase())}" data-email="${escapeHtml((t.email || '').toLowerCase())}"><td><input type="radio" name="tenant" value="${t.id}"></td><td>${escapeHtml(`${t.firstName} ${t.lastName}`)}</td><td>${escapeHtml(t.email)}</td><td>${escapeHtml(t.phone)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-back>← Back</button>
          <button type="button" class="btn" data-next>Next →</button>
        </div>`);
      const search = body.querySelector('#tenant-search');
      search?.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        body.querySelectorAll('.tenant-row').forEach((row) => {
          row.style.display = row.dataset.name.includes(q) || row.dataset.email.includes(q) ? '' : 'none';
        });
      });
      body.querySelectorAll('input[name="tenant"]').forEach((r) => r.addEventListener('change', () => { wizard.tenantId = Number(r.value); }));
      body.querySelector('[data-back]').addEventListener('click', () => showStep(backdrop, 1));
      body.querySelector('[data-next]').addEventListener('click', () => {
        if (!wizard.tenantId) return showToast('Select a tenant first.', 'error');
        showStep(backdrop, 3);
      });
    } else if (step === 3) {
      body.innerHTML = wizardStep(3, `
        <p class="muted">Step 3 of 4 — dates, rent & deposit</p>
        <form id="wizard-dates" class="form-grid">
          <div class="form-group"><label>Start date *</label><input name="startDate" type="date" value="${escapeHtml(wizard.startDate)}" required /></div>
          <div class="form-group"><label>End date *</label><input name="endDate" type="date" value="${escapeHtml(wizard.endDate)}" required /></div>
          <div class="form-group"><label>Monthly rent (USD) *</label><input name="monthlyRent" type="number" step="0.01" min="0" value="${escapeHtml(wizard.monthlyRent)}" required /></div>
          <div class="form-group"><label>Deposit (USD)</label><input name="depositAmount" type="number" step="0.01" min="0" value="${escapeHtml(wizard.depositAmount)}" /></div>
        </form>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-back>← Back</button>
          <button type="button" class="btn" data-next>Next →</button>
        </div>`);
      body.querySelector('[data-back]').addEventListener('click', () => showStep(backdrop, 2));
      body.querySelector('[data-next]').addEventListener('click', () => {
        const f = body.querySelector('#wizard-dates');
        wizard.startDate = f.startDate.value;
        wizard.endDate = f.endDate.value;
        wizard.monthlyRent = f.monthlyRent.value;
        wizard.depositAmount = f.depositAmount.value;
        if (!wizard.startDate || !wizard.endDate) return showToast('Both dates are required.', 'error');
        if (wizard.endDate <= wizard.startDate) return showToast('End date must be after start date.', 'error');
        if (!wizard.monthlyRent) return showToast('Monthly rent is required.', 'error');
        showStep(backdrop, 4);
      });
    } else if (step === 4) {
      const unit = unitCache.find((u) => u.id === wizard.unitId);
      const tenant = tenantCache.find((t) => t.id === wizard.tenantId);
      body.innerHTML = wizardStep(4, `
        <p class="muted">Step 4 of 4 — review & submit</p>
        <div class="card">
          <table class="data">
            <tbody>
              <tr><td><strong>Unit</strong></td><td>${escapeHtml(unit ? unit.unit_number : '')}</td></tr>
              <tr><td><strong>Tenant</strong></td><td>${escapeHtml(tenant ? `${tenant.first_name} ${tenant.last_name} (${tenant.email})` : '')}</td></tr>
              <tr><td><strong>Period</strong></td><td>${escapeHtml(wizard.startDate)} → ${escapeHtml(wizard.endDate)}</td></tr>
              <tr><td><strong>Monthly rent</strong></td><td>${formatMoney(wizard.monthlyRent)}</td></tr>
              <tr><td><strong>Deposit</strong></td><td>${formatMoney(wizard.depositAmount || 0)}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="alert warning hidden" id="wizard-error"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-back>← Back</button>
          <button type="submit" class="btn btn-success" id="wizard-submit">Create Lease</button>
        </div>`);
      body.querySelector('[data-back]').addEventListener('click', () => showStep(backdrop, 3));
      body.querySelector('#wizard-submit').addEventListener('click', async () => {
        const errorEl = body.querySelector('#wizard-error');
        errorEl.classList.add('hidden');
        const submitBtn = body.querySelector('#wizard-submit');
        submitBtn.disabled = true;
        try {
          await api.post('/leases', {
            unitId: wizard.unitId,
            tenantId: wizard.tenantId,
            startDate: wizard.startDate,
            endDate: wizard.endDate,
            monthlyRent: Number(wizard.monthlyRent),
            depositAmount: Number(wizard.depositAmount || 0),
          });
          closeModal(backdrop);
          showToast('Lease created — unit is now occupied.', 'success');
          load();
        } catch (err) {
          // Surface the overlap conflict (409) clearly, plus other errors.
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
          submitBtn.disabled = false;
        }
      });
      renderNext();
    }
  }

  load();
})();