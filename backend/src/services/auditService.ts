import { query } from '../config/db';
import { paginate } from './paginate';
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

  return paginate<Record<string, unknown>>({
    selectSql: `a.*, u.name AS user_name, u.email AS user_email`,
    tableSql: `FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id`,
    whereSql,
    params,
    orderBy: `ORDER BY a.created_at DESC`,
    page: opts.page,
    limit: opts.limit,
  });
}