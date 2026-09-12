import { query, queryOne, withTransaction } from '../config/db';
import { paginate } from './paginate';
import type { Pagination } from '../types';
import { badRequest, conflict, notFound } from '../utils/httpError';
import { logAudit } from './auditService';
import { getBrandingView, type BrandingView } from './brandingService';

// --- Data-subject rights tooling (Kenya DPA 2019 / GDPR arts. 15–17) --------
//
// Export  = everything the system holds about one tenant, as a machine-
//           readable JSON bundle (right of access / portability).
// Erasure = anonymise personal identifiers (right to erasure). Financial
//           tables (rent_payments, water_payments, receipts) reference the
//           tenant with ON DELETE RESTRICT and MUST be retained for
//           accounting/tax, so erasure removes identity — not history — and
//           is refused while a tenancy is active (see the privacy policy).
// A full row delete for record-free tenants exists separately
// (DELETE /api/tenants/:id).

const ERASED_NAME = (id: number) => `Erased tenant #${id}`;
const ERASED_SMS = '[Erased on request — personal data removed]';

// --- Privacy request register ------------------------------------------------
// Every export/erasure is recorded with who requested it and why — the
// compliance trail required by Kenya DPA 2019 / GDPR accountability
// principles. Written by the service functions themselves, so no code path
// can serve personal data or erase it without leaving a register entry.
// Logging never throws — a register failure must not break the operation.
export type PrivacyRequestType = 'EXPORT_JSON' | 'EXPORT_CSV' | 'ERASURE';

export interface PrivacyRequestRow {
  id: number;
  tenant_id: number | null;
  request_type: PrivacyRequestType;
  requester: string;
  reason: string;
  performed_by: number | null;
  outcome: 'COMPLETED' | 'FAILED' | 'REFUSED';
  outcome_note: string | null;
  created_at: string;
  tenant_name?: string | null;
  performed_by_name?: string | null;
}

