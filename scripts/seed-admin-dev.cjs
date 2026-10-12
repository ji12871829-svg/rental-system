#!/usr/bin/env node
// Idempotent dev helper: ensure a staff admin user exists (users + portal
// access only). Uses a hard-coded test credential — dev/local only, never
// committed with real secrets.
//
// NOTE: this file lives in scripts/ but depends on backend's pg + bcryptjs.
// We resolve them relative to the backend package so this script can run
// without being inside backend's CJS setup.

const path = require('path');
const backendRoot = path.resolve(__dirname, '..', 'backend');

// Force resolve into backend/node_modules.
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if ((request === 'pg' || request === 'bcryptjs') && !parent.paths.includes(backendRoot + '/node_modules')) {
    const fakeParent = Object.create(parent);
    fakeParent.paths = [backendRoot + '/node_modules', ...parent.paths];
    return origResolve.call(Module, request, fakeParent, isMain, options);
  }
  return origResolve.call(Module, request, parent, isMain, options);
};

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const DB_URL = process.env.DATABASE_URL || 'postgres://rms_user:rms_password@localhost:5432/rpms';
const ADMIN_EMAIL = 'admin@rpms.local';
const ADMIN_PASSWORD = 'Admin@2026!';
const ADMIN_NAME = 'Dev Admin';

(async () => {
  const pool = new Pool({ connectionString: DB_URL, ssl: false });
  try {
    await pool.query('SELECT 1');
    console.log('connected to postgres');

    const existing = await pool.query(
      'SELECT id, email, role, status FROM users WHERE email = $1',
      [ADMIN_EMAIL.toLowerCase()]
    );
    console.log('existing admin rows:', existing.rowCount);

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    const inserted = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, status)
       VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE')
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             password_hash = EXCLUDED.password_hash,
             role = 'ADMIN',
             status = 'ACTIVE',
             updated_at = NOW()
       RETURNING id, email, role, status`,
      [ADMIN_NAME, ADMIN_EMAIL.toLowerCase(), hash]
    );
    console.log('ensured admin user row:', inserted.rows[0]?.email);

    // Tenant portal access is intentionally NOT a staff admin feature. The
    // schema enforces UNIQUE(tenant_id) so a single tenant cannot get two
    // portal rows; more importantly the portal auth baked into this app is
    // tenant-facing, not staff-facing, so we never seed staff portal access.
    // If a prior dev run left an email-only portal row for the admin email,
    // refresh its password hash so the same credential works in the portal
    // too (harmless, explicitly guarded).
    const portalEmailRow = await pool.query(
      'SELECT id, tenant_id FROM tenant_portal_access WHERE email = $1',
      [ADMIN_EMAIL.toLowerCase()]
    );
    if (portalEmailRow.rows.length) {
      await pool.query(
        `UPDATE tenant_portal_access
         SET password_hash = $1, status = 'ACTIVE', updated_at = NOW()
         WHERE id = $2`,
        [hash, portalEmailRow.rows[0].id]
      );
      console.log('refreshed existing tenant_portal_access row for', ADMIN_EMAIL);
    } else {
      console.log('no tenant_portal_access row for admin email — leaving portal unchanged');
    }

    const after = await pool.query(
      'SELECT id, email, name, role, status FROM users WHERE email = $1',
      [ADMIN_EMAIL.toLowerCase()]
    );
    console.log('final admin row:', JSON.stringify(after.rows[0]));
    console.log('done');
  } catch (e) {
    console.error('seed-admin-dev failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
