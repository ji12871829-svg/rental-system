import { query, queryOne } from '../config/db';
import type { Pagination } from '../types';

// Writes one audit row. Never throws — auditing must not break the
// operation it records.
export async function logAudit(opts: {
  userId?: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        opts.userId ?? null,
        opts.action,
        opts.entity,
        opts.entityId ?? null,
        opts.oldValue === undefined ? null : JSON.stringify(opts.oldValue),
        opts.newValue === undefined ? null : JSON.stringify(opts.newValue),
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write audit log:', err);
  }
}

export async function listAuditLogs(opts: {
  page: number;
  limit: number;
  entity?: string;
  action?: string;
  userId?: number;
}): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.entity) {
    params.push(opts.entity);
    where.push(`a.entity = $${params.length}`);
  }
  if (opts.action) {
    params.push(opts.action);
    where.push(`a.action = $${params.length}`);
  }
  if (opts.userId) {
    params.push(opts.userId);
    where.push(`a.user_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs a ${whereSql}`,
    params
  );
  const total = Number(totalRow?.count ?? 0);
  const offset = (opts.page - 1) * opts.limit;
  const rows = await query(
    `SELECT a.*, u.name AS user_name, u.email AS user_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ${whereSql}
     ORDER BY a.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.limit, offset]
  );
  return {
    rows,
    pagination: { page: opts.page, limit: opts.limit, total, totalPages: Math.ceil(total / opts.limit) },
  };
}