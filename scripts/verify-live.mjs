#!/usr/bin/env node
// Post-deploy verification — the checks from docs/DEPLOY.md §3, scripted.
//
// Usage:
//   node scripts/verify-live.mjs https://rpms-xxxx.onrender.com
//
// Optional env overrides (defaults use the seed admin — change passwords on
// first login, then set these to the real credentials):
//   RPMS_BASE_URL=https://…  RPMS_ADMIN_EMAIL=…  RPMS_ADMIN_PASSWORD=…
//   VERIFY_SKIP_AUTH=1 skips sign-in + authed checks (CI without credentials)
//
// Plain Node 18+ (global fetch, no deps) so it runs anywhere, including CI
// or a cron job pinging the service after each deploy.
//
// Exit codes: 0 = all green, 1 = at least one hard failure. A failed login
// with the seed credentials is a failure too — the message explains the two
// likely causes (password changed / seed users removed), both of which mean
// the site itself is fine and only the script's credentials need updating.

const BASE = (process.argv[2] || process.env.RPMS_BASE_URL || '').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.RPMS_ADMIN_EMAIL || 'admin@rpms.local';
const ADMIN_PASSWORD = process.env.RPMS_ADMIN_PASSWORD || 'Admin@2026!';

if (!BASE) {
  console.error('Usage: node scripts/verify-live.mjs https://<your-service>.onrender.com');
  process.exit(1);
}
let base;
try {
  base = new URL(BASE);
  if (!/^https?:$/.test(base.protocol)) throw new Error('bad protocol');
} catch {
  console.error(`Not a valid http(s) URL: ${BASE}`);
  process.exit(1);
}

