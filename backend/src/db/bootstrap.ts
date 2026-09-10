// First-boot bootstrap: if the production database is empty (no `users`
// table), apply the schema, seed, default users and backfills automatically.
//
// Why: a one-click Render Blueprint deploy points at a freshly created Neon
// database with no tables. Without this, the predeploy gate refuses to boot
// until the operator runs `npm run db:setup` manually from their machine —
// dead weight when seed.sql is fully idempotent (WHERE NOT EXISTS / ON
// CONFLICT DO NOTHING) and users are created with runtime bcrypt hashes.
//
// Safety:
//   * triggers ONLY when the `users` table does not exist — an existing
//     install (even one mid-migration) is never touched or seeded again;
//   * runs BEFORE the HTTP listener opens (awaited in index.ts main()), so
//     the health check only turns green on a ready service;
//   * the admin password is fixed in one place: the seed bootstrap uses the
//     exact same user list as backend/src/db/setup.ts. Change passwords on
//     first login (see DEPLOY.md go-live checklist).
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool, query } from '../config/db';

const SCHEMA_SQL = path.resolve(__dirname, '../../../database/schema.sql');
const SEED_SQL = path.resolve(__dirname, '../../../database/seed.sql');

const DEFAULT_USERS = [
  { name: 'System Administrator', email: 'admin@rpms.local', password: 'Admin@2026!', role: 'ADMIN' },
  { name: 'Property Manager', email: 'manager@rpms.local', password: 'Manager@2026!', role: 'PROPERTY_MANAGER' },
  { name: 'Front Desk Staff', email: 'staff@rpms.local', password: 'Staff@2026!', role: 'STAFF' },
];

async function usersTableExists(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'users'`
  );
  return rows.length > 0;
}

export async function bootstrapIfEmpty(): Promise<boolean> {
  if (await usersTableExists()) return false;

  console.log('[bootstrap] database is empty — applying schema, seed and default users…');
  await pool.query(fs.readFileSync(SCHEMA_SQL, 'utf8'));
  await pool.query(fs.readFileSync(SEED_SQL, 'utf8'));

  for (const u of DEFAULT_USERS) {
    const hash = await bcrypt.hash(u.password, 12);
    await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [u.name, u.email, null, hash, u.role]
    );
  }

  // Same backfills db:setup performs, so seeded payments get their receipts
  // and SMS history rows and every surface behaves like a real install.
  const { backfillReceipts } = await import('../services/receiptService');
  const { backfillSms } = await import('../services/smsService');
  await backfillReceipts();
  await backfillSms();

  const unitCount = await query<{ count: string }>('SELECT count(*)::text AS count FROM units');
  console.log(`[bootstrap] complete — ${unitCount[0].count} units ready. Default users created (admin@rpms.local / Admin@2026!) — change the passwords on first login.`);
  return true;
}
