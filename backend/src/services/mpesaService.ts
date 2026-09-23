import { query, queryOne } from '../config/db';
import { createRentPayment } from './rentService';
import { parsePaybillReference, requestStkPush, type MpesaPaymentInput } from './mpesaProvider';
import { createWaterPayment } from './waterService';
import { n, round2 } from '../utils/money';
import { normalizePhoneNumber } from './smsProvider';
import { MONTH_NAMES } from '../types';
import { getSettings } from './settingsService';
import { prepareForUnmatchedPayment, sendEmailNotification } from './emailService';
import { isTest } from '../config/env';

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

function kenyaDateParts(date: Date): { date: string; month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    month: Number(values.month),
    year: Number(values.year),
  };
}

// ---------------------------------------------------------------------------
// Smart allocation — "the tenant just sends money" path.
//
// Money that arrives without the operator touching anything should land on
// what the tenant actually owes, oldest month first, exactly the way the
// ledger page says they owe it. The expected-rent query below is the tenant
// ledger's move-in-aware SQL verbatim (financeService.tenantLedger), so
// allocation can never disagree with what the ledger shows.
// ---------------------------------------------------------------------------

interface RentArrearsMonth {
  month: number;
  monthName: string;
  year: number;
  expectedRent: number;
  rentPaid: number;
  balance: number;
}

/**
 * The tenant's unpaid rent months for a calendar year, oldest first, computed
 * with the same move-in-aware expected-rent math as the tenant ledger.
 * Months before move-in (or after move-out) are excluded by the SQL itself —
 * their expected rent is NULL, not 0, so a new tenant's money is never
 * silently booked onto pre-move-in months.
 *
 * Exported for the allocation integration tests, which assert the arrears
 * view directly against the same fixtures the pipeline consumes.
 * @public
 */
export async function rentArrearsForYear(tenantId: number, year: number): Promise<RentArrearsMonth[]> {
  const rows = await query<{
    month: number; monthly_rent: string | null; paid: string;
  }>(
    `WITH months AS (SELECT generate_series(1, 12) AS m),
     tn AS (SELECT unit_id, move_in_date, move_out_date FROM tenants WHERE id = $1),
     rent AS (
       SELECT billing_month AS m, SUM(amount) AS paid
       FROM rent_payments WHERE tenant_id = $1 AND billing_year = $2::int
       GROUP BY billing_month
     )
     SELECT ms.m AS month,
            CASE WHEN tn.unit_id IS NULL THEN NULL
                 WHEN tn.move_in_date IS NOT NULL
                      AND tn.move_in_date <= (DATE ($2::text || '-01-01') + ms.m * INTERVAL '1 month' - INTERVAL '1 day')
                      AND (tn.move_out_date IS NULL OR tn.move_out_date >= (DATE ($2::text || '-01-01') + (ms.m - 1) * INTERVAL '1 month'))
                 THEN u.monthly_rent
                 ELSE NULL END AS monthly_rent,
            COALESCE(rp.paid, 0) AS paid
     FROM months ms
     LEFT JOIN rent rp ON rp.m = ms.m
     CROSS JOIN tn
     LEFT JOIN units u ON u.id = tn.unit_id
     ORDER BY ms.m`,
    [tenantId, year]
  );

  return rows
    .map((row) => {
      const expectedRent = row.monthly_rent === null ? 0 : n(row.monthly_rent);
      const rentPaid = n(row.paid);
      return {
        month: row.month,
        monthName: MONTH_NAMES[row.month - 1],
        year,
        expectedRent,
        rentPaid,
        balance: round2(expectedRent - rentPaid),
      };
    })
    .filter((m) => m.expectedRent > 0 && m.balance > 0);
}

/**
 * Split an incoming amount across arrears months, oldest first.
 * Anything left after every arrears month is cleared rides as one final
 * "credit" slice on the transaction's own month (the ledger shows it as an
 * overpayment there — visible, honest, and refundable at the office).
 *
 * Exported for the allocation unit tests (pure function, no I/O).
 * @public
 */
export function allocateAcrossArrears(
  arrears: RentArrearsMonth[],
  amount: number,
  fallbackMonth: number,
  fallbackYear: number
): Array<{ month: number; year: number; monthName: string; amount: number; part: number; parts: number }> {
  let remaining = round2(amount);
  const slices: Array<{ month: number; year: number; monthName: string; amount: number; part: number; parts: number }> = [];
  for (const m of arrears) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, m.balance);
    if (slice <= 0) continue;
    slices.push({ month: m.month, year: m.year, monthName: m.monthName, amount: round2(slice), part: 0, parts: 0 });
    remaining = round2(remaining - slice);
  }
  if (remaining > 0) {
    slices.push({
      month: fallbackMonth, year: fallbackYear,
      monthName: MONTH_NAMES[fallbackMonth - 1],
      amount: remaining, part: 0, parts: 0,
    });
  }
  const parts = slices.length;
  for (let i = 0; i < slices.length; i++) {
    slices[i].part = i + 1;
    slices[i].parts = parts;
  }
  return slices;
}

/**
 * Post a rent amount as one or more rent_payments (one per allocated month),
 * each through createRentPayment so every slice gets its own receipt number
 * and prepared receipt SMS. The mpesa_transactions row is flipped to POSTED
 * with the last slice's payment id. Returns the slice payment ids.
 */
/**
 * Exported for the staff review flow — a manually resolved UNMATCHED payment
 * must allocate exactly like the automatic path so both routes book money
 * onto the same arrears view.
 * @public
 */
export async function postRentWithAllocation(
  storedId: number,
  tenantId: number,
  amount: number,
  paymentDate: string,
  fallbackMonth: number,
  fallbackYear: number,
  paymentReference: string | undefined,
  source: MpesaSource,
  provenance: string
): Promise<number[]> {
  const year = fallbackYear;
  const arrears = await rentArrearsForYear(tenantId, year);
  const slices = allocateAcrossArrears(arrears, amount, fallbackMonth, fallbackYear);

  const paymentIds: number[] = [];
  let lastError: unknown = null;
  for (const slice of slices) {
    const partNote = slices.length > 1 ? ` (part ${slice.part}/${slice.parts} of ${round2(amount)})` : '';
    try {
      const result = await createRentPayment({
        tenantId,
        paymentDate,
        billingMonth: slice.month,
        billingYear: slice.year,
        amount: slice.amount,
        paymentMethod: 'M_PESA',
        paymentReference,
        notes: `Automatically posted from M-Pesa ${source} confirmation.${partNote} Allocated to ${slice.monthName} ${slice.year}.${provenance}`,
      }, null) as { payment: { id: number } };
      paymentIds.push(result.payment.id);
    } catch (error) {
      lastError = error;
      break;
    }
  }

  if (paymentIds.length === 0) {
    throw lastError ?? new Error('M-Pesa rent allocation posted no payments.');
  }
  await query(
    `UPDATE mpesa_transactions
     SET status = 'POSTED', rent_payment_id = $2, error_message = NULL
     WHERE id = $1`,
    [storedId, paymentIds[paymentIds.length - 1]]
  );
  return paymentIds;
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