const results = [];
let failed = 0;
function record(name, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failed++;
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${mark}  ${name}${detail ? `\n    ${detail}` : ''}`);
}

const TIMEOUT = 30_000; // Render free tier cold start can take ~30–60 s
async function get(path, { redirect = 'follow', headers = {} } = {}) {
  const res = await fetch(base.origin + path, { redirect, signal: AbortSignal.timeout(TIMEOUT), headers });
  return res;
}
async function postJson(path, body, token) {
  return fetch(base.origin + path, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

console.log(`Verifying ${base.origin}\n`);

// ---------------------------------------------------------------- health --
try {
  const res = await get('/api/health');
  const body = await res.json().catch(() => null);
  const ok = res.status === 200 && body?.status === 'ok';
  const cfg = body?.config ?? {};
  const cfgLine = Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join(' ');
  record(
    'GET /api/health → 200 {status:"ok"}',
    ok,
    `nodeEnv=${body?.nodeEnv} db=${body?.db} sms=${body?.smsProvider} email=${body?.emailProvider}\n    config: ${cfgLine}\n    (db:"checking" is by design — the DB round-trip is logged server-side; ` +
    `the app refuses to boot if the DB is unreachable, so a green health check means Neon answered.)`
  );
  const unset = Object.entries(cfg).filter(([, v]) => v === false).map(([k]) => k);
  if (unset.length) {
    console.log(`  ⚠ config knobs still unset: ${unset.join(', ')} — fix in Render env or Settings (see DEPLOY.md §3)`);
  }
} catch (err) {
  record('GET /api/health', false, `request failed: ${err.message} (cold start? retry in ~60 s)`);
}

// ------------------------------------------------- static app + PWA files --
try {
  const res = await get('/');
  const html = await res.text();
  const rootDiv = html.includes('id="root"');
  const noCache = /no-cache/i.test(res.headers.get('cache-control') ?? '');
  record(
    'GET / → 200 SPA index (root div, no-cache HTML)',
    res.status === 200 && rootDiv && noCache,
    `cache-control=${res.headers.get('cache-control')}`
  );
} catch (err) {
  record('GET /', false, err.message);
}

for (const [path] of [
  ['/manifest.webmanifest', 'PWA manifest (name, start_url "/", icons)'],
  ['/sw.js', 'service worker (installable = served, no-cache)'],
  ['/pwa-192.png', 'PWA icon 192'],
  ['/pwa-512.png', 'PWA icon 512'],
  ['/favicon.svg', 'favicon'],
]) {
  try {
    const res = await get(path);
    let detail = `status=${res.status} type=${res.headers.get('content-type')}`;
    if (path === '/manifest.webmanifest') {
      const m = await res.json().catch(() => null);
      const good = m && m.start_url === '/' && Array.isArray(m.icons) && m.icons.length >= 2;
      detail = `name="${m?.name}" display=${m?.display} icons=${m?.icons?.length} ${good ? '' : '← check manifest'}`;
      record(path, res.status === 200 && good, detail);
      continue;
    }
    if (path === '/sw.js') {
      const sw = await res.text();
      const v = /const VERSION = '([^']+)'/.exec(sw)?.[1];
      detail += ` VERSION=${v ?? '??'}`;
      record(path, res.status === 200 && Boolean(v), detail);
      continue;
    }
    record(path, res.status === 200, detail);
  } catch (err) {
    record(path, false, err.message);
  }
}

// ------------------------------------------------- deep links (SPA fallback) --
for (const path of ['/tenants', '/rent', '/water-meter', '/users']) {
  try {
    const res = await get(path);
    const html = await res.text();
    const isSpa = res.status === 200 && html.includes('id="root"') && /text\/html/.test(res.headers.get('content-type') ?? '');
    record(
      `GET ${path} → SPA fallback (not a 404)`,
      isSpa,
      isSpa ? 'renders index.html — client router takes over' : `status=${res.status}`
    );
  } catch (err) {
    record(`GET ${path}`, false, err.message);
  }
}

// --------------------------------------------- API 404 shape (router sanity) --
try {
  const res = await get('/api/definitely-not-a-route');
  const body = await res.json().catch(() => null);
  record(
    'GET /api/definitely-not-a-route → 404 JSON (API router intact)',
    res.status === 404 && body?.error === 'NOT_FOUND',
    `status=${res.status} body=${JSON.stringify(body)}`
  );
} catch (err) {
  record('GET /api/definitely-not-a-route', false, err.message);
}

// ------------------------------------------------------------- security TLS --
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(base.hostname);
try {
  if (isLocal) {
    record('HTTPS + HSTS present', true, 'local target — TLS check not applicable');
  } else {
    const res = await get('/api/health');
    record(
      'HTTPS + HSTS present',
      base.protocol === 'https:' && Boolean(res.headers.get('strict-transport-security')),
      base.protocol === 'https:' ? `hsts=${res.headers.get('strict-transport-security') ?? 'absent (Render sets it — absent means proxy header issue)'}` : 'base URL is not https'
    );
  }
} catch { /* already reported above */ }

// --------------------------------------------------------------- auth flow --
const SKIP_AUTH = process.env.VERIFY_SKIP_AUTH === '1';
if (SKIP_AUTH) console.log('(VERIFY_SKIP_AUTH=1 — skipping sign-in and authed endpoint checks)');
console.log('');
let token = null;
if (!SKIP_AUTH) {
try {
  const res = await postJson('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const body = await res.json().catch(() => null);
  if (res.status === 200 && body?.data?.token) {
    token = body.data.token;
    record(`POST /api/auth/login → 200 (${ADMIN_EMAIL})`, true, `role=${body.data.user?.role} name="${body.data.user?.name}"`);
  } else if (res.status === 401) {
    record(
      `POST /api/auth/login (${ADMIN_EMAIL})`,
      false,
      '401 — not a deploy bug if the seed password was already changed or seed users were removed. ' +
      `Re-run with RPMS_ADMIN_EMAIL / RPMS_ADMIN_PASSWORD set to current credentials, or log in via the browser to confirm.`
    );
  } else {
    record(`POST /api/auth/login (${ADMIN_EMAIL})`, false, `status=${res.status} body=${JSON.stringify(body)}`);
  }
} catch (err) {
  record('POST /api/auth/login', false, err.message);
}
}

if (token) {
  // Wrong password must be rejected — one probe only (login limiter: 20/15 min per IP).
  try {
    const res = await postJson('/api/auth/login', { email: ADMIN_EMAIL, password: 'definitely-wrong-probe' });
    record('POST /api/auth/login wrong password → 401', res.status === 401, `status=${res.status}`);
  } catch (err) {
    record('POST /api/auth/login wrong password', false, err.message);
  }

  try {
    const res = await get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => null);
    record('GET /api/auth/me with token → same user', res.status === 200 && body?.data?.email === ADMIN_EMAIL, `email=${body?.data?.email}`);
  } catch (err) {
    record('GET /api/auth/me', false, err.message);
  }

  for (const path of ['/api/units?limit=1', '/api/tenants?limit=1', '/api/settings']) {
    try {
      const res = await get(path, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => null);
      record(`GET ${path} (authed) → 200`, res.status === 200 && body != null, `status=${res.status}`);
    } catch (err) {
      record(`GET ${path}`, false, err.message);
    }
  }
}

// ------------------------------------------------------------------ summary --
console.log('\n' + '—'.repeat(60));
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} checks passed.`);
if (failed > 0) {
  console.log('Failures:');
  for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail.split('\n')[0]}` : ''}`);
}
console.log(
  'Not covered here (do once in a real browser): PWA install prompt + offline reload, ' +
  'a full login through the UI, and the second-load service-worker registration.'
);
process.exit(failed > 0 ? 1 : 0);
