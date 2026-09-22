// `npm run db:setup` — idempotent. Applies the schema, seeds the 24-unit clean
// configuration, then backfills receipts + SMS notifications for any existing
// payments.
//
// No default users are created: there are NO seeded credentials in this
// system. The first account is created through the public "Create account"
// flow (/register → POST /api/auth/register), which bootstraps as an ACTIVE
// ADMIN when the users table is empty — every account after that is an
// admin-approved request. See routes/auth.ts and DEPLOY.md.
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';
import { backfillReceipts } from '../services/receiptService';
import { backfillSms } from '../services/smsService';

const SCHEMA_SQL = path.resolve(__dirname, '../../../database/schema.sql');
const SEED_SQL = path.resolve(__dirname, '../../../database/seed.sql');

async function applyFile(file: string): Promise<void> {
  const sql = fs.readFileSync(file, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Applying ${path.relative(process.cwd(), file)} …`);
  await pool.query(sql);
}

async function main() {
  await applyFile(SCHEMA_SQL);
  await applyFile(SEED_SQL);
  const receipts = await backfillReceipts();
  const sms = await backfillSms();
  // eslint-disable-next-line no-console
  console.log(`Backfilled ${receipts} receipts and ${sms} SMS notifications.`);
  // eslint-disable-next-line no-console
  console.log('Database setup complete.');
  await pool.end();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('Database setup failed:', err);
  await pool.end();
  process.exit(1);
});