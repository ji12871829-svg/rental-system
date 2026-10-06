import { query, queryOne } from '../config/db';
import { paginate } from './paginate';
import { logAudit } from './auditService';
import { notFound } from '../utils/httpError';
import type { Pagination } from '../types';

// Vendor directory — the skilled-trader contacts maintenance work orders are
// assigned to. Kept deliberately small: identity, contact, trade, a 1-5
// operator rating and an active flag so old traders can be retired without
// losing the history on their past work orders.

export interface VendorInput {
  name: string;
  service: string;
  phone?: string;
  email?: string;
  rating?: number;
  notes?: string;
  active?: boolean;
}

export interface VendorRow {
  id: number;
  name: string;
  service: string;
  phone: string | null;
  email: string | null;
  rating: number | null;
  notes: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function listVendors(filters: {
  page: number;
  limit: number;
  q?: string;
  service?: string;
  active?: boolean;
}): Promise<{ rows: VendorRow[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.service) {
    params.push(filters.service);
    where.push(`service = $${params.length}`);
  }
  if (filters.active !== undefined) {
    params.push(filters.active);
    where.push(`active = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return paginate<VendorRow>({
    selectSql: `*`,
    tableSql: `FROM vendors`,
    whereSql,
    params,
    orderBy: `ORDER BY active DESC, name ASC`,
    page: filters.page,
    limit: filters.limit,
  });
}

export async function createVendor(input: VendorInput, userId: number): Promise<VendorRow> {
  const inserted = await query<VendorRow>(
    `INSERT INTO vendors (name, service, phone, email, rating, notes, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [input.name, input.service, input.phone ?? null, input.email ?? null,
     input.rating ?? null, input.notes ?? null, input.active ?? true, userId]
  );
  await logAudit({ userId, action: 'VENDOR_CREATED', entity: 'vendors', entityId: inserted[0].id, newValue: input });
  return inserted[0];
}

export async function updateVendor(id: number, input: Partial<VendorInput>, userId: number): Promise<VendorRow> {
  const existing = await queryOne<VendorRow>('SELECT * FROM vendors WHERE id = $1', [id]);
  if (!existing) throw notFound('Vendor not found.');
  const updated = await query<VendorRow>(
    `UPDATE vendors
     SET name = COALESCE($2, name),
         service = COALESCE($3, service),
         phone = COALESCE($4, phone),
         email = COALESCE($5, email),
         rating = COALESCE($6, rating),
         notes = COALESCE($7, notes),
         active = COALESCE($8, active),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, input.name ?? null, input.service ?? null, input.phone ?? null,
     input.email ?? null, input.rating ?? null, input.notes ?? null,
     input.active ?? null]
  );
  await logAudit({
    userId,
    action: 'VENDOR_UPDATED',
    entity: 'vendors',
    entityId: id,
    oldValue: { name: existing.name, service: existing.service, active: existing.active, rating: existing.rating },
    newValue: input,
  });
  return updated[0];
}

export async function deleteVendor(id: number, userId: number): Promise<void> {
  const existing = await queryOne<VendorRow>('SELECT * FROM vendors WHERE id = $1', [id]);
  if (!existing) throw notFound('Vendor not found.');
  await query('DELETE FROM vendors WHERE id = $1', [id]);
  await logAudit({
    userId,
    action: 'VENDOR_DELETED',
    entity: 'vendors',
    entityId: id,
    oldValue: { name: existing.name, service: existing.service },
  });
}
