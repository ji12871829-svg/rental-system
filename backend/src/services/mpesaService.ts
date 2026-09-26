import { query, queryOne } from '../config/db';
import { parsePaybillReference, requestStkPush, type MpesaPaymentInput } from './mpesaProvider';
import { createWaterPayment } from './waterService';
import { normalizePhoneNumber } from './smsProvider';
import { MONTH_NAMES } from '../types';
import { getSettings } from './settingsService';
import { prepareForUnmatchedPayment, sendEmailNotification } from './emailService';
import { isTest } from '../config/env';
import { kenyaDateParts } from '../utils/kenyaTime';
// Oldest-arrears allocation engine (rentArrearsForYear, allocateAcrossArrears,
// postRentWithAllocation) lives in ./rentAllocation — shared verbatim with the
// manual review path so both book onto the same arrears view. Re-exported here
// so existing import paths (routes, review service, integration tests) keep
// resolving. allocateAcrossArrears stays internal to rentAllocation — its
// consumers are all inside that module.
import { postRentWithAllocation } from './rentAllocation';
export { rentArrearsForYear, postRentWithAllocation } from './rentAllocation';

export type MpesaSource = 'C2B' | 'STK';

interface StoredMpesaTransaction {
  id: number;
  transaction_id: string | null;
  checkout_request_id: string | null;
  account_reference: string;
  status: string;
  tenant_id: number | null;
  rent_payment_id: number | null;
}

/**
 * Sender-phone fallback (RENT only): the paybill reference did not name a
 * unit, so try to identify the tenant by the MSISDN the money came from.
 * Comparison is on normalized numbers so 07…, 2547…, and +2547… all match.
 * Only an unambiguous single match posts — zero or several candidates stay
 * UNMATCHED for manual review (silently crediting the wrong tenant would be
 * worse than a human looking at it).
 */
async function tenantBySenderPhone(rawPhone: string | null | undefined): Promise<{ id: number; fullName: string } | null> {
  if (!rawPhone) return null;
  const normalized = normalizePhoneNumber(rawPhone);
  if (!normalized) return null;

  const candidates = await query<{ id: number; full_name: string; phone_number: string }>(
    `SELECT t.id, t.full_name, t.phone_number
     FROM tenants t
     WHERE t.status = 'ACTIVE' AND t.phone_number IS NOT NULL AND TRIM(t.phone_number) <> ''`,
  );
  const matches = candidates.filter((c) => normalizePhoneNumber(c.phone_number) === normalized);
  return matches.length === 1 ? { id: matches[0].id, fullName: matches[0].full_name } : null;
}

/**
 * Operator email alert: a payment just landed in the review queue. Fire once
 * per transaction — `firstAttempt` gates it on the row still being RECEIVED
 * when processing began, so a provider replay of an already-flagged row
 * re-evaluates the match but never re-emails — and never throw: an alert
 * must not fail the payment pipeline that called it.
 */
