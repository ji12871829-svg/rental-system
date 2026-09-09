// users.js — admin-only user management UI. Server enforces roles; this page
// is hidden from managers via the .admin-only sidebar gating in api.js, and
// every API call here is admin-gated server-side anyway.
//
// Rules mirrored from the API (controllers/users.js):
//   - You cannot change your own role or deactivate yourself.
//   - The last active admin cannot be demoted/deactivated.
//   - Password reset invalidates ALL of that user's other sessions
//     (password_version bump); resetting your own rotates this session's
//     cookies so you stay signed in.
(function () {
  requireAuth().then((user) => {
    markActiveNav('users');
    if (!user || user.role !== 'admin') {
      document.getElementById('not-admin').classList.remove('hidden');
      document.getElementById('add-user-btn').classList.add('hidden');
    }
  });
  document.getElementById('logout-link').addEventListener('click', handleLogout);

  const tbody = document.getElementById('users-body');
  const paginationEl = document.getElementById('pagination');
  let me = null;
  let state = { page: 1, totalPages: 1 };

  async function load() {
    try {
      me = await api.get('/auth/me').then((d) => d.user);
      const data = await api.get(`/users?page=${state.page}&limit=50`);
      state.totalPages = data.pagination.totalPages;
      render(data.data);
      paginationEl.innerHTML = `
        <span class="muted">Page ${state.page} of ${Math.max(state.totalPages, 1)} · ${data.pagination.total} users</span>
        <button class="btn btn-secondary btn-sm" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <button class="btn btn-secondary btn-sm" id="next-page" ${state.page >= state.totalPages ? 'disabled' : ''}>Next →</button>`;
      document.getElementById('prev-page').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
      document.getElementById('next-page').addEventListener('click', () => { if (state.page < state.totalPages) { state.page++; load(); } });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function render(users) {
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map((u) => {
      const isSelf = me && u.id === me.id;
      return `
      <tr>
        <td>${escapeHtml(u.fullName)}${isSelf ? ' <span class="muted">(you)</span>' : ''}</td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="badge ${u.role === 'admin' ? 'occupied' : 'in_progress'}">${u.role}</span></td>
        <td>${u.isActive ? '<span class="badge active">active</span>' : '<span class="badge cancelled">inactive</span>'}</td>
        <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-edit="${u.id}">Edit</button>
          <button class="btn btn-secondary btn-sm" data-reset="${u.id}" data-name="${escapeHtml(u.fullName)}">Reset Password</button>
          ${isSelf ? '' : (u.isActive
            ? `<button class="btn btn-danger btn-sm" data-deactivate="${u.id}">Deactivate</button>`
            : `<button class="btn btn-success btn-sm" data-activate="${u.id}">Activate</button>`)}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditModal(Number(b.dataset.edit))));
    tbody.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => openResetModal(Number(b.dataset.reset), b.dataset.name)));
    tbody.querySelectorAll('[data-deactivate]').forEach((b) => b.addEventListener('click', () => toggleActive(Number(b.dataset.deactivate), false)));
    tbody.querySelectorAll('[data-activate]').forEach((b) => b.addEventListener('click', () => toggleActive(Number(b.dataset.activate), true)));
  }

  function wireClose(backdrop) {
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(backdrop)));
  }

  document.getElementById('add-user-btn').addEventListener('click', () => {
    const backdrop = openModal(`
      <h2>Add User</h2>
      <button class="modal-close" data-close>×</button>
      <form id="user-form" class="form-grid">
        <div class="form-group"><label>Full name *</label><input name="fullName" required /></div>
        <div class="form-group"><label>Email *</label><input type="email" name="email" required /></div>
        <div class="form-group"><label>Password *</label><input type="password" name="password" required minlength="8" />
          <span class="error-msg">Min 8 characters, at least one number.</span></div>
        <div class="form-group"><label>Role *</label>
          <select name="role"><option value="manager" selected>Manager</option><option value="admin">Admin</option></select></div>
        <div class="form-actions full">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn">Create User</button>
        </div>
      </form>`);
    wireClose(backdrop);
    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formToObject(e.target);
      // Client-side password policy (UX); server enforces authoritatively.
      if (data.password && !(data.password.length >= 8 && /\d/.test(data.password))) {
        return showToast('Password must be 8+ characters and contain a number.', 'error');
      }
      try {
        await api.post('/users', data);
        closeModal(backdrop);
        showToast('User created.', 'success');
        load();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  async function openEditModal(id) {
    const backdrop = openModal('<div class="empty-state">Loading…</div>');
    let target;
    try { target = await api.get(`/users/${id}`); }
    catch (err) { showToast(err.message, 'error'); closeModal(backdrop); return; }

    const isSelf = me && target.id === me.id;
    backdrop.innerHTML = `<div class="modal"><h2>Edit ${escapeHtml(target.fullName)}</h2>
      <button class="modal-close" data-close>×</button>
      <form id="user-edit-form" class="form-grid">
        <div class="form-group full"><label>Full name</label><input name="fullName" value="${escapeHtml(target.fullName)}" /></div>
        <div class="form-group"><label>Role</label>
          <select name="role" ${isSelf ? 'disabled title="You cannot change your own role"' : ''}>
            <option value="manager" ${target.role === 'manager' ? 'selected' : ''}>Manager</option>
            <option value="admin" ${target.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select></div>
        <div class="form-group"><label>Status</label>
          <select name="isActive" ${isSelf ? 'disabled title="You cannot deactivate yourself"' : ''}>
            <option value="true" ${target.isActive ? 'selected' : ''}>Active</option>
            <option value="false" ${!target.isActive ? 'selected' : ''}>Inactive</option>
          </select></div>
        <div class="form-actions full">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="submit" class="btn">Save Changes</button>
        </div>
      </form></div>`;
    wireClose(backdrop);
    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = formToObject(e.target, { keepEmpty: true });
      const payload = {};
      if (raw.fullName) payload.fullName = raw.fullName;
      if (!isSelf) {
        if (raw.role) payload.role = raw.role;
        if (raw.isActive !== undefined) payload.isActive = raw.isActive === 'true';
      }
      try {
        await api.patch(`/users/${id}`, payload);
        closeModal(backdrop);
        showToast('User updated.', 'success');
        load();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  async function openResetModal(id, name) {
    const backdrop = openModal(`
      <div class="modal">
        <h2>Reset password — ${escapeHtml(name)}</h2>
        <p class="muted">All of this user's current sessions will be signed out.</p>
        <form id="reset-form" class="form-grid">
          <div class="form-group full"><label>New password *</label>
            <input type="password" name="password" required minlength="8" />
            <span class="error-msg">Min 8 characters, at least one number.</span></div>
          <div class="form-actions full">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-danger">Reset Password</button>
          </div>
        </form>
      </div>`);
    wireClose(backdrop);
    backdrop.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { password } = formToObject(e.target);
      if (!(password.length >= 8 && /\d/.test(password))) {
        return showToast('Password must be 8+ characters and contain a number.', 'error');
      }
      try {
        const res = await api.patch(`/users/${id}`, { password });
        closeModal(backdrop);
        // Resetting your OWN password rotates this session's cookies — adopt
        // the fresh CSRF token so subsequent mutations keep working.
        if (res.csrfToken) { rememberSession(getUser(), res.csrfToken); }
        showToast(res.passwordChanged ? 'Password reset; other sessions signed out.' : 'Password reset.', 'success');
        load();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  async function toggleActive(id, activate) {
    try {
      await api.patch(`/users/${id}`, { isActive: activate });
      showToast(activate ? 'User activated.' : 'User deactivated (sessions signed out).', 'success');
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  load();
})();