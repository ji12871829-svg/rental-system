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

// A migration's identity is its full filename (schema_migrations.version), so
// two files CAN share a numeric prefix without breaking apply order — sort()
// still yields a deterministic sequence. A shared number nevertheless hides an
// ordering mistake from whoever reads the directory next, so the runner
// refuses to start on a new one. The single existing pair is grandfathered by
// exact filename: both files are already recorded in schema_migrations on
// every populated install, and renaming either would make it re-run there.
const GRANDFATHERED_NUMBER_GROUPS: readonly (readonly string[])[] = [
  ['011_message_template_kind.sql', '011_ops_essentials.sql'],
];

// Pure — no filesystem, no database — so the rule is unit-testable directly.
// Returns one entry per un-grandfathered collision; empty means unambiguous.
export function migrationNumberCollisions(files: readonly string[]): string[] {
  const byNumber = new Map<string, string[]>();
  for (const file of files) {
    const number = file.slice(0, file.indexOf('_'));
    const group = byNumber.get(number);
    if (group) group.push(file);
    else byNumber.set(number, [file]);
  }

  const collisions: string[] = [];
  for (const [number, group] of byNumber) {
    if (group.length < 2) continue;
    const grandfathered = GRANDFATHERED_NUMBER_GROUPS.some(
      (known) => known.length === group.length && group.every((file) => known.includes(file))
    );
    if (!grandfathered) collisions.push(`${number} → ${group.join(', ')}`);
  }
  return collisions;
}

// Highest number + 1, so the error can name the next free migration.
function nextMigrationNumber(files: readonly string[]): string {
  const highest = files.reduce(
    (max, file) => Math.max(max, Number(file.slice(0, file.indexOf('_')))),
    0
  );
  return String(highest + 1).padStart(3, '0');
}

function assertMigrationNumbers(files: readonly string[], directory: string): void {
  const collisions = migrationNumberCollisions(files);
  if (collisions.length === 0) return;
  throw new Error(
    `Duplicate migration number${collisions.length > 1 ? 's' : ''} in ${directory}: ` +
      `${collisions.join('; ')}. Give every migration a unique numeric prefix — the next ` +
      `free number is ${nextMigrationNumber(files)}. Renumber only the NEW file: renaming an ` +
      `already-applied migration makes it re-run on every populated database.`
  );
}

export async function applyMigrations(): Promise<void> {
  const directory = migrationsDirectory();
  const files = fs.readdirSync(directory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  // Checked BEFORE any database work, so a source-tree mistake fails with zero
  // side effects (no schema_migrations table, nothing applied) — and fails
  // loudly on Render, where a thrown boot error marks the deploy bad and keeps
  // the previous release serving.
  assertMigrationNumbers(files, directory);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

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