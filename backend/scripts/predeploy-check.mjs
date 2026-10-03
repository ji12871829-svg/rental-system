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
import { Pool } from 'pg';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const problems = [];
const warnings = [];
const scriptDir = dirname(fileURLToPath(import.meta.url)); // backend/scripts

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
//
// Use a pooled Client instead of a single-use `new Client()`: the free-tier
// Neon pooler's very first connection after idle can return a mangled
// response (`pg v3 syntax error at or near //`), which makes a one-shot
// client fail and abort the whole deploy even though the app itself boots
// fine. The pooled client reconnects on failure, so the pre-deploy probe
// reflects reality instead of the pooler's cold-start quirk.
//
// The pool also serves the 3b SQL gate below and is closed at the very end
// (after all DB checks have run), so the connection is reused, not churned.
let pool = null;
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

  pool = new Pool({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const EXPECTED_TABLES = ['users', 'tenants', 'rent_payments', 'settings', 'business_branding', 'audit_logs'];
  let rows = null;
  // The free-tier Neon pooler's first connection after idle can return a
  // mangled response (pg v3 syntax error at or near //). Retry the probe a
  // few times with a short backoff so a transient cold-start failure does
  // not abort the whole deploy.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      if (attempt > 1) await sleep(Math.min(2000 * (attempt - 1), 6000));
      const { rows: r } = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [EXPECTED_TABLES]
      );
      rows = r;
      break;
    } catch (err) {
      if (attempt === 5) {
        problems.push(`cannot reach PostgreSQL (after ${attempt} attempts): ${err.message}`);
      }
    }
  }
  if (rows) {
    const found = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !found.has(t));
    if (missing.length > 0) {
      // Not fatal: the first boot auto-applies schema + seed on an empty
      // database (src/db/bootstrap.ts). Only worth flagging so the log
      // explains why the first boot takes a little longer.
      warnings.push(`schema missing tables (${missing.join(', ')}) — first boot will apply schema + seed + default users automatically`);
    }
  }
}

// 3b. SQL syntax gate — execute database/schema.sql and every migration
// against a THROWAWAY TRANSACTION and roll back. This is the check that would
// have caught the deploy-killing migration 009 bug (// comments are invalid
// in Postgres: "syntax error at or near //") before it ever reached a deploy:
// migrations only run at app boot, so a syntax error aborts the START command
// and the deploy — after the build is long done. Transaction rules that make
// this safe: pgcrypto's CREATE EXTENSION is transactional; schema.sql contains
// no CREATE INDEX CONCURRENTLY (the one DDL that cannot run in a tx); every
// migration is idempotent DDL, all of which is transactional in Postgres.
if (pool) {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Fresh-install path: schema first, then every migration on top —
      // exactly the boot order bootstrapIfEmpty() → applyMigrations() runs.
      // On an EXISTING database schema.sql is skipped: the recorded applied-set
      // below is authoritative, and re-running it would be a no-op at best.
      const schemaPath = join(scriptDir, '..', '..', 'database', 'schema.sql');
      const { rows: markerRows } = await client.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'schema_migrations'`
      );
      const freshInstall = markerRows.length === 0;
      let applied = new Set();
      if (freshInstall) {
        if (existsSync(schemaPath)) {
          await client.query(fs.readFileSync(schemaPath, 'utf8'));
        } else {
          warnings.push(`schema.sql not found at ${schemaPath} — SQL gate covered migrations only`);
        }
      } else {
        // Existing install: only the not-yet-recorded migration files need
        // validation (mirrors applyMigrations() — an already-applied file
        // re-run could false-fail on non-idempotent DDL).
        const { rows: appliedRows } = await client.query(`SELECT version FROM schema_migrations`);
        applied = new Set(appliedRows.map((r) => r.version));
      }
      const migrationsDir = join(scriptDir, '..', 'src', 'db', 'migrations');
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter((f) => /^\d+_.+\.sql$/.test(f))
        .toSorted();
      for (const file of migrationFiles) {
        if (applied.has(file)) continue;
        await client.query(fs.readFileSync(join(migrationsDir, file), 'utf8'));
      }
      await client.query('ROLLBACK');
      const validated = migrationFiles.filter((f) => !applied.has(f)).length;
      console.log(
        `[predeploy] SQL gate passed (${validated}/${migrationFiles.length} migrations${freshInstall ? ' + schema' : ''} verified in a rolled-back transaction).`,
      );
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (sqlErr) {
    problems.push(`SQL syntax/schema gate failed: ${sqlErr.message}`);
  }
}

// 4. Frontend build present (same-origin deploys only — API-split deploys skip).
const repoRoot = join(scriptDir, '..', '..'); // repo root (contains backend/ and frontend/)
const frontendIndex = join(repoRoot, 'frontend', 'dist', 'index.html');
if (!existsSync(frontendIndex)) {
  warnings.push(`frontend/dist/index.html not found (expected ${frontendIndex}) — API-only mode; build the frontend first for same-origin serving`);
}

if (pool) {
  try { await pool.end(); } catch { /* already closed */ }
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
