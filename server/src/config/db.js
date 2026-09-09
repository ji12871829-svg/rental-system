// db.js — PostgreSQL connection pool (single source of truth for DB access).
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Production DBs (Render/Railway add-ons) require SSL; local dev does not.
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

// Parameterized queries only — never interpolate values into SQL (AGENTS.md §2).
module.exports = pool;