async function notifyOperatorOfUnmatched(input: {
  status: 'UNMATCHED' | 'AMBIGUOUS';
  transactionId: string;
  amount: number;
  accountReference: string;
  phoneNumber: string | null;
  transactionDate: Date;
  reason: string | null;
  firstAttempt: boolean;
}): Promise<void> {
  if (!input.firstAttempt) return;
  try {
    const settings = await getSettings();
    const billing = kenyaDateParts(input.transactionDate);
    const queued = await prepareForUnmatchedPayment({
      status: input.status,
      transactionId: input.transactionId,
      amount: input.amount,
      accountReference: input.accountReference,
      senderPhone: input.phoneNumber,
      payDate: billing.date,
      payMonthLabel: `${MONTH_NAMES[billing.month - 1]} ${billing.year}`,
      currency: settings.currency || 'KSh',
      reason: input.reason,
    });
    // Operational alert: dispatch immediately (same as the staff-request
    // notification) — a PENDING row nobody sends is not an alert. Skipped in
    // tests so assertions see a deterministic PENDING row.
    if (queued && !isTest) {
      setTimeout(() => {
        sendEmailNotification(queued.id).catch((err) =>
          // eslint-disable-next-line no-console
          console.error(`[mpesa] operator alert send failed (${input.transactionId}): ${(err as Error).message}`),
        );
      }, 0);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[mpesa] operator alert failed for ${input.transactionId}: ${(err as Error).message}`);
  }
}

async function markUnmatched(id: number, reason: string): Promise<void> {
  await query(
    `UPDATE mpesa_transactions
     SET status = 'UNMATCHED', error_message = $2
     WHERE id = $1`,
    [id, reason]
  );
}
export async function processMpesaPayment(input: MpesaPaymentInput, source: MpesaSource): Promise<{
  status: 'POSTED' | 'UNMATCHED' | 'DUPLICATE';
  tenantId?: number;
  paymentId?: number;
  reason?: string;
}> {
  let stored: StoredMpesaTransaction | null = input.checkoutRequestId
    ? await queryOne<StoredMpesaTransaction>(
        `SELECT id, transaction_id, checkout_request_id, account_reference, status, tenant_id, rent_payment_id
         FROM mpesa_transactions WHERE checkout_request_id = $1`,
        [input.checkoutRequestId]
      )
    : null;

  if (stored?.status === 'POSTED') {
    return { status: 'DUPLICATE', tenantId: stored.tenant_id ?? undefined, paymentId: stored.rent_payment_id ?? undefined };
  }

  if (!stored && input.transactionId) {
    stored = await queryOne<StoredMpesaTransaction>(
      `SELECT id, transaction_id, checkout_request_id, account_reference, status, tenant_id, rent_payment_id
       FROM mpesa_transactions WHERE transaction_id = $1`,
      [input.transactionId]
    );
    if (stored) return { status: 'DUPLICATE', tenantId: stored.tenant_id ?? undefined, paymentId: stored.rent_payment_id ?? undefined };
  }

  if (!stored) {
    const inserted = await query<StoredMpesaTransaction>(
      `INSERT INTO mpesa_transactions
         (source, transaction_id, checkout_request_id, merchant_request_id, account_reference,
          amount, transaction_date, phone_number, raw_payload, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'RECEIVED')
       ON CONFLICT DO NOTHING
       RETURNING id, transaction_id, checkout_request_id, account_reference, status, tenant_id, rent_payment_id`,
      [
        source, input.transactionId, input.checkoutRequestId ?? null, input.merchantRequestId ?? null,
        input.accountReference, input.amount, input.transactionDate, input.phoneNumber,
        JSON.stringify(input.rawPayload ?? {}),
      ]
    );
    stored = inserted[0] ?? null;
    if (!stored) {
      const duplicate = await queryOne<StoredMpesaTransaction>(
        `SELECT id, transaction_id, checkout_request_id, account_reference, status, tenant_id, rent_payment_id
         FROM mpesa_transactions WHERE transaction_id = $1 OR checkout_request_id = $2
         LIMIT 1`,
        [input.transactionId, input.checkoutRequestId ?? null]
      );
      return { status: 'DUPLICATE', tenantId: duplicate?.tenant_id ?? undefined, paymentId: duplicate?.rent_payment_id ?? undefined };
    }
  } else if (input.transactionId) {
    await query(
      `UPDATE mpesa_transactions
       SET transaction_id = COALESCE(transaction_id, $2), amount = $3, transaction_date = $4,
           phone_number = COALESCE(phone_number, $5), raw_payload = $6::jsonb
       WHERE id = $1`,
      [stored.id, input.transactionId, input.amount, input.transactionDate, input.phoneNumber, JSON.stringify(input.rawPayload ?? {})]
    );
  }

  const accountReference = stored.account_reference.trim();
  let tenant = await queryOne<{ id: number; status: string }>(
    `SELECT t.id, t.status
     FROM tenants t
     JOIN units u ON u.id = t.unit_id
     WHERE u.unit_number = $1 AND t.status = 'ACTIVE'
     LIMIT 1`,
    [accountReference]
  );
  let provenance = '';
  if (!tenant) {
    // The reference didn't name a unit — fall back to the sender's phone
    // number (rent intent is assumed for STK; the push flow only collects
    // rent today). Unambiguous single match only.
    const byPhone = await tenantBySenderPhone(input.phoneNumber);
    if (byPhone) {
      const row = await queryOne<{ id: number; status: string }>(
        'SELECT id, status FROM tenants WHERE id = $1',
        [byPhone.id]
      );
      if (row?.status === 'ACTIVE') {
        tenant = row;
        provenance = ` Account reference "${accountReference}" did not name a unit; tenant matched by sender phone number.`;
      }
    }
  }
  if (!tenant) {
    const reason = `No active tenant matched unit reference ${accountReference}.`;
    await markUnmatched(stored.id, reason);
    await notifyOperatorOfUnmatched({
      status: 'UNMATCHED',
      transactionId: input.transactionId || `STK-${stored.checkout_request_id ?? stored.id}`,
      amount: input.amount,
      accountReference,
      phoneNumber: input.phoneNumber,
      transactionDate: input.transactionDate,
      reason,
      firstAttempt: stored.status === 'RECEIVED',
    });
    return { status: 'UNMATCHED', reason };
  }

  await query(
    `UPDATE mpesa_transactions SET status = 'MATCHED', tenant_id = $2, error_message = NULL WHERE id = $1`,
    [stored.id, tenant.id]
  );

  try {
    const billing = kenyaDateParts(input.transactionDate);
    const paymentIds = await postRentWithAllocation(
      stored.id, tenant.id, input.amount, billing.date, billing.month, billing.year,
      input.transactionId, source, provenance
    );
    return { status: 'POSTED', tenantId: tenant.id, paymentId: paymentIds[paymentIds.length - 1] };
  } catch (error) {
    await query(
      `UPDATE mpesa_transactions SET status = 'FAILED', error_message = $2 WHERE id = $1`,
      [stored.id, (error as Error).message]
    );
    throw error;
  }
}

export async function processPaybillPayment(input: MpesaPaymentInput): Promise<{
  status: 'POSTED' | 'UNMATCHED' | 'AMBIGUOUS' | 'DUPLICATE';
  tenantId?: number;
  paymentId?: number;
  waterPaymentId?: number;
  reason?: string;
}> {
  const parsed = parsePaybillReference(input.accountReference);
  const existing = await queryOne<StoredMpesaTransaction>(
    `SELECT id, transaction_id, checkout_request_id, account_reference, status, tenant_id, rent_payment_id
     FROM mpesa_transactions WHERE transaction_id = $1`,
    [input.transactionId]
  );
  if (existing?.status === 'POSTED') {
    return { status: 'DUPLICATE', tenantId: existing.tenant_id ?? undefined, paymentId: existing.rent_payment_id ?? undefined };
  }

  const inserted = await query<StoredMpesaTransaction>(
    // transaction_id is a PARTIAL unique index (WHERE transaction_id IS NOT
    // NULL); Postgres only infers it as a conflict target when the index
    // predicate is restated here. Without this, every C2B confirmation replay
    // dies with "no unique or exclusion constraint matching the ON CONFLICT
    // specification" and Daraja retries forever. NOTE: keep the newlines —
    // a line comment inside this template would swallow the ON CONFLICT
    // clause if the statement were ever collapsed to one line.
    `INSERT INTO mpesa_transactions
       (source, transaction_id, account_reference, amount, transaction_date, phone_number, payment_kind, raw_payload, status)
     VALUES ('C2B', $1, $2, $3, $4, $5, $6, $7::jsonb, 'RECEIVED')
     ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
     RETURNING id, transaction_id, checkout_request_id, account_reference, status, tenant_id, rent_payment_id`,
    [input.transactionId, input.accountReference.trim(), input.amount, input.transactionDate, input.phoneNumber, parsed.kind, JSON.stringify(input.rawPayload ?? {})]
  );
  const stored = inserted[0] ?? await queryOne<StoredMpesaTransaction>(
    `SELECT id, transaction_id, checkout_request_id, account_reference, status, tenant_id, rent_payment_id
     FROM mpesa_transactions WHERE transaction_id = $1`,
    [input.transactionId]
  );
  if (!stored) throw new Error('Could not store M-Pesa transaction.');
  if (stored.status === 'POSTED') return { status: 'DUPLICATE', tenantId: stored.tenant_id ?? undefined, paymentId: stored.rent_payment_id ?? undefined };

  let tenants = await query<{ id: number; unit_id: number; unit_number: string; status: string; water_enabled: boolean }>(
    `SELECT t.id, t.unit_id, u.unit_number, t.status, u.water_enabled
     FROM tenants t JOIN units u ON u.id = t.unit_id
     WHERE UPPER(TRIM(u.unit_number)) = $1 AND t.status = 'ACTIVE'`,
    [parsed.normalizedUnitNumber]
  );
  let provenance = '';
  if (tenants.length === 0 && parsed.kind === 'RENT') {
    // The reference didn't name a unit — fall back to the sender's phone
    // number. Rent only: a water payment belongs to a specific metered unit,
    // so a wrong reference there must go to manual review, not a guess.
    const byPhone = await tenantBySenderPhone(input.phoneNumber);
    if (byPhone) {
      tenants = await query<{ id: number; unit_id: number; unit_number: string; status: string; water_enabled: boolean }>(
        `SELECT t.id, t.unit_id, u.unit_number, t.status, u.water_enabled
         FROM tenants t JOIN units u ON u.id = t.unit_id
         WHERE t.id = $1 AND t.status = 'ACTIVE'`,
        [byPhone.id]
      );
      provenance = ` Account reference "${parsed.normalizedUnitNumber}" did not name a unit; tenant matched by sender phone number.`;
    }
  }
  if (tenants.length === 0) {
    const reason = `No active tenant matched unit reference ${parsed.normalizedUnitNumber}.`;
    await query(`UPDATE mpesa_transactions SET status = 'UNMATCHED', error_message = $2 WHERE id = $1`, [stored.id, reason]);
    await notifyOperatorOfUnmatched({
      status: 'UNMATCHED',
      transactionId: input.transactionId,
      amount: input.amount,
      accountReference: input.accountReference.trim(),
      phoneNumber: input.phoneNumber,
      transactionDate: input.transactionDate,
      reason,
      firstAttempt: stored.status === 'RECEIVED',
    });
    return { status: 'UNMATCHED', reason };
  }
  if (tenants.length !== 1) {
    const reason = `Multiple active tenants matched unit reference ${parsed.normalizedUnitNumber}.`;
    await query(`UPDATE mpesa_transactions SET status = 'AMBIGUOUS', error_message = $2 WHERE id = $1`, [stored.id, reason]);
    await notifyOperatorOfUnmatched({
      status: 'AMBIGUOUS',
      transactionId: input.transactionId,
      amount: input.amount,
      accountReference: input.accountReference.trim(),
      phoneNumber: input.phoneNumber,
      transactionDate: input.transactionDate,
      reason,
      firstAttempt: stored.status === 'RECEIVED',
    });
    return { status: 'AMBIGUOUS', reason };
  }
  const tenant = tenants[0];
  if (parsed.kind === 'WATER' && !tenant.water_enabled) {
    const reason = 'Water billing is disabled for this unit.';
    await query(`UPDATE mpesa_transactions SET status = 'UNMATCHED', error_message = $2 WHERE id = $1`, [stored.id, reason]);
    return { status: 'UNMATCHED', tenantId: tenant.id, reason };
  }

  await query(`UPDATE mpesa_transactions SET status = 'MATCHED', tenant_id = $2, error_message = NULL WHERE id = $1`, [stored.id, tenant.id]);
  const billing = kenyaDateParts(input.transactionDate);
  if (parsed.kind === 'WATER') {
    const result = await createWaterPayment({ tenantId: tenant.id, paymentDate: billing.date, billingMonth: billing.month, billingYear: billing.year, amount: input.amount, paymentMethod: 'M_PESA', notes: `Automatically posted from M-Pesa C2B confirmation.` }, null) as { payment: { id: number } };
    await query(`UPDATE mpesa_transactions SET status = 'POSTED', water_payment_id = $2 WHERE id = $1`, [stored.id, result.payment.id]);
    return { status: 'POSTED', tenantId: tenant.id, waterPaymentId: result.payment.id };
  }
  // Rent: allocate across the tenant's oldest arrears months (each slice
  // through createRentPayment → receipt → prepared receipt SMS), falling back
  // to the transaction's own month once every arrears month is clear.
  const paymentIds = await postRentWithAllocation(
    stored.id, tenant.id, input.amount, billing.date, billing.month, billing.year,
    input.transactionId, 'C2B', provenance
  );
  return { status: 'POSTED', tenantId: tenant.id, paymentId: paymentIds[paymentIds.length - 1] };
}

export async function markStkFailure(checkoutRequestId: string, reason: string, rawPayload: unknown): Promise<void> {
  await query(
    `UPDATE mpesa_transactions
     SET status = 'FAILED', error_message = $2, raw_payload = $3::jsonb
     WHERE checkout_request_id = $1 AND status <> 'POSTED'`,
    [checkoutRequestId, reason, JSON.stringify(rawPayload ?? {})]
  );
}

export async function initiateTenantStkPush(tenantId: number, amount: number): Promise<{
  checkoutRequestId: string;
  merchantRequestId?: string;
  accountReference: string;
}> {
  const tenant = await queryOne<{ id: number; phone_number: string | null; unit_number: string; status: string }>(
    `SELECT t.id, t.phone_number, u.unit_number, t.status
     FROM tenants t JOIN units u ON u.id = t.unit_id WHERE t.id = $1`,
    [tenantId]
  );
  if (!tenant) throw new Error('Tenant not found.');
  if (tenant.status !== 'ACTIVE') throw new Error('Tenant has moved out.');
  if (!tenant.phone_number) throw new Error('Tenant has no phone number for STK Push.');
  const accountReference = tenant.unit_number;
  const request = await requestStkPush({
    phoneNumber: tenant.phone_number,
    amount,
    accountReference,
    transactionDescription: `Olbano Plaza rent for unit ${accountReference}`,
  });
  await query(
    // Partial-index conflict target — see the note in processPaybillPayment.
    `INSERT INTO mpesa_transactions
       (source, checkout_request_id, merchant_request_id, account_reference, amount, phone_number, raw_payload, status)
     VALUES ('STK', $1, $2, $3, $4, $5, $6::jsonb, 'RECEIVED')
     ON CONFLICT (checkout_request_id) WHERE checkout_request_id IS NOT NULL DO NOTHING`,
    [request.checkoutRequestId, request.merchantRequestId ?? null, accountReference, amount, tenant.phone_number, JSON.stringify({ request })]
  );
  return { ...request, accountReference };
}
