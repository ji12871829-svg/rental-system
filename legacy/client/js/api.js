// api.js — centralized fetch wrapper (cookie-session version).
//
// Session model (post-hardening migration):
//   - The JWT lives ONLY in an httpOnly SameSite=Lax cookie (`rms_token`) set
//     by the server. JavaScript can never read it — this is what closes the
//     XSS-exfiltration hole that localStorage had.
//   - A second, readable cookie (`rms_csrf`) holds the double-submit CSRF
//     token. Every state-changing request sends it back in the X-CSRF-Token
//     header; the server verifies it against both the cookie and the JWT.
//   - The login response body carries the CSRF token (not the JWT), which we
//     cache in memory for the life of the page.
//
// All fetches run with `credentials: 'include'` so the browser attaches the
// cookies on the same-origin request. A 401 (session expired) clears the
// in-memory session and redirects to the login page.

const USER_KEY = 'rms_user';      // display-only user object (never the token)
let csrfTokenCache = null;        // double-submit CSRF token from /auth/login
const loggedOutRedirect = () => { window.location.href = 'index.html'; };

function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
function setUser(user) { localStorage.setItem(USER_KEY, JSON.stringify(user)); }
function clearSession() {
  localStorage.removeItem(USER_KEY);
  csrfTokenCache = null;
}
function redirectToLogin() {
  clearSession();
  loggedOutRedirect();
}

const PAYLOAD_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function apiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (PAYLOAD_METHODS.has(method)) {
    headers['Content-Type'] = 'application/json';
    if (csrfTokenCache) headers['X-CSRF-Token'] = csrfTokenCache;
  }

  let response;
  try {
    response = await fetch(`${window.RMS_CONFIG.API_BASE_URL}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include', // attach the httpOnly + CSRF cookies
      body: options.body !== undefined && !(options.body instanceof FormData)
        ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
        : options.body,
    });
  } catch (err) {
    throw new Error('Network error — is the server running?');
  }

  if (response.status === 401) redirectToLogin();
  return response;
}

async function requestJSON(path, options = {}) {
  const response = await apiFetch(path, options);
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await response.json() : null;

  if (!response.ok) {
    const err = new Error((body && body.message) || `Request failed (${response.status})`);
    err.status = response.status;
    err.apiError = body || {};
    throw err;
  }
  return body;
}

const api = {
  get: (path) => requestJSON(path),
  post: (path, body) => requestJSON(path, { method: 'POST', body }),
  patch: (path, body) => requestJSON(path, { method: 'PATCH', body }),
  delete: (path) => requestJSON(path, { method: 'DELETE' }),
};

// Called by auth.js after a successful login; safe to call again on refresh.
function rememberSession(user, csrfToken) {
  setUser(user);
  csrfTokenCache = csrfToken;
}

// ---- DOM helpers shared by every page ----

function showToast(message, type = 'info', ms = 4200) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, ms);
}

function openModal(html, { wide = false } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  return backdrop;
}

function closeModal(backdrop) { backdrop.remove(); }

// Reads a form by id into an object; ignores empty fields unless keepEmpty.
function formToObject(formEl, { keepEmpty = false } = {}) {
  const data = {};
  for (const el of formEl.querySelectorAll('input, select, textarea')) {
    if (!el.name || el.disabled) continue;
    const value = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (!keepEmpty && value === '') continue;
    data[el.name] = value;
  }
  return data;
}

// Session bootstrap shared by all page scripts: renders the top bar from the
// cached user (or /auth/me), sets the in-memory CSRF token so mutations work
// after a refresh (the CSRF cookie survives; the header value doesn't), and
// hides admin-only UI for non-admin roles (the server still enforces roles).
async function requireAuth() {
  if (localStorage.getItem(USER_KEY)) {
    csrfTokenCache = readCsrfCookie(); // refresh may have cleared the cache
    const user = getUser();
    renderTopbar(user);
    applyRoleGating(user);
    if (user) return user;
  }
  try {
    const data = await api.get('/auth/me');
    rememberSession(data.user, readCsrfCookie());
    renderTopbar(data.user);
    applyRoleGating(data.user);
    return data.user;
  } catch {
    redirectToLogin();
    return null;
  }
}

// UX-only gating: elements marked .admin-only are hidden for non-admins.
// The API enforces roles authoritatively regardless.
function applyRoleGating(user) {
  const isAdmin = user && user.role === 'admin';
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !isAdmin);
  });
}

// Shared logout: POST /auth/logout clears the httpOnly session cookie
// server-side; then clear the client session and return to login. Every page
// binds its #logout-link to this.
async function handleLogout(e) {
  if (e && e.preventDefault) e.preventDefault();
  try { await api.post('/auth/logout'); } catch { /* clear locally regardless */ }
  clearSession();
  window.location.href = 'index.html';
}

// The CSRF cookie is NOT httpOnly, so JS may read it for the double-submit
// header (that is the point of double-submit). The cookie value never
// changes while logged in; re-reading it covers page refreshes.
function readCsrfCookie() {
  const match = document.cookie.split(';').map((s) => s.trim())
    .find((s) => s.startsWith('rms_csrf='));
  return match ? decodeURIComponent(match.slice('rms_csrf='.length)) : null;
}

function renderTopbar(user) {
  const topbar = document.querySelector('.topbar');
  if (topbar && user) {
    topbar.innerHTML = `
      <span>${escapeHtml(user.fullName || user.email || '')}</span>
      <span class="role-badge">${escapeHtml(user.role || 'manager')}</span>`;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatMoney(n) {
  const num = Number(n);
  return `$${Number.isFinite(num) ? num.toFixed(2) : '0.00'}`;
}

function markActiveNav(pageKey) {
  document.querySelectorAll('.sidebar nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.page === pageKey);
  });
}