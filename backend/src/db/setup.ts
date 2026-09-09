// `npm run db:setup` — idempotent. Applies the schema, seeds the 24 units and
// sample data, creates the default users (password hashed at runtime), then
// backfills receipts + SMS notifications for seeded payments.
import bcrypt from 'bcryptjs';
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

async function seedUsers(): Promise<void> {
  const users = [
    { name: 'System Administrator', email: 'admin@rpms.local', password: 'Admin@2026!', role: 'ADMIN' },
    { name: 'Property Manager', email: 'manager@rpms.local', password: 'Manager@2026!', role: 'PROPERTY_MANAGER' },
    { name: 'Front Desk Staff', email: 'staff@rpms.local', password: 'Staff@2026!', role: 'STAFF' },
  ];
  for (const u of users) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [u.email]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(u.password, 12);
      await pool.query(
        `INSERT INTO users (name, email, phone, password_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
        [u.name, u.email, null, hash, u.role]
      );
      // eslint-disable-next-line no-console
      console.log(`  created user ${u.email} (${u.role})`);
    }
  }
}

async function main() {
  await applyFile(SCHEMA_SQL);
  await applyFile(SEED_SQL);
  await seedUsers();
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