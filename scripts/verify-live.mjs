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

// ------------------------------------------------- SEO surface (crawlers) --
// robots.txt / sitemap.xml / og.jpg / OG meta tags — the crawler-and-social
// layer the landing SEO work added (vite seoFiles plugin + index.html tags).
// The SPA fallback serves index.html (200, text/html) for ANY missing path,
// so "the file exists" is judged by content type and content sniffing, never
// by status code alone — a missing robots.txt looks like a 200 otherwise.
let robotsBody = null;
try {
  const res = await get('/robots.txt');
  const body = await res.text();
  const isHtml = /text\/html/.test(res.headers.get('content-type') ?? '');
  const looksLikeRobots = !isHtml && /^user-agent:/im.test(body);
  if (looksLikeRobots) robotsBody = body;
  record(
    'GET /robots.txt → crawler policy (not an SPA-fallback HTML page)',
    looksLikeRobots,
    isHtml
      ? 'served index.html — robots.txt is missing from the deploy (seoFiles emission broken?)'
      : (body.split('\n')[0] ?? '').trim().slice(0, 60)
  );
} catch (err) {
  record('GET /robots.txt', false, err.message);
}

// The sitemap is emitted only when VITE_SITE_URL is set at build time (the
// protocol requires absolute URLs; with no production domain it is skipped
// honestly and the build log says so). Absence is therefore a failure ONLY
// when robots.txt advertises a Sitemap that does not resolve — otherwise it
// is the documented skip state, recorded as a pass with instructions.
const sitemapAdvertised = robotsBody ? /^sitemap:\s*\S+$/im.test(robotsBody) : false;
try {
  const res = await get('/sitemap.xml');
  const type = res.headers.get('content-type') ?? '';
  const body = await res.text();
  const isXml = /xml/.test(type) || /^\s*<\?xml/.test(body);
  const locs = isXml ? [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]) : [];
  if (res.status === 200 && isXml && locs.length > 0) {
    const absolute = locs.every((u) => /^https?:\/\//.test(u));
    const pointer = sitemapAdvertised ? (robotsBody.match(/^sitemap:\s*(.+)$/im)?.[1] ?? '') : null;
    const pointerOk = pointer === null || /sitemap\.xml/i.test(pointer);
    record(
      `GET /sitemap.xml → ${locs.length} URLs, all absolute${pointer === null ? '' : pointerOk ? ', robots pointer matches' : ', ROBOTS POINTER MISMATCH'}`,
      absolute && pointerOk,
      absolute ? `first=${locs[0]}` : 'relative <loc> URLs found — the sitemap protocol requires absolute URLs'
    );
  } else if (sitemapAdvertised) {
    record(
      'GET /sitemap.xml',
      false,
      `robots.txt advertises a Sitemap but the file is missing (status=${res.status}, type=${type}) — the build wrote robots.txt from VITE_SITE_URL but never the sitemap itself`
    );
  } else {
    record(
      'GET /sitemap.xml → correctly absent',
      true,
      'no sitemap emitted (VITE_SITE_URL unset at build) and robots.txt advertises none — set VITE_SITE_URL on the deploy to emit one'
    );
  }
} catch (err) {
  record('GET /sitemap.xml', false, err.message);
}

try {
  const res = await get('/og.jpg');
  const type = res.headers.get('content-type') ?? '';
  let len = Number(res.headers.get('content-length') ?? 0);
  if (!len) len = (await res.arrayBuffer()).byteLength; // chunked / header stripped
  // >10 KB: the generated 1200x630 card is ~120 KB; anything smaller that
  // still claims to be an image is a placeholder or a truncated response.
  record(
    'GET /og.jpg → social preview card (real image, > 10 KB)',
    res.status === 200 && type.startsWith('image/') && len > 10_000,
    `status=${res.status} type=${type} bytes=${len || '?'}`
  );
} catch (err) {
  record('GET /og.jpg', false, err.message);
}

// The static fallback tags live in index.html, so this audits what every
// no-JS crawler actually receives on any route (the landing rewrites them
// client-side; crawlers never run that code).
try {
  const res = await get('/');
  const html = await res.text();
  const missing = ['property="og:title"', 'property="og:image"', 'name="twitter:card"'].filter((t) => !html.includes(t));
  record(
    'GET / → OG + Twitter meta tags in the served HTML',
    missing.length === 0,
    missing.length === 0 ? 'og:title, og:image, twitter:card all present' : `missing: ${missing.join(', ')}`
  );
} catch (err) {
  record('GET / → OG meta tags', false, err.message);
}

