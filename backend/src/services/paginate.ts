// Shared single-query pagination. Every list endpoint used to run two serial
// queries — a COUNT(*) plus the page query — which doubles the database
// round-trips (the dominant cost on a remote DB like Neon). A COUNT(*) OVER ()
// window function returns the grand total alongside the page rows in one
// round-trip. At this app's table sizes the window count costs the same as a
// plain COUNT, so the second query is pure latency overhead.
import { query } from '../config/db';
import type { Pagination } from '../types';

const TOTAL_KEY = '__total_count';

export async function paginate<T>(opts: {
  selectSql: string; // columns between SELECT and FROM (must not end with a comma)
  tableSql: string; // FROM clause incl. JOINs
  whereSql?: string; // 'WHERE …' or ''
  params?: unknown[]; // positional params referenced by the clauses above
  orderBy: string; // 'ORDER BY …'
  page: number;
  limit: number;
}): Promise<{ rows: T[]; pagination: Pagination }> {
  const nParams = opts.params?.length ?? 0;
  const sql =
    'SELECT ' + opts.selectSql + ', (COUNT(*) OVER ())::int AS ' + TOTAL_KEY +
    ' ' + opts.tableSql +
    (opts.whereSql ? ' ' + opts.whereSql : '') +
    ' ' + opts.orderBy +
    ' LIMIT $' + (nParams + 1) + ' OFFSET $' + (nParams + 2);
  const rows = await query<T & { [TOTAL_KEY]?: number }>(
    sql,
    [...(opts.params ?? []), opts.limit, (opts.page - 1) * opts.limit]
  );
  // Edge case: an empty page (offset past the end) has no row to carry the
  // window total, so total reads 0. Callers paginate forward from page 1, so
  // this only surfaces if a client explicitly requests a far offset.
  const total = rows.length > 0 ? Number(rows[0][TOTAL_KEY] ?? 0) : 0;
  return {
    rows: rows.map(({ [TOTAL_KEY]: _total, ...rest }) => rest as T),
    pagination: { page: opts.page, limit: opts.limit, total, totalPages: Math.ceil(total / opts.limit) },
  };
}
