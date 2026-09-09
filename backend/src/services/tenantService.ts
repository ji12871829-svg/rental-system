import { query, queryOne, withTransaction } from '../config/db';
import type { Pagination } from '../types';
import { balanceDue } from '../utils/businessRules';
import { conflict, notFound, unprocessable } from '../utils/httpError';
import { n, round2 } from '../utils/money';
import { logAudit } from './auditService';

export interface TenantInput {
  unitId?: number | null;
  fullName: string;
  phoneNumber?: string;
  email?: string;
  moveInDate?: string;
  securityDeposit?: number;
  notes?: string;
}

export interface TenantFilters {
  page: number;
  limit: number;
  status?: string;
  unitId?: number;
  q?: string;
}

export async function listTenants(filters: TenantFilters): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`t.status = $${params.length}`);
  }
  if (filters.unitId) {
    params.push(filters.unitId);
    where.push(`t.unit_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(t.full_name ILIKE $${params.length} OR t.phone_number ILIKE $${params.length} OR t.email ILIKE $${params.length} OR u.unit_number ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM tenants t
     LEFT JOIN units u ON u.id = t.unit_id
     ${whereSql}`,
    params
  );
  const total = Number(totalRow?.count ?? 0);
  const offset = (filters.page - 1) * filters.limit;
  const rows = await query(
    `SELECT t.*, u.unit_number, u.unit_type, u.monthly_rent, u.water_enabled
     FROM tenants t
     LEFT JOIN units u ON u.id = t.unit_id
     ${whereSql}
     ORDER BY t.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset]
  );
  return {
    rows,
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
  };
}

export async function getTenant(id: number, reportingYear: number): Promise<unknown> {
  const row = await queryOne(
    `SELECT t.*, u.unit_number, u.unit_type, u.monthly_rent, u.water_enabled, u.occupancy_status
     FROM tenants t
     LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.id = $1`,
    [id]
  );
  if (!row) throw notFound('Tenant not found.');

  // Current balances from real transactions (spec §46).
  const rentPaid = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM rent_payments WHERE tenant_id = $1 AND billing_year = $2`, [id, reportingYear]
  ))?.v);
  const waterBilled = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(wmr.water_bill), 0)::text AS v
     FROM water_meter_readings wmr JOIN tenants t ON t.unit_id = wmr.unit_id
     WHERE t.id = $1 AND wmr.billing_year = $2`, [id, reportingYear]
  ))?.v);
  const waterPaid = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments WHERE tenant_id = $1 AND billing_year = $2`, [id, reportingYear]
  ))?.v);

  return {
    ...row,
    balances: {
      reportingYear,
      rentPaid,
      rentBalance: balanceDue(row.monthly_rent ? n(row.monthly_rent) : 0, rentPaid),
      waterBilled,
      waterPaid,
      waterBalance: balanceDue(waterBilled, waterPaid),
      combinedBalance: round2(balanceDue(row.monthly_rent ? n(row.monthly_rent) : 0, rentPaid) + balanceDue(waterBilled, waterPaid)),
    },
  };
}

async function assertUnitAvailable(unitId: number, excludeTenantId?: number): Promise<{ property_id: number; unit_number: string }> {
  const unit = await queryOne<{ id: number; property_id: number; unit_number: string }>(
    'SELECT id, property_id, unit_number FROM units WHERE id = $1', [unitId]
  );
  if (!unit) throw notFound('Unit not found.');
  const occupant = await queryOne<{ id: number }>(
    `SELECT id FROM tenants WHERE unit_id = $1 AND status = 'ACTIVE' ${excludeTenantId ? 'AND id <> $2' : ''} LIMIT 1`,
    excludeTenantId ? [unitId, excludeTenantId] : [unitId]
  );
  if (occupant) throw conflict(`Unit ${unit.unit_number} already has an active tenant.`, 'UNIT_OCCUPIED');
  return unit;
}

export async function createTenant(input: TenantInput, userId: number): Promise<unknown> {
  return withTransaction(async (client) => {
    let unitId: number | null = input.unitId ?? null;
    if (unitId) {
      await assertUnitAvailable(unitId);
    }
    const res = await client.query(
      `INSERT INTO tenants
         (unit_id, full_name, phone_number, email, move_in_date, security_deposit, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)
       RETURNING *`,
      [unitId, input.fullName, input.phoneNumber ?? null, input.email ?? null,
       input.moveInDate ?? null, input.securityDeposit ?? 0, input.notes ?? null]
    );
    if (unitId) {
      // Sync the unit's occupancy status in the same transaction.
      await client.query(`UPDATE units SET occupancy_status = 'OCCUPIED' WHERE id = $1`, [unitId]);
    }
    const tenant = res.rows[0];
    await logAudit({ userId, action: 'TENANT_CREATED', entity: 'tenants', entityId: tenant.id, newValue: input });
    return tenant;
  });
}

