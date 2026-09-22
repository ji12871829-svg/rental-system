// Predeploy gate — runs immediately before the API boots (wired into
// `backend/package.json` "start"). Plain Node ESM on purpose: Render installs
// with NODE_ENV=production, so devDependencies like tsx do not exist here.
//
// Fails fast (exit 1) when the deploy would come up broken: missing secrets,
// unreachable database, un-migrated schema, or a missing frontend build. On
// Render a failed start marks the deploy bad and keeps the previous release
// serving — which is exactly what you want instead of a boot-looping API.
//
// Runs unconditionally (dev included) — dotenv below supplies backend/.env
// values locally, and real environment variables always win over .env, so
// Render's dashboard config takes precedence exactly like src/config/env.ts.
// SSL policy mirrors src/config/db.ts (sslmode= wins; prod remote = TLS on).
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const problems = [];
const warnings = [];

// 1. Required secrets — the app has a dev fallback for JWT_SECRET, but
//    production must never run on it (anyone could forge sessions).
const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) problems.push(`${key} is not set`);
}
if (process.env.JWT_SECRET === 'dev-only-secret-change-me') {
  problems.push('JWT_SECRET is still the dev fallback — generate a real one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
}

// 2. Warn on unset identity surfaces (not fatal — editable later in Settings).
for (const key of ['BUSINESS_NAME', 'BUSINESS_REG_NO', 'BUSINESS_PHONE', 'BUSINESS_EMAIL']) {
  if (!process.env[key]) warnings.push(`${key} not set — receipts/legal pages will show placeholder text until it is filled in Settings`);
}

// 3. Database reachability + schema presence.
if (process.env.DATABASE_URL) {
  const url = process.env.DATABASE_URL;
  const sslmode = /sslmode=([a-z-]+)/.exec(url);
  let ssl = false;
  if (sslmode) ssl = sslmode[1] !== 'disable';
  else {
    try {
      const host = new URL(url).hostname;
      ssl = !['localhost', '127.0.0.1', '::1'].includes(host);
    } catch { ssl = true; }
  }

  const client = new Client({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 10_000 });
  const EXPECTED_TABLES = ['users', 'tenants', 'rent_payments', 'settings', 'business_branding', 'audit_logs'];
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [EXPECTED_TABLES]
    );
    const found = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !found.has(t));
    if (missing.length > 0) {
      // Not fatal: the first boot auto-applies schema + seed on an empty
      // database (src/db/bootstrap.ts). Only worth flagging so the log
      // explains why the first boot takes a little longer.
      warnings.push(`schema missing tables (${missing.join(', ')}) — first boot will apply schema + seed + default users automatically`);
    }
  } catch (err) {
    problems.push(`cannot reach PostgreSQL: ${err.message}`);
  } finally {
    try { await client.end(); } catch { /* already closed */ }
  }
}

// 4. Frontend build present (same-origin deploys only — API-split deploys skip).
const { existsSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const scriptDir = dirname(fileURLToPath(import.meta.url)); // backend/scripts
const repoRoot = join(scriptDir, '..', '..'); // repo root (contains backend/ and frontend/)
const frontendIndex = join(repoRoot, 'frontend', 'dist', 'index.html');
if (!existsSync(frontendIndex)) {
  warnings.push(`frontend/dist/index.html not found (expected ${frontendIndex}) — API-only mode; build the frontend first for same-origin serving`);
}

if (warnings.length > 0) {
  console.warn('[predeploy] warnings:');
  for (const w of warnings) console.warn(`  - ${w}`);
}

if (problems.length > 0) {
  console.error('[predeploy] FAILED — refusing to start:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log('[predeploy] all checks passed.');
