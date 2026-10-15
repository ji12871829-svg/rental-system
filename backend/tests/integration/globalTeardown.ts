// Jest globalTeardown: remove the template, any worker clones the teardown
// hooks could not drop (e.g. a hard-killed run), and the legacy shared
// `rpms_test` database from before per-worker isolation — a stale one would
// silently serve outdated fixture data to anything still pointing at the
// setup-env default. Worker clones are normally dropped by
// WorkerDbEnvironment.teardown per worker.
import { Client } from 'pg';

const ADMIN_URL = 'postgres://rms_user:rms_password@localhost:5432/rpms';

export default async function globalTeardown(): Promise<void> {
  // Teardown must NEVER fail the build: a rejected teardown flips the whole
  // jest run red with every suite green (exit 1, zero failed tests) — exactly
  // what a DB hiccup during this cleanup produces. Leftover databases are
  // dropped with FORCE by the next run's setup, so log and move on.
  let admin: Client | null = null;
  try {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const leftovers = await admin.query(
      `SELECT datname FROM pg_database
       WHERE datname IN ('rpms_test', 'rpms_test_template') OR datname LIKE 'rpms_test_w%'`,
    );
    for (const row of leftovers.rows) {
      await admin.query(`DROP DATABASE IF EXISTS ${row.datname} WITH (FORCE)`);
    }
  } catch (err) {
    console.error(`[globalTeardown] cleanup failed, next setup will retry: ${(err as Error).message}`);
  } finally {
    await admin?.end().catch(() => undefined);
  }
}
