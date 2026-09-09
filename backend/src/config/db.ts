// PostgreSQL connection pool. All SQL is parameterized ($1, $2…) — never
// interpolate user input into a query string.
import { Pool } from 'pg';
import { env, isProd } from './env';

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  ssl: isProd ? { rejectUnauthorized: false } : false,
});

// Idle-client errors (e.g. the DB is dropped during test teardown) must not
// crash the process — log them instead.
pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] idle client error:', err.message);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = any>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryOne<T = any>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

// Minimal SQL-executor shape shared by services that run inside transactions.
export interface SqlExec {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export const poolExec: SqlExec = {
  query: async (text: string, params: unknown[] = []) => pool.query(text, params),
};

// Runs `fn` inside a transaction with automatic rollback on error.
export async function withTransaction<T>(
  fn: (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      query: (text: string, params: unknown[] = []) => client.query(text, params),
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}