// ----------------------------------------------------- C2B probe (signed) --
// Posts a clearly-marked, money-free C2B confirmation through the REAL
// callback endpoint to prove the gate accepts signed traffic and the
// review pipeline is alive. Safety properties (mirrored from the integration
// suite):
//   * reference "RPMS-PROBE" matches no unit → the payment CANNOT post; it
//     lands UNMATCHED in the M-Pesa review queue — the same path a real
//     unmatched paybill payment takes, which is exactly what we verify;
//   * MSISDN 0000000000 is not a Kenyan number (normalizePhoneNumber → null),
//     so the sender-phone fallback can never match a tenant either;
//   * the token gates the endpoint — this is the "signed" half.
// Idempotent across retries: the TransID is derived from the current Nairobi
// minute (Daraja replays the same confirmation, verify-live may retry the
// job) — replays re-evaluate but the operator alert fires only on the row's
// first attempt, and the review page names the transaction in the alert body.
// The queue therefore accumulates at most one RPMS-PROBE row per minute per
// deploy; operators can clear them from M-Pesa Review (search RPMS-PROBE).
const PROBE_HOSTS_LOCAL = ['localhost', '127.0.0.1', '::1'].includes(base.hostname);
if (process.env.RPMS_SKIP_C2B_PROBE === '1') {
  record('C2B probe skipped (RPMS_SKIP_C2B_PROBE=1)', true, 'set by the operator');
} else if (PROBE_HOSTS_LOCAL) {
  record('C2B probe skipped (local target)', true, 'local/dev DBs stay clean — the probe runs against deployments');
} else {
  // Nairobi is UTC+3 year-round (no DST): wall-clock minute as the run id.
  const nairobiMinute = new Date(Date.now() + 3 * 3_600_000).toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  const probeId = `RPMS-PROBE-${nairobiMinute}`;
  const probeBody = {
    TransactionType: 'Pay Bill',
    TransID: probeId,
    TransTime: `${nairobiMinute}00`, // minute granularity, valid 14-digit form
    TransAmount: '1',
    BillRefNumber: 'RPMS-PROBE',
    OrgAccountBalance: '0',
    MSISDN: '0000000000',
    FirstName: 'RPMS',
    MiddleName: 'VERIFY',
    LastName: 'PROBE',
    // BusinessShortCode deliberately omitted: the route tolerates absent
    // shortcodes (some Daraja validation bodies lack it) and verify-live does
    // not know the deploy's shortcode — sending a guess would 400 the probe.
  };
  try {
    const res = await postJson('/api/mpesa/c2b/confirm?token=rpms-verify-wrong-token-probe', probeBody);
    // A wrong token must be a stealth 404. Anything else means the callback
    // gate is down (MPESA_CALLBACK_TOKEN unset on the deploy) — a security
    // regression the startup warning alone cannot catch at runtime.
    record(
      'C2B probe (wrong token) → rejected (404)',
      res.status === 404,
      res.status === 404
        ? 'callback gate active'
        : `status=${res.status} — /api/mpesa/c2b/confirm answered without a valid token; MPESA_CALLBACK_TOKEN is unset on the deploy`
    );
  } catch (err) {
    record('C2B probe (wrong token)', false, err.message);
  }
  // The signed probe needs the deploy's real callback token, which CI does
  // not hold by default (the gate secret must not live in the repo). Without
  // it there is nothing to assert beyond the wrong-token check above — skip
  // rather than fail. With RPMS_PROBE_CALLBACK_TOKEN set (repo secret or a
  // local run), this exercises the full signed path end to end.
  const probeToken = process.env.RPMS_PROBE_CALLBACK_TOKEN;
  if (!probeToken) {
    record('C2B probe (signed path) → skipped', true, `set RPMS_PROBE_CALLBACK_TOKEN to exercise it — probe id this run would be ${probeId}`);
  } else {
    try {
      const res = await postJson(`/api/mpesa/c2b/confirm?token=${encodeURIComponent(probeToken)}`, probeBody);
      const body = await res.json().catch(() => null);
      const detail = `status=${res.status} ResultDesc="${body?.ResultDesc ?? '?'}" — one review row per run minute: ${probeId}`;
      const accepted = res.status === 200 && body?.ResultCode === 0 && /manual review|Accepted/.test(body?.ResultDesc ?? '');
      const postedInstead = res.status === 200 && body?.ResultDesc === 'Accepted.';
      record(
        'C2B probe (signed) → accepted for manual review',
        accepted,
        postedInstead
          ? `RESULT DESC SAYS PLAIN "Accepted." — the probe posted instead of parking for review. Investigate: a unit named RPMS-PROBE must not exist. ${detail}`
          : detail
      );
    } catch (err) {
      record('C2B probe (signed)', false, err.message);
    }
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
