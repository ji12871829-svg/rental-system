import { query, queryOne, withTransaction } from '../config/db';
import { paginate } from './paginate';
import { MONTH_NAMES, type Pagination } from '../types';
import { balanceDue, paymentStatus } from '../utils/businessRules';
import { badRequest, notFound, unprocessable } from '../utils/httpError';
import { csvCell } from '../utils/csv';
import { n, round2 } from '../utils/money';
import { logAudit } from './auditService';
import { createReceipt } from './receiptService';
import { autoSendEnabled, dispatchAutoSend, prepareForReceipt } from './smsService';
import { dispatchAutoEmail } from './emailService';
import { getSettings } from './settingsService';

export interface RentPaymentInput {
  tenantId: number;
  paymentDate: string;
  billingMonth: number;
  billingYear: number;
  amount: number;
  paymentMethod: 'CASH' | 'M_PESA' | 'BANK' | 'OTHER';
  paymentReference?: string;
  notes?: string;
}

export interface RentPaymentFilters {
  page: number;
  limit: number;
  month?: number;
  year?: number;
  unitId?: number;
  tenantId?: number;
  paymentMethod?: string;
  q?: string;
}

export async function listRentPayments(filters: RentPaymentFilters): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.month) {
    params.push(filters.month);
    where.push(`rp.billing_month = $${params.length}`);
  }
  if (filters.year) {
    params.push(filters.year);
    where.push(`rp.billing_year = $${params.length}`);
  }
  if (filters.unitId) {
    params.push(filters.unitId);
    where.push(`rp.unit_id = $${params.length}`);
  }
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`rp.tenant_id = $${params.length}`);
  }
  if (filters.paymentMethod) {
    params.push(filters.paymentMethod);
    where.push(`rp.payment_method = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(t.full_name ILIKE $${params.length} OR u.unit_number ILIKE $${params.length} OR rp.payment_reference ILIKE $${params.length} OR rp.receipt_number ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Per-row enrichment (expected vs total paid for the month) comes from ONE
  // grouped query instead of a SUM round-trip per row.
  const paidRows = await query<{ tenant_id: number; billing_month: number; billing_year: number; paid: string }>(
    `SELECT tenant_id, billing_month, billing_year, COALESCE(SUM(amount), 0)::text AS paid
     FROM rent_payments
     GROUP BY tenant_id, billing_month, billing_year`
  );
  const paidByKey = new Map(paidRows.map((r) => [r.tenant_id + ":" + r.billing_month + ":" + r.billing_year, n(r.paid)]));

  const { rows, pagination } = await paginate<Record<string, unknown>>({
    selectSql: `rp.*, t.full_name AS tenant_name, t.phone_number, u.unit_number, u.monthly_rent`,
    tableSql: `FROM rent_payments rp
     JOIN tenants t ON t.id = rp.tenant_id
     JOIN units u ON u.id = rp.unit_id`,
    whereSql,
    params,
    orderBy: `ORDER BY rp.payment_date DESC, rp.id DESC`,
    page: filters.page,
    limit: filters.limit,
  });

  const enriched = rows.map((row: any) => {
    const paid = paidByKey.get(row.tenant_id + ":" + row.billing_month + ":" + row.billing_year) ?? 0;
    const expected = n(row.monthly_rent);
    return {
      ...row,
      expectedRent: expected,
      totalPaidForMonth: round2(paid),
      balance: balanceDue(expected, paid),
      status: paymentStatus(expected, paid),
    };
  });

  return { rows: enriched, pagination };
}

// The full payment transaction (spec §43): validate → record → receipt →
// SMS prep → audit, all-or-nothing.
export async function createRentPayment(input: RentPaymentInput, userId: number | null): Promise<unknown> {
  const tenant = await queryOne<{ id: number; unit_id: number | null; full_name: string; status: string }>(
    'SELECT id, unit_id, full_name, status FROM tenants WHERE id = $1',
    [input.tenantId]
  );
  if (!tenant) throw notFound('Tenant not found.');
  if (tenant.status !== 'ACTIVE') {
    throw unprocessable('Tenant has moved out. Payments can no longer be recorded.');
  }
  if (!tenant.unit_id) throw unprocessable('Tenant has no assigned unit.');

  const unitId = tenant.unit_id; // narrowed copy — survives the closure below
  const unit = await queryOne<{ id: number; unit_number: string; monthly_rent: string }>(
    'SELECT id, unit_number, monthly_rent FROM units WHERE id = $1',
    [unitId]
  );
  if (!unit) throw notFound('Unit not found.');
  const expectedRent = n(unit.monthly_rent);

  // The prepared notification's id escapes the transaction closure so the
  // dispatch can happen strictly after commit.
  let preparedSmsId: number | null = null;
  let receiptId: number | null = null;
  const result = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO rent_payments
         (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year,
          amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.paymentReference ?? null, input.tenantId, unitId, input.paymentDate,
        input.billingMonth, input.billingYear, input.amount, input.paymentMethod, input.notes ?? null,
      ]
    );
    const payment = inserted.rows[0];

    // Totals + status for the period (supports multiple payments per month).
    const totals = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM rent_payments
       WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`,
      [input.tenantId, input.billingMonth, input.billingYear]
    );
    const paid = n(totals.rows[0].paid);
    const balance = balanceDue(expectedRent, paid);

    const receipt = await createReceipt(
      {
        type: 'RENT',
        tenantId: input.tenantId,
        unitId,
        paymentDate: input.paymentDate,
        billingMonth: input.billingMonth,
        billingYear: input.billingYear,
        rentAmount: input.amount,
        waterAmount: 0,
        balance,
      },
      client
    );
    receiptId = receipt.id;
    await client.query('UPDATE rent_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, payment.id]);
    preparedSmsId = await prepareForReceipt(receipt as any, client);

    const settings = await getSettings();
    await logAudit({
      userId,
      action: 'RENT_PAYMENT_CREATED',
      entity: 'rent_payments',
      entityId: payment.id,
      newValue: {
        tenantId: input.tenantId,
        billingMonth: input.billingMonth,
        billingYear: input.billingYear,
        amount: input.amount,
        method: input.paymentMethod,
        status: paymentStatus(expectedRent, paid),
        balance,
      },
    });

    return {
      payment,
      receipt: receipt.receipt_number,
      expectedRent,
      totalPaidForMonth: round2(paid),
      balance,
      status: paymentStatus(expectedRent, paid),
      tenant: { id: tenant.id, fullName: tenant.full_name },
      unit: { id: unit.id, unitNumber: unit.unit_number },
      currency: settings.currency,
      monthName: MONTH_NAMES[input.billingMonth - 1],
    };
  });

  // Auto-send the receipt SMS now that the payment transaction has committed
  // (fire-and-forget — see dispatchAutoSend; the response never waits on the
  // provider). Row exists in the DB either way; PENDING rows without a phone
  // never happen, so null just means "no phone on file".
  dispatchAutoSend(preparedSmsId);
  dispatchAutoEmail(receiptId);
  return { ...result, sms: { queued: preparedSmsId != null, autoSend: autoSendEnabled() }, email: { queued: receiptId != null, autoSend: true } };
}