export async function logPrivacyRequest(entry: {
  tenantId: number | null;
  type: PrivacyRequestType;
  requester: string;
  reason: string;
  performedBy?: number | null;
  outcome?: 'COMPLETED' | 'FAILED' | 'REFUSED';
  outcomeNote?: string | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO privacy_requests
         (tenant_id, request_type, requester, reason, performed_by, outcome, outcome_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.tenantId,
        entry.type,
        entry.requester,
        entry.reason,
        entry.performedBy ?? null,
        entry.outcome ?? 'COMPLETED',
        entry.outcomeNote ?? null,
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[privacy] failed to write register entry:', err);
  }
}

// Variant for the response letter: the register entry's id becomes the
// letter reference ("DSAR-<id>") quoted in the letter body.
async function logPrivacyRequestReturningId(entry: {
  tenantId: number | null;
  type: PrivacyRequestType;
  requester: string;
  reason: string;
  performedBy?: number | null;
  outcome?: 'COMPLETED' | 'FAILED' | 'REFUSED';
  outcomeNote?: string | null;
}): Promise<number> {
  const res = await query<{ id: number }>(
    `INSERT INTO privacy_requests
       (tenant_id, request_type, requester, reason, performed_by, outcome, outcome_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      entry.tenantId,
      entry.type,
      entry.requester,
      entry.reason,
      entry.performedBy ?? null,
      entry.outcome ?? 'COMPLETED',
      entry.outcomeNote ?? null,
    ]
  );
  return res[0].id;
}

export interface PrivacyRequestFilters {
  page: number;
  limit: number;
  type?: string;
  outcome?: string;
  tenantId?: number;
  q?: string;
}

export async function listPrivacyRequests(
  filters: PrivacyRequestFilters
): Promise<{ rows: PrivacyRequestRow[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.type) {
    params.push(filters.type);
    where.push(`p.request_type = $${params.length}`);
  }
  if (filters.outcome) {
    params.push(filters.outcome);
    where.push(`p.outcome = $${params.length}`);
  }
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`p.tenant_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(p.requester ILIKE $${params.length} OR p.reason ILIKE $${params.length} OR t.full_name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return paginate<PrivacyRequestRow>({
    selectSql: `p.*, t.full_name AS tenant_name, u.name AS performed_by_name`,
    tableSql: `FROM privacy_requests p
     LEFT JOIN tenants t ON t.id = p.tenant_id
     LEFT JOIN users u ON u.id = p.performed_by`,
    whereSql,
    params,
    orderBy: `ORDER BY p.created_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}

interface TenantRow {
  id: number;
  unit_id: number | null;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  status: string;
}

async function getTenantRow(id: number): Promise<TenantRow> {
  const row = await queryOne<TenantRow>(
    `SELECT id, unit_id, full_name, phone_number, email, status FROM tenants WHERE id = $1`,
    [id]
  );
  if (!row) throw notFound('Tenant not found.');
  return row;
}

// Requester/reason captured from the admin UI — required for every register
// entry (who asked for this, and on what grounds).
export interface RegisterMeta {
  requester: string;
  reason: string;
  performedBy?: number | null;
}

async function buildExportBundle(id: number): Promise<Record<string, unknown>> {
  const subject = await getTenantRow(id);

  const [unit, rentPayments, waterPayments, waterReadings, receipts, smsNotifications, auditTrail] = await Promise.all([
    subject.unit_id
      ? queryOne(
          `SELECT id, unit_number, unit_type, monthly_rent, water_enabled, occupancy_status
           FROM units WHERE id = $1`,
          [subject.unit_id]
        )
      : Promise.resolve(null),
    query(`SELECT * FROM rent_payments WHERE tenant_id = $1 ORDER BY billing_year, billing_month`, [id]),
    query(`SELECT * FROM water_payments WHERE tenant_id = $1 ORDER BY billing_year, billing_month`, [id]),
    query(`SELECT * FROM water_meter_readings WHERE tenant_id = $1 ORDER BY billing_year, billing_month`, [id]),
    query(`SELECT * FROM receipts WHERE tenant_id = $1 ORDER BY billing_year, billing_month, id`, [id]),
    query(`SELECT id, receipt_id, phone_number, message, status, provider_message_id, sent_at, created_at
           FROM sms_notifications WHERE tenant_id = $1 ORDER BY created_at`, [id]),
    query(`SELECT id, action, entity, entity_id, old_value, new_value, user_id, created_at
           FROM audit_logs WHERE entity = 'tenants' AND entity_id = $1 ORDER BY created_at`, [id]),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    generatedBy: 'RPMS — data-subject access request (Kenya DPA 2019 / GDPR)',
    subject,
    unit,
    data: {
      rentPayments,
      waterPayments,
      waterReadings,
      receipts,
      smsNotifications,
      auditTrail,
    },
    retentionNote:
      'Financial records referenced above are retained by the operator for accounting and tax purposes even after a personal-data erasure request.',
  };
}

// Right of access / portability (JSON). When meta is provided the access is
// written to the privacy register; internal callers (CSV variant) omit it.
export async function exportTenantPersonalData(
  id: number,
  meta?: RegisterMeta
): Promise<Record<string, unknown>> {
  const bundle = await buildExportBundle(id);
  if (meta) {
    await logPrivacyRequest({ tenantId: id, type: 'EXPORT_JSON', ...meta });
  }
  return bundle;
}

// CSV variant of the access export: the same bundle flattened into a tidy
// (long-format) spreadsheet — one row per field, filterable by category and
// record. Arrays of records use the record's id (or receipt number) as ref.
const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote when the cell contains a comma, quote, newline, or a leading =+-@
  // (the last guards against CSV-formula injection in Excel).
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Formal response letter for a data-subject access request: the same export
// bundle as the JSON/CSV exports, plus the register reference of THIS request
// and the business identity (DB branding with env fallbacks already applied).
// The frontend renders it as the printable letter; the JSON blob rides along
// as the downloadable enclosure. The register entry is written exactly once
// (here) — the frontend must not log it again.
export interface DataRequestLetter {
  registerRef: string;
  generatedAt: string;
  responseDays: string | null;
  branding: BrandingView;
  bundle: Record<string, unknown>;
  /** Per-category record counts + money totals for the letter's summary section. */
  summary: {
    rentPayments: { count: number; total: number };
    waterPayments: { count: number; total: number };
    waterReadings: { count: number; total: number };
    receipts: { count: number; total: number };
    smsNotifications: { count: number };
    auditTrail: { count: number };
  };
}

// Per-category counts and money totals for the letter's export-summary
// section (the letter describes the scope; the JSON enclosure has the detail).
export function summarizeBundle(bundle: Record<string, unknown>): DataRequestLetter['summary'] {
  const data = (bundle.data ?? {}) as Record<string, Record<string, unknown>[]>;
  const stat = (key: string, field?: string): { count: number; total: number } => {
    const rows = data[key] ?? [];
    const total = field
      ? rows.reduce((sum, r) => sum + Number((r as Record<string, unknown>)[field] ?? 0), 0)
      : 0;
    return { count: rows.length, total: Math.round(total * 100) / 100 };
  };
  return {
    rentPayments: stat('rentPayments', 'amount'),
    waterPayments: stat('waterPayments', 'amount'),
    waterReadings: stat('waterReadings', 'water_bill'),
    receipts: stat('receipts', 'total_amount'),
    smsNotifications: stat('smsNotifications'),
    auditTrail: stat('auditTrail'),
  };
}

// meta: the register entry's requester/reason (required when creating a new
// letter). existingRegisterRef: when emailing an already-generated letter, the
// caller passes its DSAR-<id> so the response is reused — exactly one register
// entry per letter, never a duplicate on delivery.
export async function buildDataRequestLetter(
  id: number,
  meta: RegisterMeta | null,
  existingRegisterRef?: string
): Promise<DataRequestLetter> {
  const bundle = await buildExportBundle(id);

  let registerId: number;
  if (existingRegisterRef) {
    const match = /^DSAR-(\d+)$/.exec(existingRegisterRef);
    const refId = match ? Number(match[1]) : 0;
    const entry = refId
      ? await queryOne<{ id: number }>(
          `SELECT id FROM privacy_requests WHERE id = $1 AND tenant_id = $2 AND request_type = 'EXPORT_JSON'`,
          [refId, id]
        )
      : null;
    if (!entry) throw badRequest('Unknown register reference for this tenant — generate the letter first.');
    registerId = refId;
  } else if (meta) {
    registerId = await logPrivacyRequestReturningId({
      tenantId: id,
      type: 'EXPORT_JSON',
      ...meta,
    });
  } else {
    throw badRequest('A register reference or requester/reason is required.');
  }

  const branding = await getBrandingView();
  const generatedAt = new Date().toISOString();
  return {
    registerRef: `DSAR-${registerId}`,
    generatedAt,
    responseDays: branding.response_days,
    branding,
    bundle,
    summary: summarizeBundle(bundle),
  };
}

export async function exportTenantPersonalDataCsv(
  id: number,
  meta?: RegisterMeta
): Promise<string> {
  const bundle = (await buildExportBundle(id)) as {
    exportedAt: string;
    generatedBy: string;
    subject: Record<string, unknown>;
    unit: Record<string, unknown> | null;
    retentionNote: string;
    data: Record<string, Record<string, unknown>[]>;
  };
  if (meta) {
    await logPrivacyRequest({ tenantId: id, type: 'EXPORT_CSV', ...meta });
  }

  const rows: string[][] = [['category', 'record', 'field', 'value']];
  const emit = (category: string, record: string, obj: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object') continue; // nested objects: see the JSON export
      rows.push([category, record, field, value === null ? '' : String(value)]);
    }
  };

  emit('meta', 'export', { ...{ exportedAt: bundle.exportedAt, generatedBy: bundle.generatedBy }, retentionNote: bundle.retentionNote });
  emit('subject', `tenant-${id}`, bundle.subject);
  if (bundle.unit) emit('unit', `unit-${bundle.unit.id}`, bundle.unit);
  for (const [category, records] of Object.entries(bundle.data)) {
    for (const record of records) {
      const ref = (record as { receipt_number?: string }).receipt_number ?? `#${(record as { id?: number }).id}`;
      emit(category, `${category}-${ref}`, record);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// userId is null for system-triggered erasures (the automated retention sweep
// runs without an acting user; the audit trail records that).
export async function eraseTenantPersonalData(
  id: number,
  meta: RegisterMeta & { userId: number | null }
): Promise<Record<string, unknown>> {
  const tenant = await getTenantRow(id);
  if (tenant.status === 'ACTIVE') {
    // Refused erasures are register entries too — the attempt and its
    // grounds are part of the compliance trail.
    await logPrivacyRequest({
      tenantId: id,
      type: 'ERASURE',
      requester: meta.requester,
      reason: meta.reason,
      performedBy: meta.userId,
      outcome: 'REFUSED',
      outcomeNote: 'Tenancy still active — erasure refused under the retention policy.',
    });
    throw conflict(
      'Personal data for an active tenancy is retained under our privacy policy. Mark the tenant as moved out first.',
      'TENANT_ACTIVE'
    );
  }

  const erasedAt = new Date().toISOString();

  return withTransaction(async (client) => {
    // 1. Anonymise the tenant row — keep the contract/financial facts
    //    (unit, dates, deposit) that the records must stay explainable.
    const updated = await client.query(
      `UPDATE tenants
       SET full_name = $2, phone_number = NULL, email = NULL, notes = $3
       WHERE id = $1
       RETURNING *`,
      [id, ERASED_NAME(id), `Personal data erased on ${erasedAt} per data subject request.`]
    );

    // 2. Redact SMS history (messages contain the tenant's name and phone).
    //    RETURNING 1 turns the UPDATE into a countable result set.
    const sms = await client.query(
      `UPDATE sms_notifications
       SET phone_number = '', message = $2
       WHERE tenant_id = $1 RETURNING 1`,
      [id, ERASED_SMS]
    );

    // 3. Redact audit-trail JSON for this tenant (old/new values contain
    //    names and phone numbers). Who-did-what-when is preserved.
    const audit = await client.query(
      `UPDATE audit_logs
       SET old_value = '{"erased": true}'::jsonb, new_value = '{"erased": true}'::jsonb
       WHERE entity = 'tenants' AND entity_id = $1 RETURNING 1`,
      [id]
    );

    const summary = {
      erased: {
        tenantFields: ['full_name', 'phone_number', 'email', 'notes'],
        smsMessagesRedacted: sms.rows.length,
        auditEntriesRedacted: audit.rows.length,
        erasedAt,
      },
      kept: {
        reason: 'Accounting/tax retention — financial records are anonymised of identity but preserved.',
        rentPayments: Number(
          (await client.query(`SELECT COUNT(*)::text AS c FROM rent_payments WHERE tenant_id = $1`, [id])).rows[0].c
        ),
        waterPayments: Number(
          (await client.query(`SELECT COUNT(*)::text AS c FROM water_payments WHERE tenant_id = $1`, [id])).rows[0].c
        ),
        receipts: Number(
          (await client.query(`SELECT COUNT(*)::text AS c FROM receipts WHERE tenant_id = $1`, [id])).rows[0].c
        ),
      },
    };

    // 4. Record the erasure itself (no personal data in the audit entry).
    await logAudit({
      userId: meta.userId,
      action: 'TENANT_DATA_ERASED',
      entity: 'tenants',
      entityId: id,
      newValue: summary,
    });

    // 5. Register entry: who requested the erasure, why, and what happened.
    await logPrivacyRequest({
      tenantId: id,
      type: 'ERASURE',
      requester: meta.requester,
      reason: meta.reason,
      performedBy: meta.userId,
      outcome: 'COMPLETED',
      outcomeNote: `SMS messages redacted: ${summary.erased.smsMessagesRedacted}; audit entries redacted: ${summary.erased.auditEntriesRedacted}.`,
    });

    return { tenant: updated.rows[0], ...summary };
  });
}
