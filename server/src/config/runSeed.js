// runSeed.js — executes migrations/002_seed_data.sql inside one transaction,
// then inserts the seed admin with a REAL bcrypt hash generated at seed time
// (the hash can never live in the repo; see 002_seed_data.sql).
//
// Idempotency: every INSERT in the SQL file is guarded with NOT EXISTS /
// ON CONFLICT, and the admin insert below checks existence first — re-running
// is safe. The admin password itself is fixed ("ChangeMe123!") for local dev
// only; rotate it in production (docs/README Deploying checklist).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db');

const SEED_FILE = path.join(__dirname, '../../../migrations/002_seed_data.sql');

async function runSeed() {
  const sql = fs.readFileSync(SEED_FILE, 'utf8');
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);

    // Admin user — parameterized INSERT so the hash never touches SQL strings.
    const adminEmail = 'admin@olbano.example';
    const exists = await client.query('SELECT 1 FROM users WHERE email = $1', [adminEmail]);
    if (exists.rowCount === 0) {
      const passwordHash = await bcrypt.hash('ChangeMe123!', saltRounds);
      await client.query(
        'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
        [adminEmail, passwordHash, 'Building Admin', 'admin']
      );
      console.log('+ admin user created (admin@olbano.example / ChangeMe123!)');
    } else {
      console.log('= admin user already exists, skipping');
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runSeed };