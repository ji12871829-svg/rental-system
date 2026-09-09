// tests/integration/globalSetup.js — runs ONCE before the suite (own process).
// Creates/recreates the isolated `rental_management_test` database, then
// applies schema + seed. Workers get the same DATABASE_URL via env.js.
const env = require('./env');
const { Client } = require('pg');
const { runMigrations } = require('../../server/src/config/runMigrations');
const { runSeed } = require('../../server/src/config/runSeed');

module.exports = async function globalSetup() {
  // Connect to the admin `postgres` DB (same server) to manage the test DB.
  const adminUrl = new URL(env.ADMIN_DB_URL);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });

  await admin.connect();
  try {
    // Drop + recreate: every run starts from a known, seeded state.
    await admin.query(`DROP DATABASE IF EXISTS ${env.TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${env.TEST_DB_NAME} OWNER rms_user`);
  } finally {
    await admin.end();
  }

  // DATABASE_URL (in this process) already points at the test DB via env.js.
  await runMigrations();
  await runSeed();
};