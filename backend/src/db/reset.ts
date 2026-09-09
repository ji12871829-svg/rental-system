// `npm run db:reset` — drops every table (dev tool) and re-runs setup.
import { pool } from '../config/db';

async function main() {
  // eslint-disable-next-line no-console
  console.log('Dropping all tables (dev reset)…');
  await pool.query(`
    DROP TABLE IF EXISTS sms_notifications, receipts, water_payments, water_meter_readings,
      water_purchases, expenses, rent_payments, tenants, units, floors, properties,
      settings, audit_logs, users CASCADE;
  `);
  await pool.end();
  // eslint-disable-next-line no-console
  console.log('Reset complete. Run `npm run db:setup` to recreate.');
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('Reset failed:', err);
  await pool.end();
  process.exit(1);
});