#!/usr/bin/env node
// Live endpoint profiler — min-of-5 per endpoint to squeeze out network jitter.
// The no-DB /api/health response acts as the transport floor; "over floor" is
// the server-side cost (DB round-trips + bcrypt-free work).
//
// Usage:
//   node scripts/profile-live.mjs https://rpms-xxxx.onrender.com [baseline.json]
// Baseline file format (optional): { "GET /api/units?limit=5": { min: 812 }, ... }
// Credentials: RPMS_ADMIN_EMAIL / RPMS_ADMIN_PASSWORD env overrides, else seed admin.

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[2] || '').replace(/\/+$/, '');
const BASELINE_PATH = process.argv[3] || '';
if (!BASE) {
  console.error('Usage: node scripts/profile-live.mjs https://<service>.onrender.com [baseline.json]');
  process.exit(1);
}
let baseline = null;
if (BASELINE_PATH) {
  try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); }
  catch (e) { console.error(`(no baseline: ${e.message})`); }
}

const EMAIL = process.env.RPMS_ADMIN_EMAIL || 'admin@rpms.local';
const PASSWORD = process.env.RPMS_ADMIN_PASSWORD || 'Admin@2026!';

const REPEATS = 5;
const TIMEOUT = 30_000;

async function timed(path, { token, method = 'GET', body } = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method,
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const ms = performance.now() - t0;
  await res.arrayBuffer().catch(() => {});
  return { ms, status: res.status };
}

function min5(samples) {
  // 200 = success, 401/404 = expected floor shapes; anything else is noise.
  const ok = samples.filter((s) => s.status === 200 || s.status === 401 || s.status === 404);
  if (!ok.length) return { min: NaN, statuses: samples.map((s) => s.status).join(',') };
  return { min: Math.min(...ok.map((s) => s.ms)), statuses: [...new Set(ok.map((s) => s.status))].join(',') };
}

// ---- login ----
let token = null;
try {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await res.json().catch(() => null);
  if (res.status === 200 && j?.data?.token) {
    token = j.data.token;
    console.log(`logged in as ${EMAIL}`);
  } else {
    console.log(`(!) login ${res.status} — authed endpoints will be skipped or 401`);
  }
} catch (e) {
  console.log(`(!) login failed: ${e.message}`);
}

// ---- endpoints ----
const authed = [
  ['GET /api/units?limit=5', '/api/units?limit=5'],
  ['GET /api/tenants?limit=5', '/api/tenants?limit=5'],
  ['GET /api/rent/payments?limit=5', '/api/rent/payments?limit=5'],
  ['GET /api/water/readings?limit=5', '/api/water/readings?limit=5'],
  ['GET /api/water/payments?limit=5', '/api/water/payments?limit=5'],
  ['GET /api/receipts?limit=5', '/api/receipts?limit=5'],
  ['GET /api/expenses?limit=5', '/api/expenses?limit=5'],
  ['GET /api/audit?limit=5', '/api/audit?limit=5'],
  ['GET /api/settings', '/api/settings'],
  ['GET /api/branding', '/api/branding'],
];
const unauthed = [
  ['GET /api/health (no DB — floor)', '/api/health'],
  ['GET /api/nope (404 — floor)', '/api/definitely-not-a-route'],
];

const results = {};
console.log(`\nprofiling ${REPEATS}× each, min-of-N (all times ms)…\n`);
for (const [label, path] of [...unauthed, ...authed]) {
  const samples = [];
  for (let i = 0; i < REPEATS; i++) {
    try { samples.push(await timed(path, { token })); }
    catch { samples.push({ ms: NaN, status: 'ERR' }); }
    await new Promise((r) => setTimeout(r, 150));
  }
  const m = min5(samples);
  results[label] = m;
  console.log(`${label.padEnd(34)} min=${m.min?.toFixed(0)?.padStart(5) ?? ' n/a'}  [${m.statuses}]`);
}

// ---- analysis ----
const floor = results['GET /api/health (no DB — floor)']?.min ?? 0;
console.log(`\ntransport floor (health, no DB): ${floor.toFixed(0)}ms`);
console.log('\nendpoint                      now(min)  over-floor   baseline  delta');
for (const [label, r] of Object.entries(results)) {
  if (label.includes('floor')) continue;
  const over = r.min - floor;
  const b = baseline?.[label]?.min;
  const delta = b != null ? r.min - b : null;
  const fmt = (v) => (v == null || Number.isNaN(v) ? '   —' : String(Math.round(v)).padStart(5));
  console.log(
    `${label.padEnd(30)} ${fmt(r.min)}ms   ${fmt(over)}ms      ${fmt(b)}ms  ${delta == null ? '' : (delta <= 0 ? '-' : '+') + Math.abs(Math.round(delta)) + 'ms'}`
  );
}

if (BASELINE_PATH) {
  const out = BASELINE_PATH.replace(/\.json$/, '') + '.after.json';
  try { writeFileSync(out, JSON.stringify(results, null, 2)); console.log(`\nresults saved → ${out}`); } catch {}
}
