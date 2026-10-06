import { query, queryOne } from '../config/db';
import { paginate } from './paginate';
import { logAudit } from './auditService';
import { badRequest, notFound } from '../utils/httpError';
import type { Pagination } from '../types';

// Maintenance: a request is the problem report (unit/tenant/title/priority),
// work orders are the execution attempts against it (vendor, cost, schedule).
// One request can have several work orders over its life — a first attempt
// that failed, a follow-up visit, a parts order.
//
// Lifecycle rules encoded here:
//   * Creating the first work order moves an OPEN request to IN_PROGRESS —
//     work has visibly started; no separate "start" action needed.
//   * Marking a work order DONE stamps completed_at.
//   * Resolving a request stamps resolved_at (the DB CHECK enforces the pair
//     travels together); re-opening clears it.
//   * Only the last outstanding work order may keep a request from being
//     resolved — resolving with open work orders is allowed but audited, so
//     operators can force-close after a vendor bails.

export interface MaintenanceRequestInput {
  title: string;
  description?: string;
  unitId?: number;
  tenantId?: number;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';
}

export interface MaintenanceUpdateInput {
  title?: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED';
  unitId?: number;
  tenantId?: number;
}

export interface WorkOrderInput {
  vendorId?: number;
  assignedTo?: string;
  cost?: number;
  scheduledFor?: string;
  notes?: string;
}

export interface WorkOrderUpdateInput {
  vendorId?: number;
  assignedTo?: string;
  cost?: number;
  status?: 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  scheduledFor?: string;
  notes?: string;
}

const REQUEST_SELECT = `mr.*, u.unit_number, p.name AS property_name, t.full_name AS tenant_name,
  (SELECT COUNT(*)::int FROM work_orders wo WHERE wo.request_id = mr.id) AS work_order_count,
  (SELECT COUNT(*)::int FROM work_orders wo WHERE wo.request_id = mr.id AND wo.status NOT IN ('DONE', 'CANCELLED')) AS open_work_order_count`;

const REQUEST_TABLES = `FROM maintenance_requests mr
  LEFT JOIN units u ON u.id = mr.unit_id
  LEFT JOIN properties p ON p.id = u.property_id
  LEFT JOIN tenants t ON t.id = mr.tenant_id`;

export async function listMaintenanceRequests(filters: {
  page: number;
  limit: number;
  status?: string;
  priority?: string;
  unitId?: number;
  q?: string;
}): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`mr.status = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    where.push(`mr.priority = $${params.length}`);
  }
  if (filters.unitId) {
    params.push(filters.unitId);
    where.push(`mr.unit_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(mr.title ILIKE $${params.length} OR mr.description ILIKE $${params.length} OR t.full_name ILIKE $${params.length} OR u.unit_number ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return paginate<Record<string, unknown>>({
    selectSql: REQUEST_SELECT,
    tableSql: REQUEST_TABLES,
    whereSql,
    params,
    // Open work first (EMERGENCY → OPEN → rest), newest first within a priority.
    orderBy: `ORDER BY CASE mr.priority WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      CASE mr.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
      mr.reported_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}

export async function getMaintenanceRequest(id: number): Promise<{ request: Record<string, unknown>; workOrders: unknown[] }> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${REQUEST_SELECT} ${REQUEST_TABLES} WHERE mr.id = $1`,
    [id]
  );
  if (!rows.length) throw notFound('Maintenance request not found.');
  const workOrders = await query<Record<string, unknown>>(
    `SELECT wo.*, v.name AS vendor_name, v.service AS vendor_service
     FROM work_orders wo
     LEFT JOIN vendors v ON v.id = wo.vendor_id
     WHERE wo.request_id = $1
     ORDER BY wo.created_at ASC`,
    [id]
  );
  return { request: rows[0], workOrders };
}

export async function createMaintenanceRequest(input: MaintenanceRequestInput, userId: number): Promise<unknown> {
  const inserted = await query<Record<string, unknown>>(
    `INSERT INTO maintenance_requests (unit_id, tenant_id, title, description, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.unitId ?? null, input.tenantId ?? null, input.title, input.description ?? null,
     input.priority ?? 'MEDIUM', userId]
  );
  await logAudit({
    userId,
    action: 'MAINTENANCE_REQUESTED',
    entity: 'maintenance_requests',
    entityId: inserted[0].id as number,
    newValue: input,
  });
  return inserted[0];
}

export async function updateMaintenanceRequest(id: number, input: MaintenanceUpdateInput, userId: number): Promise<unknown> {
  const existing = await queryOne<{ id: number; status: string; resolved_at: Date | null }>(
    'SELECT id, status, resolved_at FROM maintenance_requests WHERE id = $1',
    [id]
  );
  if (!existing) throw notFound('Maintenance request not found.');

  // resolved_at travels with the RESOLVED status (DB CHECK): set on the
  // transition in, cleared on any move out of it.
  let resolvedAt: Date | null = existing.resolved_at;
  if (input.status && input.status !== existing.status) {
    resolvedAt = input.status === 'RESOLVED' ? new Date() : null;
  }

  const updated = await query<Record<string, unknown>>(
    `UPDATE maintenance_requests
     SET title = COALESCE($2, title),
         description = COALESCE($3, description),
         priority = COALESCE($4, priority),
         status = COALESCE($5, status),
         unit_id = COALESCE($6, unit_id),
         tenant_id = COALESCE($7, tenant_id),
         resolved_at = $8,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, input.title ?? null, input.description ?? null, input.priority ?? null,
     input.status ?? null, input.unitId ?? null, input.tenantId ?? null, resolvedAt]
  );
  await logAudit({
    userId,
    action: 'MAINTENANCE_UPDATED',
    entity: 'maintenance_requests',
    entityId: id,
    oldValue: { status: existing.status },
    newValue: input,
  });
  return updated[0];
}

