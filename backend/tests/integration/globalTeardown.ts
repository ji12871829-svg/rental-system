import { Client } from 'pg';

export default async function globalTeardown(): Promise<void> {
  const admin = new Client({ connectionString: 'postgres://rms_user:rms_password@localhost:5432/rpms' });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS rpms_test WITH (FORCE)');
  await admin.end();
}