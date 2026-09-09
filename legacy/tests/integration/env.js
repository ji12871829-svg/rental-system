// tests/integration/env.js — environment bootstrap for EVERY Jest worker
// (registered as jest `setupFiles`) and for globalSetup/globalTeardown.
//
// Why: Jest runs globalSetup in a SEPARATE process, so env vars set there do
// not reach test workers. This file (a) loads the app's server/.env so
// JWT_SECRET etc. are present, and (b) rewrites DATABASE_URL to point at the
// isolated `rental_management_test` database. Tests therefore never touch the
// dev database.
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../server/.env') });

process.env.NODE_ENV = 'test';

const base = process.env.DATABASE_URL;
if (!base) {
  throw new Error('DATABASE_URL not found in server/.env — cannot run integration tests.');
}
const url = new URL(base);
url.pathname = '/rental_management_test';
process.env.DATABASE_URL = url.toString();

module.exports = { TEST_DB_NAME: 'rental_management_test', ADMIN_DB_URL: base };