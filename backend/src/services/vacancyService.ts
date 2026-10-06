import { query, queryOne } from '../config/db';
import { paginate } from './paginate';
import { logAudit } from './auditService';
import { badRequest, notFound } from '../utils/httpError';
import type { Pagination } from '../types';

// Vacancy marketing (ported from the legacy VacancyController): a listing per
// vacant-able unit that the operator publishes to the public board. The
// public endpoint returns marketing fields only — title, rent, description,
// photos, amenities — never tenant identity or internal ids beyond the
// listing's own.

export interface VacancyInput {
  unitId: number;
  title: string;
  description?: string;
  rentAmount: number;
  deposit?: number;
  amenities?: string[];
  isPublished?: boolean;
}

const LISTING_SELECT = `v.*, u.unit_number, u.unit_type, p.name AS property_name`;

const LISTING_TABLES = `FROM vacancy_listings v
  JOIN units u ON u.id = v.unit_id
  JOIN properties p ON p.id = u.property_id`;

export async function listVacancyListings(filters: {
  page: number;
  limit: number;
  published?: boolean;
  q?: string;
}): Promise<{ rows: Record<string, unknown>[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.published !== undefined) {
    params.push(filters.published);
    where.push(`v.is_published = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(v.title ILIKE $${params.length} OR p.name ILIKE $${params.length} OR u.unit_number ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return paginate<Record<string, unknown>>({
    selectSql: LISTING_SELECT,
    tableSql: LISTING_TABLES,
    whereSql,
    params,
    orderBy: `ORDER BY v.is_published DESC, v.created_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}

export async function createVacancyListing(input: VacancyInput, userId: number): Promise<Record<string, unknown>> {
  const unit = await queryOne<{ id: number; monthly_rent: string }>('SELECT id, monthly_rent FROM units WHERE id = $1', [input.unitId]);
  if (!unit) throw badRequest('The selected unit does not exist.');
  const inserted = await query<Record<string, unknown>>(
    `INSERT INTO vacancy_listings (unit_id, title, description, rent_amount, deposit, amenities, is_published, published_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, CASE WHEN $7 THEN NOW() ELSE NULL END, $8)
     RETURNING *`,
    [input.unitId, input.title, input.description ?? null, input.rentAmount,
     input.deposit ?? null, JSON.stringify(input.amenities ?? []), input.isPublished ?? false, userId]
  );
  await logAudit({
    userId,
    action: 'VACANCY_LISTING_CREATED',
    entity: 'vacancy_listings',
    entityId: inserted[0].id as number,
    newValue: input,
  });
  return inserted[0];
}

export async function updateVacancyListing(
  id: number,
  input: Partial<VacancyInput> & { photoUris?: string[] },
  userId: number
): Promise<Record<string, unknown>> {
  const existing = await queryOne<{ id: number; is_published: boolean }>(
    'SELECT id, is_published FROM vacancy_listings WHERE id = $1',
    [id]
  );
  if (!existing) throw notFound('Vacancy listing not found.');

  const publishToggle = input.isPublished !== undefined && input.isPublished !== existing.is_published;
  const updated = await query<Record<string, unknown>>(
    `UPDATE vacancy_listings
     SET unit_id = COALESCE($2, unit_id),
         title = COALESCE($3, title),
         description = COALESCE($4, description),
         rent_amount = COALESCE($5, rent_amount),
         deposit = COALESCE($6, deposit),
         amenities = COALESCE($7::jsonb, amenities),
         photos = COALESCE($8::jsonb, photos),
         is_published = COALESCE($9, is_published),
         published_at = CASE WHEN $10 THEN COALESCE(published_at, NOW()) ELSE published_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, input.unitId ?? null, input.title ?? null, input.description ?? null,
     input.rentAmount ?? null, input.deposit ?? null,
     input.amenities ? JSON.stringify(input.amenities) : null,
     input.photoUris ? JSON.stringify(input.photoUris) : null,
     input.isPublished ?? null, publishToggle && input.isPublished === true]
  );
  await logAudit({
    userId,
    action: 'VACANCY_LISTING_UPDATED',
    entity: 'vacancy_listings',
    entityId: id,
    oldValue: { isPublished: existing.is_published },
    newValue: { ...input, photoUris: undefined, photoCount: input.photoUris?.length },
  });
  return updated[0];
}

export async function deleteVacancyListing(id: number, userId: number): Promise<void> {
  const existing = await queryOne<{ title: string }>('SELECT title FROM vacancy_listings WHERE id = $1', [id]);
  if (!existing) throw notFound('Vacancy listing not found.');
  await query('DELETE FROM vacancy_listings WHERE id = $1', [id]);
  await logAudit({
    userId,
    action: 'VACANCY_LISTING_DELETED',
    entity: 'vacancy_listings',
    entityId: id,
    oldValue: { title: existing.title },
  });
}

// --- Public (unauthenticated) surface ----------------------------------------

export interface PublicListing {
  id: number;
  title: string;
  description: string | null;
  rentAmount: number;
  deposit: number | null;
  unitType: string;
  propertyName: string;
  photos: string[];
  amenities: string[];
}

export async function listPublicListings(): Promise<PublicListing[]> {
  const rows = await query<{
    id: number;
    title: string;
    description: string | null;
    rent_amount: string;
    deposit: string | null;
    unit_type: string;
    property_name: string;
    photos: string[];
    amenities: string[];
  }>(
    `SELECT v.id, v.title, v.description, v.rent_amount::text AS rent_amount,
            v.deposit::text AS deposit, u.unit_type, p.name AS property_name,
            v.photos, v.amenities
     FROM vacancy_listings v
     JOIN units u ON u.id = v.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE v.is_published
     ORDER BY v.rent_amount ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    rentAmount: Number(r.rent_amount),
    deposit: r.deposit === null ? null : Number(r.deposit),
    unitType: r.unit_type,
    propertyName: r.property_name,
    photos: Array.isArray(r.photos) ? r.photos : [],
    amenities: Array.isArray(r.amenities) ? r.amenities : [],
  }));
}

export async function recordListingView(id: number): Promise<void> {
  await query('UPDATE vacancy_listings SET views = views + 1 WHERE id = $1 AND is_published', [id]);
}

export interface InquiryInput {
  name: string;
  contact: string;
  message?: string;
}

export async function recordListingInquiry(id: number, input: InquiryInput): Promise<{ ok: true }> {
  // Fire-and-forget counter: a failed counter update must not fail the
  // visitor's inquiry.
  const result = await query<{ id: number }>(
    `UPDATE vacancy_listings SET inquiries = inquiries + 1 WHERE id = $1 AND is_published RETURNING id`,
    [id]
  );
  if (!result.length) throw notFound('This listing is no longer available.');
  await logAudit({
    userId: null,
    action: 'VACANCY_INQUIRY',
    entity: 'vacancy_listings',
    entityId: id,
    newValue: { name: input.name, contact: input.contact, message: input.message ?? null },
  });
  return { ok: true };
}
