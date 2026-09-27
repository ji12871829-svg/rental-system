// Jest globalTeardown: remove the template, any worker clones the teardown
// hooks could not drop (e.g. a hard-killed run), and the legacy shared
// `rpms_test` database from before per-worker isolation — a stale one would
// silently serve outdated fixture data to anything still pointing at the
// setup-env default. Worker clones are normally dropped by
// WorkerDbEnvironment.teardown per worker.
import { Client } from 'pg';

const ADMIN_URL = 'postgres://rms_user:rms_password@localhost:5432/rpms';

export default async function globalTeardown(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    const leftovers = await admin.query(
      `SELECT datname FROM pg_database
       WHERE datname IN ('rpms_test', 'rpms_test_template') OR datname LIKE 'rpms_test_w%'`,
    );
    for (const row of leftovers.rows) {
      await admin.query(`DROP DATABASE IF EXISTS ${row.datname} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}