export async function deleteRentPayment(id: number, userId: number): Promise<void> {
  const payment = await queryOne<{ id: number; receipt_number: string | null }>(
    'SELECT id, receipt_number FROM rent_payments WHERE id = $1',
    [id]
  );
  if (!payment) throw notFound('Rent payment not found.');
  await withTransaction(async (client) => {
    await client.query('DELETE FROM rent_payments WHERE id = $1', [id]);
    // The receipt this payment minted would otherwise orphan — receipts link
    // to payments only by receipt_number, so nothing else references it once
    // the payment is gone (SMS/emails carry receipt_id FKs with SET NULL).
    if (payment.receipt_number) {
      await client.query('DELETE FROM receipts WHERE receipt_number = $1', [payment.receipt_number]);
    }
    await logAudit({ userId, action: 'RENT_PAYMENT_DELETED', entity: 'rent_payments', entityId: id });
  });
}

export async function rentPaymentsCsv(filters: { year?: number; month?: number }): Promise<string> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.year) {
    params.push(filters.year);
    where.push(`rp.billing_year = $${params.length}`);
  }
  if (filters.month) {
    params.push(filters.month);
    where.push(`rp.billing_month = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT to_char(rp.payment_date, 'YYYY-MM-DD') AS payment_date, rp.billing_month, rp.billing_year, t.full_name, u.unit_number,
            rp.amount, rp.payment_method, rp.receipt_number, rp.payment_reference
     FROM rent_payments rp
     JOIN tenants t ON t.id = rp.tenant_id
     JOIN units u ON u.id = rp.unit_id
     ${whereSql}
     ORDER BY rp.payment_date`,
    params
  );
  const header = 'payment_date,billing_month,billing_year,tenant,unit,amount,payment_method,receipt_number,payment_reference';
  const lines = rows.map((r: any) =>
    [r.payment_date, r.billing_month, r.billing_year, r.full_name, r.unit_number, r.amount, r.payment_method, r.receipt_number ?? '', r.payment_reference ?? ''].map(csvCell).join(',')
  );
  return [header, ...lines].join('\n');
}

