// Jest globalSetup: rebuilds the isolated test database from scratch.
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const TEST_DB = 'rpms_test';
const ADMIN_URL = 'postgres://rms_user:rms_password@localhost:5432/rpms';

export default async function globalSetup(): Promise<void> {
  // 1. Drop + recreate the test database (FORCE kills lingering connections).
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB} OWNER rms_user`);
  await admin.end();

  // 2. Point the app's pool at it (env.ts reads this at import time).
  process.env.DATABASE_URL = `postgres://rms_user:rms_password@localhost:5432/${TEST_DB}`;
  const { pool } = await import('../../src/config/db');

  // 3. Schema + test fixture. The production database/seed.sql is a clean
  // go-live seed (no sample tenants) since the M-Pesa seed-cleanup commit of 2026-09-11 — the integration
  // tests depend on the historical sample dataset, which lives in
  // tests/fixtures/sample-data.sql so tests own their data (hermetic).
  const schema = fs.readFileSync(path.resolve(__dirname, '../../../database/schema.sql'), 'utf8');
  const seed = fs.readFileSync(path.resolve(__dirname, '../fixtures/sample-data.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(seed);

  // 3b. Migrations — production boots applyMigrations() after bootstrap; the
  // test DB must carry the same post-schema additions (demo_requests,
  // audit_logs back-fill, …) or any route touching them 500s under test.
  const { applyMigrations } = await import('../../src/db/migrations');
  await applyMigrations();

  // 4. Users (hashes generated at runtime — never stored in the repo).
  const users = [
    { name: 'Test Admin', email: 'admin@rpms.local', password: 'Admin@2026!', role: 'ADMIN' },
    { name: 'Test Manager', email: 'manager@rpms.local', password: 'Manager@2026!', role: 'PROPERTY_MANAGER' },
    { name: 'Test Staff', email: 'staff@rpms.local', password: 'Staff@2026!', role: 'STAFF' },
  ];
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 4); // low cost for test speed
    await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, status)
       VALUES ($1, $2, NULL, $3, $4, 'ACTIVE')`,
      [u.name, u.email, hash, u.role]
    );
  }

  // 5. Receipts + SMS backfill so payment flows behave like a real install.
  const { backfillReceipts } = await import('../../src/services/receiptService');
  const { backfillSms } = await import('../../src/services/smsService');
  await backfillReceipts();
  await backfillSms();

  await pool.end();
}