// auth.js — login page logic.
// Client-side required-field validation for UX; the server re-validates
// authoritatively (validationSchemas.js). POST /auth/login returns the user
// + CSRF token — the JWT itself only exists in the httpOnly cookie.
// (The shared handleLogout lives in api.js so every page can use it.)
(function () {
  const form = document.getElementById('login-form');
  const banner = document.getElementById('error-banner');
  const btn = document.getElementById('login-btn');

  // If a valid session cookie already exists, /me succeeds → straight to dashboard.
  (async function redirectIfLoggedIn() {
    if (!document.cookie.includes('rms_token=')) return;
    try {
      const data = await api.get('/auth/me');
      if (data && data.user) {
        rememberSession(data.user, readCsrfCookie());
        window.location.href = 'dashboard.html';
      }
    } catch { /* no valid session → show the login form */ }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    banner.classList.add('hidden');
    const email = form.email.value.trim();
    const password = form.password.value;

    // Client-side required validation (UX only — server is authoritative).
    if (!email || !password) {
      showBanner('Email and password are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showBanner('Enter a valid email address.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const data = await api.post('/auth/login', { email, password });
      rememberSession(data.user, data.csrfToken);
      window.location.href = 'dashboard.html';
    } catch (err) {
      if (err.status === 429) showBanner('Too many login attempts. Try again in 15 minutes.');
      else showBanner(err.message || 'Login failed. Check your credentials.');
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });

  function showBanner(message) {
    banner.textContent = message;
    banner.classList.remove('hidden');
  }
})();