// Monthly rent summary for the reporting year (spec §27). Expected rent comes
// from unit monthly_rent and occupancy by tenant move-in/move-out dates —
// never from hard-coded totals.
export async function monthlyRentSummary(year: number): Promise<unknown[]> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;
  const rows = await query<{
    month: number; expected: string; collected: string;
    paid_tenants: string; partial_tenants: string; unpaid_tenants: string;
    occupied_units: string; vacant_units: string;
  }>(
    `WITH months AS (
       SELECT generate_series(1, 12) AS m
     ),
     month_bounds AS (
       SELECT m, (DATE ($1::text || '-01-01') + (m - 1) * INTERVAL '1 month') AS month_start,
              (DATE ($1::text || '-01-01') + m * INTERVAL '1 month' - INTERVAL '1 day') AS month_end
       FROM months
     ),
     occupied_units AS (
       SELECT DISTINCT u.id, u.monthly_rent, mb.m
       FROM units u
       JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
       CROSS JOIN month_bounds mb
       WHERE t.move_in_date <= mb.month_end
         AND (t.move_out_date IS NULL OR t.move_out_date >= mb.month_start)
     ),
     collected AS (
       SELECT billing_month AS m, COALESCE(SUM(amount), 0) AS paid
       FROM rent_payments
       WHERE billing_year = $1::int
       GROUP BY billing_month
     )
     SELECT mb.m AS month,
            COALESCE((SELECT SUM(monthly_rent) FROM occupied_units WHERE m = mb.m), 0) AS expected,
            COALESCE(c.paid, 0) AS collected,
            (SELECT COUNT(*) FROM occupied_units WHERE m = mb.m) AS occupied_units,
            0 AS vacant_units,
            0 AS paid_tenants, 0 AS partial_tenants, 0 AS unpaid_tenants
     FROM month_bounds mb
     LEFT JOIN collected c ON c.m = mb.m
     ORDER BY mb.m`,
    [targetYear]
  );

  const totalUnits = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM units');
  const unitCount = Number(totalUnits?.count ?? 0);

  return Promise.all(rows.map(async (r) => {
    const expected = n(r.expected);
    const collected = n(r.collected);
    const occupied = Number(r.occupied_units);

    // Per-tenant status counts for the month.
    const statuses = await query<{ full_name: string; expected: string; paid: string }>(
      `SELECT t.full_name,
              u.monthly_rent AS expected,
              COALESCE((SELECT SUM(amount) FROM rent_payments rp
                        WHERE rp.tenant_id = t.id AND rp.billing_month = $1::int AND rp.billing_year = $2::int), 0) AS paid
       FROM tenants t
       JOIN units u ON u.id = t.unit_id AND t.status = 'ACTIVE'
       WHERE t.move_in_date <= (DATE ($2::text || '-01-01') + $1 * INTERVAL '1 month' - INTERVAL '1 day')
         AND (t.move_out_date IS NULL OR t.move_out_date >= (DATE ($2::text || '-01-01') + ($1 - 1) * INTERVAL '1 month'))`,
      [r.month, targetYear]
    );
    let paidTenants = 0;
    let partialTenants = 0;
    let unpaidTenants = 0;
    for (const s of statuses) {
      const st = paymentStatus(n(s.expected), n(s.paid));
      if (st === 'PAID' || st === 'OVERPAID') paidTenants += 1;
      else if (st === 'PARTIAL') partialTenants += 1;
      else unpaidTenants += 1;
    }

    const percentage = expected > 0 ? round2((collected / expected) * 100) : 0;
    return {
      month: r.month,
      monthName: MONTH_NAMES[r.month - 1],
      expectedRent: expected,
      rentCollected: collected,
      rentOutstanding: balanceDue(expected, collected),
      collectionPercentage: percentage,
      paidTenants,
      partialTenants,
      unpaidTenants,
      occupiedUnits: occupied,
      vacantUnits: Math.max(0, unitCount - occupied),
    };
  }));
}