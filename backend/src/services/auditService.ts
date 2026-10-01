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

// --- Session anomalies (admin alerting) -----------------------------------
//
// Login rows carry the client ip in new_value since LOGIN_CLERK was
// introduced (see the writers in auth.ts / clerkAuthRoutes.ts). Over that
// trail two cheap, high-signal patterns are detectable without GeoIP:
//
//   * mixed_path — a password LOGIN and a Clerk LOGIN_CLERK for the SAME
//     user minutes apart. Either a second person knows the password, or the
//     password is being used alongside a hijacked/abandoned Clerk identity;
//     either way the account has two live credential paths.
//   * distinct_ip — the same account signing in from two different client
//     IPs within 10 minutes. Real impossible-travel needs geolocation; this
//     narrower signal (simultaneity, not distance) still catches shared
//     credentials and takeover-in-progress without a map of false positives
//     from mobile networks.
//
// Both look back 7 days, newest pair first, capped — an investigation aid,
// not a forensic export.
export interface SessionAnomaly {
  kind: 'mixed_path' | 'distinct_ip';
  userId: number;
  userName: string | null;
  userEmail: string | null;
  firstAction: string;
  secondAction: string;
  firstIp: string | null;
  secondIp: string | null;
  at: string; // the newer login of the pair (ISO)
}

export async function listSessionAnomalies(): Promise<{ mixedPath: SessionAnomaly[]; distinctIp: SessionAnomaly[] }> {
  const loginRows = `a.action IN ('LOGIN', 'LOGIN_CLERK') AND a.entity = 'users'
      AND a.created_at >= NOW() - INTERVAL '7 days'`;

  const mixed = await query<{
    user_id: number;
    user_name: string | null;
    user_email: string | null;
    a_action: string;
    b_action: string;
    a_ip: string | null;
    b_ip: string | null;
    b_at: Date;
  }>(
    `SELECT a.user_id, u.name AS user_name, u.email AS user_email,
            a.action AS a_action, b.action AS b_action,
            a.new_value->>'ip' AS a_ip, b.new_value->>'ip' AS b_ip,
            b.created_at AS b_at
       FROM audit_logs a
       JOIN audit_logs b
         ON b.user_id = a.user_id AND b.entity = 'users'
        AND b.action = CASE WHEN a.action = 'LOGIN' THEN 'LOGIN_CLERK' ELSE 'LOGIN' END
        AND b.created_at BETWEEN a.created_at AND a.created_at + INTERVAL '30 minutes'
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${loginRows}
      ORDER BY b.created_at DESC
      LIMIT 20`,
  );

  const distinct = await query<{
    user_id: number;
    user_name: string | null;
    user_email: string | null;
    a_action: string;
    b_action: string;
    a_ip: string | null;
    b_ip: string | null;
    b_at: Date;
  }>(
    `SELECT a.user_id, u.name AS user_name, u.email AS user_email,
            a.action AS a_action, b.action AS b_action,
            a.new_value->>'ip' AS a_ip, b.new_value->>'ip' AS b_ip,
            b.created_at AS b_at
       FROM audit_logs a
       JOIN audit_logs b
         ON b.user_id = a.user_id AND b.entity = 'users' AND b.id <> a.id
        AND b.created_at BETWEEN a.created_at - INTERVAL '10 minutes' AND a.created_at + INTERVAL '10 minutes'
        AND COALESCE(a.new_value->>'ip', '') <> ''
        AND COALESCE(b.new_value->>'ip', '') <> ''
        AND COALESCE(a.new_value->>'ip', '') <> COALESCE(b.new_value->>'ip', '')
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${loginRows}
      ORDER BY b.created_at DESC
      LIMIT 20`,
  );

  const toAnomaly = (row: (typeof mixed)[number], kind: SessionAnomaly['kind']): SessionAnomaly => ({
    kind,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    firstAction: row.a_action,
    secondAction: row.b_action,
    firstIp: row.a_ip,
    secondIp: row.b_ip,
    at: row.b_at.toISOString(),
  });

  return {
    mixedPath: mixed.map((r) => toAnomaly(r, 'mixed_path')),
    distinctIp: distinct.map((r) => toAnomaly(r, 'distinct_ip')),
  };
}