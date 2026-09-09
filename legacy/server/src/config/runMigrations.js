// runMigrations.js — applies migrations/*.sql in filename order, exactly once
// each. Tracked in a schema_migrations table so re-running is safe (no-ops).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '../../../migrations');

async function runMigrations() {
  // Bookkeeping table must exist before the first tracked migration runs.
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const { rows } = await db.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename]
    );
    if (rows.length > 0) {
      console.log(`= ${filename} (already applied, skipping)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    // One transaction per migration: a half-applied migration is worse than a
    // failed one, especially with CREATE TABLE + CREATE INDEX pairs.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
      console.log(`+ ${filename} applied`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  console.log('Migrations complete.');
}

// Skippable when imported by the test setup (tests run their own setup).
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations };
