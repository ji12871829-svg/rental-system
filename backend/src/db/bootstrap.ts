// First-boot bootstrap: if the production database is empty (no `users`
// table), apply the schema, seed and backfills automatically.
//
// Why: a one-click Render Blueprint deploy points at a freshly created Neon
// database with no tables. Without this, the predeploy gate refuses to boot
// until the operator runs `npm run db:setup` manually from their machine —
// dead weight when seed.sql is fully idempotent (WHERE NOT EXISTS / ON
// CONFLICT DO NOTHING).
//
// No default users: there are NO seeded credentials in this system. The
// operator claims the first account through the public "Create account" flow
// (POST /api/auth/register), which becomes an ACTIVE ADMIN when the users
// table is empty — see routes/auth.ts and DEPLOY.md.
//
// Safety:
//   * triggers ONLY when the `users` table does not exist — an existing
//     install (even one mid-migration) is never touched or seeded again;
//   * runs BEFORE the HTTP listener opens (awaited in index.ts main()), so
//     the health check only turns green on a ready service.
import fs from 'fs';
import path from 'path';
import { pool, query } from '../config/db';

const SCHEMA_SQL = path.resolve(__dirname, '../../../database/schema.sql');
const SEED_SQL = path.resolve(__dirname, '../../../database/seed.sql');

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

  // Same backfills db:setup performs, so seeded payments get their receipts
  // and SMS history rows and every surface behaves like a real install.
  const { backfillReceipts } = await import('../services/receiptService');
  const { backfillSms } = await import('../services/smsService');
  await backfillReceipts();
  await backfillSms();

  const unitCount = await query<{ count: string }>('SELECT count(*)::text AS count FROM units');
  console.log(`[bootstrap] complete — ${unitCount[0].count} units ready. No user accounts exist yet: claim the first (admin) account via "Create account" on the landing page.`);
  return true;
}
