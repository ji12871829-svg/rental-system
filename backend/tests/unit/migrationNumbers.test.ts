// The migration runner identifies a migration by its full filename
// (schema_migrations.version), so two files may share a numeric prefix without
// breaking apply order — but a shared number hides an ordering mistake from
// whoever reads the directory next, so applyMigrations() refuses to start on a
// NEW collision. These tests pin that rule on the pure helper, and the last
// one guards the real migrations/ directory — the same failure boot would hit,
// caught in CI instead of at deploy time.
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
  poolExec: jest.fn(),
}));

import fs from 'fs';
import path from 'path';
import { migrationNumberCollisions } from '../../src/db/migrations';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../src/db/migrations');
const realMigrations = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((file) => /^\d+_.+\.sql$/.test(file));

describe('migrationNumberCollisions', () => {
  it('is empty when every migration has its own number', () => {
    expect(migrationNumberCollisions(['001_a.sql', '002_b.sql', '012_c.sql'])).toEqual([]);
  });

  it('reports two migrations that share a number', () => {
    expect(migrationNumberCollisions(['001_a.sql', '001_b.sql'])).toEqual([
      '001 → 001_a.sql, 001_b.sql',
    ]);
  });

  it('tolerates the grandfathered 011 pair but not a third file joining it', () => {
    expect(
      migrationNumberCollisions(['011_message_template_kind.sql', '011_ops_essentials.sql'])
    ).toEqual([]);

    // Joining the existing pair is a NEW collision, not an inherited pass.
    const collisions = migrationNumberCollisions([
      '011_message_template_kind.sql',
      '011_ops_essentials.sql',
      '011_late_arrival.sql',
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toContain('011');
    expect(collisions[0]).toContain('011_late_arrival.sql');
  });

  it('does not force the grandfather pair to stay together', () => {
    // The tolerance must not stand in the way of a correct future renumbering.
    expect(
      migrationNumberCollisions(['011_message_template_kind.sql', '013_ops_essentials.sql'])
    ).toEqual([]);
  });

  it('reports every collision, not just the first', () => {
    expect(
      migrationNumberCollisions(['001_a.sql', '001_b.sql', '002_c.sql', '002_d.sql'])
    ).toEqual(['001 → 001_a.sql, 001_b.sql', '002 → 002_c.sql, 002_d.sql']);
  });

  it('accepts the real migrations directory', () => {
    expect(realMigrations.length).toBeGreaterThan(0);
    expect(migrationNumberCollisions(realMigrations)).toEqual([]);
  });
});
