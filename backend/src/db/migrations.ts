import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';

const MIGRATIONS_DIRS = [
  path.resolve(__dirname, 'migrations'),
  path.resolve(__dirname, '../../src/db/migrations'),
];

function migrationsDirectory(): string {
  const directory = MIGRATIONS_DIRS.find((candidate) => fs.existsSync(candidate));
  if (!directory) throw new Error('Database migrations directory was not found.');
  return directory;
}

export async function applyMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const directory = migrationsDirectory();
  const files = fs.readdirSync(directory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (applied.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(directory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[db] applied migration ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}