export async function deleteMaintenanceRequest(id: number, userId: number): Promise<void> {
  const existing = await queryOne<{ id: number; title: string }>(
    'SELECT id, title FROM maintenance_requests WHERE id = $1',
    [id]
  );
  if (!existing) throw notFound('Maintenance request not found.');
  // Work orders cascade (FK ON DELETE CASCADE) — deleting the request is the
  // deliberate "this report was a duplicate/mistake" action.
  await query('DELETE FROM maintenance_requests WHERE id = $1', [id]);
  await logAudit({
    userId,
    action: 'MAINTENANCE_DELETED',
    entity: 'maintenance_requests',
    entityId: id,
    oldValue: { title: existing.title },
  });
}

export async function createWorkOrder(requestId: number, input: WorkOrderInput, userId: number): Promise<unknown> {
  const request = await queryOne<{ id: number; status: string }>(
    'SELECT id, status FROM maintenance_requests WHERE id = $1',
    [requestId]
  );
  if (!request) throw notFound('Maintenance request not found.');
  if (request.status === 'RESOLVED' || request.status === 'CANCELLED') {
    throw badRequest(`This request is ${request.status.toLowerCase()} — re-open it before adding a work order.`);
  }
  if (input.vendorId) {
    const vendor = await queryOne<{ id: number }>('SELECT id FROM vendors WHERE id = $1', [input.vendorId]);
    if (!vendor) throw badRequest('The selected vendor does not exist.');
  }

  const inserted = await query<Record<string, unknown>>(
    `INSERT INTO work_orders (request_id, vendor_id, assigned_to, cost, scheduled_for, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [requestId, input.vendorId ?? null, input.assignedTo ?? null, input.cost ?? 0,
     input.scheduledFor ?? null, input.notes ?? null, userId]
  );

  // Work has started by definition — move an OPEN request forward once.
  if (request.status === 'OPEN') {
    await query(`UPDATE maintenance_requests SET status = 'IN_PROGRESS', updated_at = NOW() WHERE id = $1`, [requestId]);
  }

  await logAudit({
    userId,
    action: 'WORK_ORDER_CREATED',
    entity: 'work_orders',
    entityId: inserted[0].id as number,
    newValue: { ...input, requestId },
  });
  return inserted[0];
}

export async function updateWorkOrder(id: number, input: WorkOrderUpdateInput, userId: number): Promise<unknown> {
  const existing = await queryOne<{ id: number; status: string; request_id: number; cost: string }>(
    'SELECT id, status, request_id, cost FROM work_orders WHERE id = $1',
    [id]
  );
  if (!existing) throw notFound('Work order not found.');

  const updated = await query<Record<string, unknown>>(
    `UPDATE work_orders
     SET vendor_id = COALESCE($2, vendor_id),
         assigned_to = COALESCE($3, assigned_to),
         cost = COALESCE($4, cost),
         status = COALESCE($5, status),
         scheduled_for = COALESCE($6, scheduled_for),
         notes = COALESCE($7, notes),
         completed_at = CASE
           WHEN $5 IS NULL THEN completed_at
           WHEN $5 = 'DONE' THEN COALESCE(completed_at, NOW())
           ELSE NULL
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, input.vendorId ?? null, input.assignedTo ?? null, input.cost ?? null,
     input.status ?? null, input.scheduledFor ?? null, input.notes ?? null]
  );

  await logAudit({
    userId,
    action: 'WORK_ORDER_UPDATED',
    entity: 'work_orders',
    entityId: id,
    oldValue: { status: existing.status, cost: existing.cost },
    newValue: input,
  });
  return updated[0];
}