export async function updateTenant(id: number, input: Partial<TenantInput>, userId: number): Promise<unknown> {
  const existing = await queryOne<{ id: number; unit_id: number | null; full_name: string }>(
    'SELECT id, unit_id, full_name FROM tenants WHERE id = $1', [id]
  );
  if (!existing) throw notFound('Tenant not found.');

  // Changing the unit = transfer; must be free.
  if (input.unitId !== undefined && input.unitId !== existing.unit_id) {
    if (input.unitId === null) {
      throw unprocessable('To move a tenant out use the Move Out action, not a null unit.');
    }
    await assertUnitAvailable(input.unitId, id);
  }

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE tenants
       SET unit_id = COALESCE($2, unit_id),
           full_name = COALESCE($3, full_name),
           phone_number = COALESCE($4, phone_number),
           email = COALESCE($5, email),
           move_in_date = COALESCE($6, move_in_date),
           security_deposit = COALESCE($7, security_deposit),
           notes = COALESCE($8, notes)
       WHERE id = $1
       RETURNING *`,
      [id, input.unitId ?? null, input.fullName ?? null, input.phoneNumber ?? null,
       input.email ?? null, input.moveInDate ?? null, input.securityDeposit ?? null, input.notes ?? null]
    );
    if (input.unitId !== undefined && input.unitId !== existing.unit_id) {
      await client.query(`UPDATE units SET occupancy_status = 'OCCUPIED' WHERE id = $1`, [input.unitId]);
      if (existing.unit_id) {
      const stillOccupied = await client.query(
        `SELECT 1 FROM tenants WHERE unit_id = $1 AND status = 'ACTIVE' LIMIT 1`, [existing.unit_id]
      );
      if (stillOccupied.rows.length === 0) {
          await client.query(`UPDATE units SET occupancy_status = 'VACANT' WHERE id = $1`, [existing.unit_id]);
        }
      }
    }
    await logAudit({
      userId,
      action: 'TENANT_UPDATED',
      entity: 'tenants',
      entityId: id,
      oldValue: { unitId: existing.unit_id, fullName: existing.full_name },
      newValue: { unitId: input.unitId, fullName: input.fullName },
    });
    return res.rows[0];
  });
}

// Explicit transfer action (spec §8).
export async function transferTenant(id: number, newUnitId: number, userId: number): Promise<unknown> {
  return updateTenant(id, { unitId: newUnitId }, userId);
}

// Move out: marks MOVED_OUT, stamps move_out_date, frees the unit.
export async function moveOutTenant(id: number, moveOutDate: string, userId: number): Promise<unknown> {
  const existing = await queryOne<{ id: number; unit_id: number | null; full_name: string }>(
    'SELECT id, unit_id, full_name FROM tenants WHERE id = $1', [id]
  );
  if (!existing) throw notFound('Tenant not found.');
  if (!existing.unit_id) throw unprocessable('Tenant is not assigned to a unit.');

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE tenants SET status = 'MOVED_OUT', move_out_date = $2 WHERE id = $1 RETURNING *`,
      [id, moveOutDate]
    );
    await client.query(`UPDATE units SET occupancy_status = 'VACANT' WHERE id = $1`, [existing.unit_id]);
    await logAudit({ userId, action: 'TENANT_MOVED_OUT', entity: 'tenants', entityId: id, newValue: { moveOutDate } });
    return res.rows[0];
  });
}

export async function deleteTenant(id: number, userId: number): Promise<void> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM tenants WHERE id = $1', [id]);
  if (!existing) throw notFound('Tenant not found.');
  const references = await queryOne<{ count: string }>(
    `SELECT (SELECT COUNT(*) FROM rent_payments WHERE tenant_id = $1) +
            (SELECT COUNT(*) FROM water_payments WHERE tenant_id = $1) AS count`,
    [id]
  );
  if (Number(references?.count ?? 0) > 0) {
    throw conflict('Tenant has payment history and cannot be deleted. Mark them as moved out instead.', 'TENANT_HAS_HISTORY');
  }
  await query('DELETE FROM tenants WHERE id = $1', [id]);
  await logAudit({ userId, action: 'TENANT_DELETED', entity: 'tenants', entityId: id });
}