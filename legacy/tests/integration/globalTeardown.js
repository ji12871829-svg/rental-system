// tests/integration/globalTeardown.js — close the shared pg pool so Jest can
// exit cleanly (the app singleton keeps connections open otherwise).
require('./env'); // ensure DATABASE_URL is present before the pool is created
module.exports = async function globalTeardown() {
  const pool = require('../../server/src/config/db');
  await pool.end();
};