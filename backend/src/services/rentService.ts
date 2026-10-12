import { query, queryOne, withTransaction } from '../config/db';
import { paginate } from './paginate';
import { MONTH_NAMES, type Pagination } from '../types';
import { balanceDue, paymentStatus } from '../utils/businessRules';
import { notFound, unprocessable } from '../utils/httpError';
import { csvCell } from '../utils/csv';
import { toNumber, round2 } from '../utils/money';
import { logAudit } from './auditService';
import { createReceipt } from './receiptService';
import { getSettings } from './settingsService';
import { occupancyRows } from './tenantLedger';
import { notifyPaymentRecorded, type PreparedNotifications } from './postPaymentDispatch';

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
  const paidByKey = new Map(paidRows.map((r) => [r.tenant_id + ":" + r.billing_month + ":" + r.billing_year, toNumber(r.paid)]));

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
    const expected = toNumber(row.monthly_rent);
    return Object.assign({}, row, {
      expectedRent: expected,
      totalPaidForMonth: round2(paid),
      balance: balanceDue(expected, paid),
      status: paymentStatus(expected, paid),
    });
  });

  return { rows: enriched, pagination };
}

// The full payment transaction (spec §43): validate → record → receipt →
// SMS prep → audit, all-or-nothing.
export async function createRentPayment(input: RentPaymentInput, userId: number | null): Promise<unknown> {
  const tenant = await queryOne<{ id: number; unit_id: number | null; full_name: string; status: string; email: string | null; phone_number: string | null }>(
    'SELECT id, unit_id, full_name, status, email, phone_number FROM tenants WHERE id = $1',
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
  const expectedRent = toNumber(unit.monthly_rent);

  // The delivery facts and dispatch closure escape the transaction together:
  // the response and the audit entry report the seam's facts verbatim, so
  // neither can drift from what was really prepared.
  const { result, dispatch: dispatchNotifications, sms, email } = await withTransaction(async (client) => {
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
    const paid = toNumber(totals.rows[0].paid);
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
    await client.query('UPDATE rent_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, payment.id]);
    // Both notification rows are prepared ON this transaction (a pool
    // connection cannot see the receipt yet); the returned closure fires the
    // actual sends only after the commit below.
    const prepared: PreparedNotifications = await notifyPaymentRecorded(receipt, client);

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
        // The seam's delivery facts, verbatim: makes "this receipt could not
        // be delivered (and why)" traceable in the audit trail, not just in
        // the ephemeral API response — and the two records cannot disagree.
        delivery: { sms: prepared.sms, email: prepared.email },
      },
    });

    return {
      result: {
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
      },
      // The dispatch closure rides out of the transaction with the result,
      // so the post-commit send cannot be forgotten; the delivery facts ride
      // out with it for the response below.
      dispatch: prepared.dispatch,
      sms: prepared.sms,
      email: prepared.email,
    };
  });

  // Auto-send the receipt SMS/email now that the payment transaction has
  // committed (fire-and-forget — the response never waits on a provider).
  // The delivery facts say honestly what was queued and what was not (and
  // why), so the UI can warn instead of implying a message went out.
  dispatchNotifications();
  return { ...result, sms, email };
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
// One month of the rent collection summary — the shared shape consumed by
// the dashboard, the monthly report PDF and the combined rent+water summary.
export interface RentMonthlySummaryRow {
  month: number;
  monthName: string;
  expectedRent: number;
  rentCollected: number;
  rentOutstanding: number;
  collectionPercentage: number;
  paidTenants: number;
  partialTenants: number;
  unpaidTenants: number;
  occupiedUnits: number;
  vacantUnits: number;
}

export async function monthlyRentSummary(year: number): Promise<RentMonthlySummaryRow[]> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;

  // Occupancy truth via the Tenant Ledger module: one query replaces the
  // occupied_units CTE AND the per-month status loop's window predicate
  // (13 queries → 3, all reading the one tenancy-window implementation).
  const [occupancy, collectedRows, paidRows] = await Promise.all([
    occupancyRows(targetYear, 12),
    query<{ m: number; paid: string }>(
      `SELECT billing_month AS m, COALESCE(SUM(amount), 0)::text AS paid
       FROM rent_payments
       WHERE billing_year = $1::int
       GROUP BY billing_month`,
      [targetYear]
    ),
    query<{ tenant_id: number; m: number; paid: string }>(
      `SELECT tenant_id, billing_month AS m, COALESCE(SUM(amount), 0)::text AS paid
       FROM rent_payments
       WHERE billing_year = $1::int
       GROUP BY tenant_id, billing_month`,
      [targetYear]
    ),
  ]);

  // Per-month expected rent and occupied units — DISTINCT by unit, matching
  // the former occupied_units CTE.
  const perMonth = new Map<number, { expected: number; units: Set<number> }>();
  for (const o of occupancy) {
    let m = perMonth.get(o.month);
    if (!m) {
      m = { expected: 0, units: new Set() };
      perMonth.set(o.month, m);
    }
    if (!m.units.has(o.unitId)) {
      m.units.add(o.unitId);
      m.expected += o.monthlyRent;
    }
  }
  const collectedByMonth = new Map(collectedRows.map((r) => [r.m, toNumber(r.paid)]));
  const paidByTenantMonth = new Map(paidRows.map((r) => [`${r.tenant_id}:${r.m}`, toNumber(r.paid)]));

  const totalUnits = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM units');
  const unitCount = Number(totalUnits?.count ?? 0);

  return Promise.all(Array.from({ length: 12 }, (_, i) => i + 1).map(async (month) => {
    const m = perMonth.get(month);
    const expected = m ? round2(m.expected) : 0;
    const occupied = m ? m.units.size : 0;
    const collected = collectedByMonth.get(month) ?? 0;

    // Per-tenant status counts for the month (from the same occupancy rows).
    const statuses = occupancy
      .filter((o) => o.month === month)
      .map((o) => ({ expected: o.monthlyRent, paid: paidByTenantMonth.get(`${o.tenantId}:${month}`) ?? 0 }));
    let paidTenants = 0;
    let partialTenants = 0;
    let unpaidTenants = 0;
    for (const s of statuses) {
      const st = paymentStatus(s.expected, s.paid);
      if (st === 'PAID' || st === 'OVERPAID') paidTenants += 1;
      else if (st === 'PARTIAL') partialTenants += 1;
      else unpaidTenants += 1;
    }

    const percentage = expected > 0 ? round2((collected / expected) * 100) : 0;
    return {
      month,
      monthName: MONTH_NAMES[month - 1],
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
