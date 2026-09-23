import { query, queryOne } from '../config/db';
import { createRentPayment } from './rentService';
import { createWaterPayment } from './waterService';
import { logAudit } from './auditService';
import { badRequest, notFound } from '../utils/httpError';
import { normalizePhoneNumber } from './smsProvider';
import { postRentWithAllocation } from './mpesaService';

/**
 * The likely tenant for an unmatched payment, identified by the sender's
 * phone number (normalized both sides — 07…/2547…/+2547… all compare equal).
 * The auto path refuses to guess on ambiguity; the review page surfaces this
 * as a SUGGESTION so staff don't have to do the detective work. Returns null
 * when the phone is unknown, matches nobody, or matches several tenants.
 */
async function suggestTenantByPhone(rawPhone: string | null): Promise<{ id: number; full_name: string; unit_number: string | null } | null> {
  if (!rawPhone) return null;
  const normalized = normalizePhoneNumber(rawPhone);
  if (!normalized) return null;
  const candidates = await query<{ id: number; full_name: string; unit_number: string | null; phone_number: string }>(
    `SELECT t.id, t.full_name, u.unit_number, t.phone_number
     FROM tenants t LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.status = 'ACTIVE' AND t.phone_number IS NOT NULL AND TRIM(t.phone_number) <> ''`
  );
  const matches = candidates.filter((c) => normalizePhoneNumber(c.phone_number) === normalized);
  return matches.length === 1 ? matches[0] : null;
}

export async function listMpesaReviewTransactions(): Promise<unknown[]> {
  const rows = await query<{
    id: number; transaction_id: string; amount: string; account_reference: string; payment_kind: string;
    transaction_date: Date; phone_number: string | null; status: string; error_message: string | null;
    created_at: Date; tenant_name: string | null; unit_number: string | null;
  }>(
    `SELECT m.id, m.transaction_id, m.amount, m.account_reference, m.payment_kind,
            m.transaction_date, m.phone_number, m.status, m.error_message, m.created_at,
            t.full_name AS tenant_name, u.unit_number
     FROM mpesa_transactions m
     LEFT JOIN tenants t ON t.id = m.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id
     WHERE m.source = 'C2B' AND m.status IN ('UNMATCHED', 'AMBIGUOUS', 'FAILED')
     ORDER BY m.created_at DESC`
  );
  // One suggested tenant per row (null when the phone identifies nobody
  // unambiguously) — the review page preselects it, staff confirm.
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    transaction_id: row.transaction_id,
    amount: Number(row.amount),
    account_reference: row.account_reference,
    payment_kind: row.payment_kind,
    transaction_date: row.transaction_date,
    phone_number: row.phone_number,
    status: row.status,
    error_message: row.error_message,
    created_at: row.created_at,
    tenant_name: row.tenant_name,
    unit_number: row.unit_number,
    suggested_tenant: await suggestTenantByPhone(row.phone_number),
  })));
}

export async function ignoreMpesaReviewTransaction(id: number, userId: number): Promise<void> {
  const row = await queryOne<{ id: number; status: string }>(
    `SELECT id, status FROM mpesa_transactions WHERE id = $1 AND source = 'C2B'`,
    [id]
  );
  if (!row) throw notFound('M-Pesa transaction not found.');
  if (row.status === 'POSTED') throw badRequest('Posted transactions cannot be ignored.');
  await query(`UPDATE mpesa_transactions SET status = 'FAILED', error_message = 'Ignored by staff review' WHERE id = $1`, [id]);
  await logAudit({ userId, action: 'MPESA_TRANSACTION_IGNORED', entity: 'mpesa_transactions', entityId: id });
}

export async function resolveMpesaReviewTransaction(
  id: number,
  tenantId: number,
  kind: 'RENT' | 'WATER',
  userId: number,
  allocate = true
): Promise<unknown> {
  const transaction = await queryOne<{
    id: number; transaction_id: string; amount: string; transaction_date: Date;
    status: string; account_reference: string;
  }>(
    `SELECT id, transaction_id, amount, transaction_date, status, account_reference
     FROM mpesa_transactions WHERE id = $1 AND source = 'C2B' FOR UPDATE`,
    [id]
  );
  if (!transaction) throw notFound('M-Pesa transaction not found.');
  if (transaction.status === 'POSTED') throw badRequest('M-Pesa transaction is already posted.');

  const tenant = await queryOne<{ id: number; unit_id: number; status: string; water_enabled: boolean }>(
    `SELECT t.id, t.unit_id, t.status, u.water_enabled
     FROM tenants t JOIN units u ON u.id = t.unit_id WHERE t.id = $1`,
    [tenantId]
  );
  if (!tenant || tenant.status !== 'ACTIVE') throw badRequest('Selected tenant is not active.');
  if (kind === 'WATER' && !tenant.water_enabled) throw badRequest('Water billing is disabled for the selected unit.');

  const date = new Date(transaction.transaction_date);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const paymentDate = `${values.year}-${values.month}-${values.day}`;
  const month = Number(values.month);
  const year = Number(values.year);
  let paymentId: number;
  if (kind === 'WATER') {
    const result = await createWaterPayment({ tenantId, paymentDate, billingMonth: month, billingYear: year, amount: Number(transaction.amount), paymentMethod: 'M_PESA', notes: `Manually resolved M-Pesa C2B transaction ${transaction.transaction_id}.` }, userId) as { payment: { id: number } };
    paymentId = result.payment.id;
    await query(`UPDATE mpesa_transactions SET status = 'POSTED', tenant_id = $2, payment_kind = 'WATER', water_payment_id = $3, error_message = NULL WHERE id = $1`, [id, tenantId, paymentId]);
  } else {
    // Rent goes through the SAME oldest-arrears allocation as the automatic
    // path, so a manually resolved payment books onto what the tenant
    // actually owes (splitting across months with one receipt each) instead
    // of silently landing on the transaction's own month and leaving the
    // real arrears standing. `allocate` lets staff force the old
    // exact-to-transaction-month behavior when a correction needs it.
    if (allocate) {
      const paymentIds = await postRentWithAllocation(
        id, tenantId, Number(transaction.amount), paymentDate, month, year,
        transaction.transaction_id, 'C2B',
        ` Manually resolved by staff from review (original reference "${transaction.account_reference}").`
      );
      paymentId = paymentIds[paymentIds.length - 1];
      // postRentWithAllocation stamps status/rent_payment_id but not the
      // tenant — record who staff assigned so review listings join correctly.
      await query(`UPDATE mpesa_transactions SET tenant_id = $2 WHERE id = $1`, [id, tenantId]);
    } else {
      const result = await createRentPayment({ tenantId, paymentDate, billingMonth: month, billingYear: year, amount: Number(transaction.amount), paymentMethod: 'M_PESA', paymentReference: transaction.transaction_id, notes: `Manually resolved M-Pesa C2B transaction ${transaction.transaction_id}.` }, userId) as { payment: { id: number } };
      paymentId = result.payment.id;
      await query(`UPDATE mpesa_transactions SET status = 'POSTED', tenant_id = $2, payment_kind = 'RENT', rent_payment_id = $3, error_message = NULL WHERE id = $1`, [id, tenantId, paymentId]);
    }
  }
  await logAudit({ userId, action: 'MPESA_TRANSACTION_RESOLVED', entity: 'mpesa_transactions', entityId: id, newValue: { originalReference: transaction.account_reference, tenantId, kind, paymentId } });
  return { paymentId, kind, tenantId };
}