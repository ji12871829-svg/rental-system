import { query, queryOne } from '../config/db';
import { createRentPayment } from './rentService';
import { parsePaybillReference, requestStkPush, type MpesaPaymentInput } from './mpesaProvider';
import { createWaterPayment } from './waterService';

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
  const tenant = await queryOne<{ id: number; status: string }>(
    `SELECT t.id, t.status
     FROM tenants t
     JOIN units u ON u.id = t.unit_id
     WHERE u.unit_number = $1 AND t.status = 'ACTIVE'
     LIMIT 1`,
    [accountReference]
  );
  if (!tenant) {
    const reason = `No active tenant matched unit reference ${accountReference}.`;
    await markUnmatched(stored.id, reason);
    return { status: 'UNMATCHED', reason };
  }

  await query(
    `UPDATE mpesa_transactions SET status = 'MATCHED', tenant_id = $2, error_message = NULL WHERE id = $1`,
    [stored.id, tenant.id]
  );

  try {
    const billing = kenyaDateParts(input.transactionDate);
    const result = await createRentPayment({
      tenantId: tenant.id,
      paymentDate: billing.date,
      billingMonth: billing.month,
      billingYear: billing.year,
      amount: input.amount,
      paymentMethod: 'M_PESA',
      paymentReference: input.transactionId,
      notes: `Automatically posted from M-Pesa ${source} confirmation.`,
    }, null) as { payment: { id: number } };
    await query(
      `UPDATE mpesa_transactions
       SET status = 'POSTED', rent_payment_id = $2, error_message = NULL
       WHERE id = $1`,
      [stored.id, result.payment.id]
    );
    return { status: 'POSTED', tenantId: tenant.id, paymentId: result.payment.id };
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
    `INSERT INTO mpesa_transactions
       (source, transaction_id, account_reference, amount, transaction_date, phone_number, payment_kind, raw_payload, status)
     VALUES ('C2B', $1, $2, $3, $4, $5, $6, $7::jsonb, 'RECEIVED')
     ON CONFLICT (transaction_id) DO NOTHING
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

  const tenants = await query<{ id: number; unit_id: number; unit_number: string; status: string; water_enabled: boolean }>(
    `SELECT t.id, t.unit_id, u.unit_number, t.status, u.water_enabled
     FROM tenants t JOIN units u ON u.id = t.unit_id
     WHERE UPPER(TRIM(u.unit_number)) = $1 AND t.status = 'ACTIVE'`,
    [parsed.normalizedUnitNumber]
  );
  if (tenants.length === 0) {
    await query(`UPDATE mpesa_transactions SET status = 'UNMATCHED', error_message = $2 WHERE id = $1`, [stored.id, `No active tenant matched unit reference ${parsed.normalizedUnitNumber}.`]);
    return { status: 'UNMATCHED', reason: `No active tenant matched unit reference ${parsed.normalizedUnitNumber}.` };
  }
  if (tenants.length !== 1) {
    await query(`UPDATE mpesa_transactions SET status = 'AMBIGUOUS', error_message = $2 WHERE id = $1`, [stored.id, `Multiple active tenants matched unit reference ${parsed.normalizedUnitNumber}.`]);
    return { status: 'AMBIGUOUS', reason: `Multiple active tenants matched unit reference ${parsed.normalizedUnitNumber}.` };
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
  const result = await createRentPayment({ tenantId: tenant.id, paymentDate: billing.date, billingMonth: billing.month, billingYear: billing.year, amount: input.amount, paymentMethod: 'M_PESA', paymentReference: input.transactionId, notes: `Automatically posted from M-Pesa C2B confirmation.` }, null) as { payment: { id: number } };
  await query(`UPDATE mpesa_transactions SET status = 'POSTED', rent_payment_id = $2 WHERE id = $1`, [stored.id, result.payment.id]);
  return { status: 'POSTED', tenantId: tenant.id, paymentId: result.payment.id };
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
    `INSERT INTO mpesa_transactions
       (source, checkout_request_id, merchant_request_id, account_reference, amount, phone_number, raw_payload, status)
     VALUES ('STK', $1, $2, $3, $4, $5, $6::jsonb, 'RECEIVED')
     ON CONFLICT (checkout_request_id) DO NOTHING`,
    [request.checkoutRequestId, request.merchantRequestId ?? null, accountReference, amount, tenant.phone_number, JSON.stringify({ request })]
  );
  return { ...request, accountReference };
}
