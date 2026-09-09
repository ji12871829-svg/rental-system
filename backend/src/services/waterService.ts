import { query, queryOne, withTransaction } from '../config/db';
import { MONTH_NAMES, type Pagination } from '../types';
import { balanceDue, computeWaterBill, paymentStatus, waterCollectionRate, waterSurplusDeficit } from '../utils/businessRules';
import { badRequest, conflict, notFound, unprocessable } from '../utils/httpError';
import { n, round2 } from '../utils/money';
import { logAudit } from './auditService';
import { createReceipt } from './receiptService';
import { dispatchAutoSend, prepareForReceipt } from './smsService';
import { getSettings } from './settingsService';

// ---------------------------------------------------------------------------
// Meter readings
// ---------------------------------------------------------------------------

export interface ReadingFilters {
  page: number;
  limit: number;
  month?: number;
  year?: number;
  unitId?: number;
  q?: string;
}

export async function listReadings(filters: ReadingFilters): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.month) {
    params.push(filters.month);
    where.push(`wmr.billing_month = $${params.length}`);
  }
  if (filters.year) {
    params.push(filters.year);
    where.push(`wmr.billing_year = $${params.length}`);
  }
  if (filters.unitId) {
    params.push(filters.unitId);
    where.push(`wmr.unit_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(u.unit_number ILIKE $${params.length} OR t.full_name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM water_meter_readings wmr ${whereSql}`,
    params
  );
  const total = Number(totalRow?.count ?? 0);
  const offset = (filters.page - 1) * filters.limit;
  const rows = await query(
    `SELECT wmr.*, t.full_name AS tenant_name, u.unit_number, u.unit_type
     FROM water_meter_readings wmr
     JOIN units u ON u.id = wmr.unit_id
     LEFT JOIN tenants t ON t.id = wmr.tenant_id
     ${whereSql}
     ORDER BY wmr.reading_date DESC, wmr.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset]
  );

  const enriched = await Promise.all(
    rows.map(async (row: any) => {
      const paidRes = await queryOne<{ paid: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS paid FROM water_payments
         WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`,
        [row.tenant_id, row.billing_month, row.billing_year]
      );
      const paid = n(paidRes?.paid);
      const bill = n(row.water_bill);
      return {
        ...row,
        totalWaterPaid: round2(paid),
        waterBalance: balanceDue(bill, paid),
        status: paymentStatus(bill, paid),
      };
    })
  );
  return {
    rows: enriched,
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
  };
}

export interface ReadingInput {
  unitId: number;
  readingDate: string;
  billingMonth: number;
  billingYear: number;
  currentReading: number;
  previousReading?: number; // optional — used for FIRST READING establishment
  notes?: string;
}

// STRICT WATER RULE: only water_enabled units (12–23 in this property) may
// have readings. Enforced here AND by the DB trigger.
async function assertWaterEnabled(unitId: number): Promise<{ unit_number: string; tenant_id: number | null }> {
  const unit = await queryOne<{ id: number; unit_number: string; water_enabled: boolean; occupancy_status: string }>(
    'SELECT id, unit_number, water_enabled, occupancy_status FROM units WHERE id = $1',
    [unitId]
  );
  if (!unit) throw notFound('Unit not found.');
  if (!unit.water_enabled) {
    throw unprocessable(`Unit ${unit.unit_number} does not support water billing.`);
  }
  const tenant = await queryOne<{ id: number }>(
    'SELECT id FROM tenants WHERE unit_id = $1 AND status = $2',
    [unitId, 'ACTIVE']
  );
  return { unit_number: unit.unit_number, tenant_id: tenant?.id ?? null };
}

export async function createReading(input: ReadingInput, userId: number): Promise<unknown> {
  const { unit_number, tenant_id } = await assertWaterEnabled(input.unitId);
  const settings = await getSettings();
  const waterRate = n(settings.water_rate);

  // Automatic previous reading: the most recent reading for the unit whose
  // reading_date precedes this one (chronological history).
  const previousRow = await queryOne<{ current_reading: string; reading_date: string }>(
    `SELECT current_reading, reading_date FROM water_meter_readings
     WHERE unit_id = $1 AND reading_date < $2
     ORDER BY reading_date DESC, id DESC
     LIMIT 1`,
    [input.unitId, input.readingDate]
  );
  const previousOverride = input.previousReading;
  const previous = previousOverride !== undefined
    ? previousOverride
    : previousRow ? n(previousRow.current_reading) : null;

  const result = computeWaterBill(previous, input.currentReading, waterRate);
  if (!result.ok) throw unprocessable(result.error);

  try {
    const inserted = await query(
      `INSERT INTO water_meter_readings
         (unit_id, tenant_id, reading_date, billing_month, billing_year,
          previous_reading, current_reading, consumption, water_rate, water_bill)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.unitId, tenant_id, input.readingDate, input.billingMonth, input.billingYear,
        result.previousReading, result.currentReading, result.consumption, result.waterRate, result.waterBill,
      ]
    );
    await logAudit({
      userId,
      action: 'WATER_READING_CREATED',
      entity: 'water_meter_readings',
      entityId: inserted[0].id,
      newValue: { unitId: input.unitId, month: input.billingMonth, year: input.billingYear, consumption: result.consumption, bill: result.waterBill },
    });
    return {
      reading: inserted[0],
      firstReading: result.firstReading,
      unitNumber: unit_number,
      consumption: result.consumption,
      waterBill: result.waterBill,
      waterRate: result.waterRate,
      previousReading: result.previousReading,
      monthName: MONTH_NAMES[input.billingMonth - 1],
      currency: settings.currency,
    };
  } catch (err: any) {
    if (err.code === '23505') {
      throw conflict('A meter reading for this unit and month already exists.', 'DUPLICATE_READING');
    }
    throw err;
  }
}

export async function updateReading(id: number, input: { currentReading?: number; readingDate?: string; notes?: string }, userId: number): Promise<unknown> {
  const existing = await queryOne<{
    id: number; unit_id: number; previous_reading: string; reading_date: string;
  }>('SELECT id, unit_id, previous_reading, reading_date FROM water_meter_readings WHERE id = $1', [id]);
  if (!existing) throw notFound('Meter reading not found.');

  const settings = await getSettings();
  if (input.currentReading === undefined) return existing;

  // Recompute consumption + bill; the previous reading stays fixed (it is
  // the historical reading the current one is measured against).
  const r = computeWaterBill(n(existing.previous_reading), input.currentReading, n(settings.water_rate));
  if (!r.ok) throw unprocessable(r.error);
  const updated = await query(
    `UPDATE water_meter_readings
     SET current_reading = $2, consumption = $3, water_bill = $4,
         reading_date = COALESCE($5, reading_date)
     WHERE id = $1
     RETURNING *`,
    [id, r.currentReading, r.consumption, r.waterBill, input.readingDate ?? null]
  );
  await logAudit({ userId, action: 'WATER_READING_UPDATED', entity: 'water_meter_readings', entityId: id });
  return updated[0];
}

export async function deleteReading(id: number, userId: number): Promise<void> {
  const row = await queryOne<{ id: number }>('SELECT id FROM water_meter_readings WHERE id = $1', [id]);
  if (!row) throw notFound('Meter reading not found.');
  await query('DELETE FROM water_meter_readings WHERE id = $1', [id]);
  await logAudit({ userId, action: 'WATER_READING_DELETED', entity: 'water_meter_readings', entityId: id });
}

// ---------------------------------------------------------------------------
// Water payments
// ---------------------------------------------------------------------------

export interface WaterPaymentFilters {
  page: number;
  limit: number;
  month?: number;
  year?: number;
  unitId?: number;
  tenantId?: number;
  q?: string;
}

// CSV export of water payments — mirrors the rent payments export (spec §44):
// same shape and filters, plus the water-bill context (bill / total paid /
// balance / status for the payment's tenant + period).
export async function waterPaymentsCsv(filters: { year?: number; month?: number }): Promise<string> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.year) {
    params.push(filters.year);
    where.push(`wp.billing_year = $${params.length}`);
  }
  if (filters.month) {
    params.push(filters.month);
    where.push(`wp.billing_month = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT to_char(wp.payment_date, 'YYYY-MM-DD') AS payment_date, wp.billing_month, wp.billing_year, wp.amount, wp.payment_method,
            wp.receipt_number, t.full_name, u.unit_number,
            (SELECT COALESCE(SUM(water_bill), 0) FROM water_meter_readings wr
              WHERE wr.unit_id = wp.unit_id AND wr.billing_month = wp.billing_month
                AND wr.billing_year = wp.billing_year) AS water_bill,
            (SELECT COALESCE(SUM(amount), 0) FROM water_payments x
              WHERE x.tenant_id = wp.tenant_id AND x.billing_month = wp.billing_month
                AND x.billing_year = wp.billing_year) AS total_paid
     FROM water_payments wp
     JOIN tenants t ON t.id = wp.tenant_id
     JOIN units u ON u.id = wp.unit_id
     ${whereSql}
     ORDER BY wp.payment_date`,
    params
  );
  const header = 'payment_date,billing_month,billing_year,tenant,unit,amount,payment_method,bill,total_paid,balance,status,receipt_number';
  const lines = rows.map((r: any) => {
    const bill = n(r.water_bill);
    const paid = round2(n(r.total_paid));
    return [
      r.payment_date, r.billing_month, r.billing_year, `"${r.full_name}"`, r.unit_number,
      r.amount, r.payment_method, bill, paid, balanceDue(bill, paid), paymentStatus(bill, paid),
      r.receipt_number ?? '',
    ].join(',');
  });
  return [header, ...lines].join('\n');
}

export async function listWaterPayments(filters: WaterPaymentFilters): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.month) {
    params.push(filters.month);
    where.push(`wp.billing_month = $${params.length}`);
  }
  if (filters.year) {
    params.push(filters.year);
    where.push(`wp.billing_year = $${params.length}`);
  }
  if (filters.unitId) {
    params.push(filters.unitId);
    where.push(`wp.unit_id = $${params.length}`);
  }
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`wp.tenant_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(t.full_name ILIKE $${params.length} OR u.unit_number ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM water_payments wp
     JOIN tenants t ON t.id = wp.tenant_id
     JOIN units u ON u.id = wp.unit_id
     ${whereSql}`,
    params
  );
  const total = Number(totalRow?.count ?? 0);
  const offset = (filters.page - 1) * filters.limit;
  const rows = await query(
    `SELECT wp.*, t.full_name AS tenant_name, u.unit_number
     FROM water_payments wp
     JOIN tenants t ON t.id = wp.tenant_id
     JOIN units u ON u.id = wp.unit_id
     ${whereSql}
     ORDER BY wp.payment_date DESC, wp.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset]
  );
  const enriched = await Promise.all(
    rows.map(async (row: any) => {
      const billRes = await queryOne<{ bill: string }>(
        `SELECT COALESCE(SUM(water_bill), 0)::text AS bill FROM water_meter_readings
         WHERE unit_id = $1 AND billing_month = $2 AND billing_year = $3`,
        [row.unit_id, row.billing_month, row.billing_year]
      );
      const paidRes = await queryOne<{ paid: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS paid FROM water_payments
         WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`,
        [row.tenant_id, row.billing_month, row.billing_year]
      );
      const bill = n(billRes?.bill);
      const paid = n(paidRes?.paid);
      return {
        ...row,
        waterBill: bill,
        totalWaterPaid: round2(paid),
        waterBalance: balanceDue(bill, paid),
        status: paymentStatus(bill, paid),
      };
    })
  );
  return {
    rows: enriched,
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
  };
}

export interface WaterPaymentInput {
  tenantId: number;
  paymentDate: string;
  billingMonth: number;
  billingYear: number;
  amount: number;
  paymentMethod: 'CASH' | 'M_PESA' | 'BANK' | 'OTHER';
  notes?: string;
}

export async function createWaterPayment(input: WaterPaymentInput, userId: number): Promise<unknown> {
  const tenant = await queryOne<{ id: number; unit_id: number | null; full_name: string; status: string }>(
    'SELECT id, unit_id, full_name, status FROM tenants WHERE id = $1',
    [input.tenantId]
  );
  if (!tenant) throw notFound('Tenant not found.');
  if (!tenant.unit_id) throw unprocessable('Tenant has no assigned unit.');
  const waterUnitId = tenant.unit_id; // narrowed copy — survives the closure below
  await assertWaterEnabled(waterUnitId);

  const settings = await getSettings();

  // The prepared notification's id escapes the transaction closure so the
  // dispatch can happen strictly after commit.
  let preparedSmsId: number | null = null;
  const result = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO water_payments
         (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.tenantId, waterUnitId, input.paymentDate, input.billingMonth,
        input.billingYear, input.amount, input.paymentMethod, input.notes ?? null,
      ]
    );
    const payment = inserted.rows[0];

    const billRes = await client.query(
      `SELECT COALESCE(SUM(water_bill), 0) AS bill FROM water_meter_readings
       WHERE unit_id = $1 AND billing_month = $2 AND billing_year = $3`,
      [waterUnitId, input.billingMonth, input.billingYear]
    );
    const paidRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM water_payments
       WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`,
      [input.tenantId, input.billingMonth, input.billingYear]
    );
    const bill = n(billRes.rows[0].bill);
    const paid = n(paidRes.rows[0].paid);
    const balance = balanceDue(bill, paid);

    const receipt = await createReceipt(
      {
        type: 'WATER',
        tenantId: input.tenantId,
        unitId: waterUnitId,
        paymentDate: input.paymentDate,
        billingMonth: input.billingMonth,
        billingYear: input.billingYear,
        rentAmount: 0,
        waterAmount: input.amount,
        balance,
      },
      client
    );
    await client.query('UPDATE water_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, payment.id]);
    preparedSmsId = await prepareForReceipt(receipt as any, client);

    await logAudit({
      userId,
      action: 'WATER_PAYMENT_CREATED',
      entity: 'water_payments',
      entityId: payment.id,
      newValue: { tenantId: input.tenantId, month: input.billingMonth, year: input.billingYear, amount: input.amount },
    });

    return {
      payment,
      receipt: receipt.receipt_number,
      waterBill: bill,
      totalWaterPaid: round2(paid),
      waterBalance: balance,
      status: paymentStatus(bill, paid),
      tenant: { id: tenant.id, fullName: tenant.full_name },
      currency: settings.currency,
      monthName: MONTH_NAMES[input.billingMonth - 1],
    };
  });

  // Auto-send the receipt SMS now that the payment transaction has committed
  // (fire-and-forget — see dispatchAutoSend).
  dispatchAutoSend(preparedSmsId);
  return result;
}

export async function deleteWaterPayment(id: number, userId: number): Promise<void> {
  const row = await queryOne<{ id: number }>('SELECT id FROM water_payments WHERE id = $1', [id]);
  if (!row) throw notFound('Water payment not found.');
  await query('DELETE FROM water_payments WHERE id = $1', [id]);
  await logAudit({ userId, action: 'WATER_PAYMENT_DELETED', entity: 'water_payments', entityId: id });
}

// ---------------------------------------------------------------------------
// Water purchases (supply costs)
// ---------------------------------------------------------------------------

export interface PurchaseFilters {
  page: number;
  limit: number;
  year?: number;
  month?: number;
}

export async function listPurchases(filters: PurchaseFilters): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.year) {
    params.push(filters.year);
    where.push(`EXTRACT(YEAR FROM purchase_date)::int = $${params.length}`);
  }
  if (filters.month) {
    params.push(filters.month);
    where.push(`EXTRACT(MONTH FROM purchase_date)::int = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM water_purchases ${whereSql}`,
    params
  );
  const total = Number(totalRow?.count ?? 0);
  const offset = (filters.page - 1) * filters.limit;
  const rows = await query(
    `SELECT * FROM water_purchases ${whereSql}
     ORDER BY purchase_date DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset]
  );
  return {
    rows,
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
  };
}

export interface PurchaseInput {
  purchaseDate: string;
  supplier: string;
  quantity: number;
  measurementUnit?: string;
  costPerUnit: number;
  paymentMethod: 'CASH' | 'M_PESA' | 'BANK' | 'OTHER';
  referenceNumber?: string;
  notes?: string;
}

export async function createPurchase(input: PurchaseInput, userId: number): Promise<unknown> {
  const totalCost = round2(input.quantity * input.costPerUnit); // spec §18
  const inserted = await query(
    `INSERT INTO water_purchases
       (purchase_date, supplier, quantity, measurement_unit, cost_per_unit, total_cost, payment_method, reference_number, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.purchaseDate, input.supplier, input.quantity,
      input.measurementUnit ?? 'units', input.costPerUnit, totalCost,
      input.paymentMethod, input.referenceNumber ?? null, input.notes ?? null,
    ]
  );
  await logAudit({ userId, action: 'WATER_PURCHASE_CREATED', entity: 'water_purchases', entityId: inserted[0].id });
  return inserted[0];
}

export async function updatePurchase(id: number, input: Partial<PurchaseInput>, userId: number): Promise<unknown> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM water_purchases WHERE id = $1', [id]);
  if (!existing) throw notFound('Water purchase not found.');
  const qty = input.quantity ?? n((await queryOne<{ quantity: string }>('SELECT quantity FROM water_purchases WHERE id = $1', [id]))?.quantity);
  const cost = input.costPerUnit ?? n((await queryOne<{ cost_per_unit: string }>('SELECT cost_per_unit FROM water_purchases WHERE id = $1', [id]))?.cost_per_unit);
  const totalCost = round2(qty * cost);
  const updated = await query(
    `UPDATE water_purchases
     SET purchase_date = COALESCE($2, purchase_date),
         supplier = COALESCE($3, supplier),
         quantity = COALESCE($4, quantity),
         measurement_unit = COALESCE($5, measurement_unit),
         cost_per_unit = COALESCE($6, cost_per_unit),
         total_cost = $7,
         payment_method = COALESCE($8, payment_method),
         reference_number = COALESCE($9, reference_number),
         notes = COALESCE($10, notes)
     WHERE id = $1
     RETURNING *`,
    [id, input.purchaseDate ?? null, input.supplier ?? null, input.quantity ?? null,
     input.measurementUnit ?? null, input.costPerUnit ?? null, totalCost,
     input.paymentMethod ?? null, input.referenceNumber ?? null, input.notes ?? null]
  );
  await logAudit({ userId, action: 'WATER_PURCHASE_UPDATED', entity: 'water_purchases', entityId: id });
  return updated[0];
}

export async function deletePurchase(id: number, userId: number): Promise<void> {
  const row = await queryOne<{ id: number }>('SELECT id FROM water_purchases WHERE id = $1', [id]);
  if (!row) throw notFound('Water purchase not found.');
  await query('DELETE FROM water_purchases WHERE id = $1', [id]);
  await logAudit({ userId, action: 'WATER_PURCHASE_DELETED', entity: 'water_purchases', entityId: id });
}

// ---------------------------------------------------------------------------
// Summaries (spec §19, §22, §24, §47)
// ---------------------------------------------------------------------------

export async function waterSummary(year?: number): Promise<unknown> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;

  const billed = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(water_bill), 0)::text AS v FROM water_meter_readings WHERE billing_year = $1`, [targetYear]
  ))?.v);
  const collected = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments WHERE billing_year = $1`, [targetYear]
  ))?.v);
  const purchasedQty = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS v FROM water_purchases WHERE EXTRACT(YEAR FROM purchase_date)::int = $1`, [targetYear]
  ))?.v);
  const supplyCost = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(total_cost), 0)::text AS v FROM water_purchases WHERE EXTRACT(YEAR FROM purchase_date)::int = $1`, [targetYear]
  ))?.v);

  return {
    waterBilled: billed,
    waterCollected: collected,
    waterOutstanding: balanceDue(billed, collected),
    waterPurchased: purchasedQty,
    waterSupplyCost: supplyCost,
    averagePurchaseCost: purchasedQty > 0 ? round2(supplyCost / purchasedQty) : 0,
    collectionRate: waterCollectionRate(collected, billed),
    surplusDeficit: waterSurplusDeficit(collected, supplyCost),
    surplus: collected >= supplyCost,
    currency: settings.currency,
  };
}

export async function monthlyWaterSummary(year?: number): Promise<unknown[]> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return Promise.all(months.map(async (m) => {
    const billed = n((await queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(water_bill), 0)::text AS v FROM water_meter_readings WHERE billing_year = $1 AND billing_month = $2`, [targetYear, m]
    ))?.v);
    const collected = n((await queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments WHERE billing_year = $1 AND billing_month = $2`, [targetYear, m]
    ))?.v);
    const supplyCost = n((await queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(total_cost), 0)::text AS v FROM water_purchases
       WHERE EXTRACT(YEAR FROM purchase_date)::int = $1 AND EXTRACT(MONTH FROM purchase_date)::int = $2`, [targetYear, m]
    ))?.v);
    const purchased = n((await queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS v FROM water_purchases
       WHERE EXTRACT(YEAR FROM purchase_date)::int = $1 AND EXTRACT(MONTH FROM purchase_date)::int = $2`, [targetYear, m]
    ))?.v);

    return {
      month: m,
      monthName: MONTH_NAMES[m - 1],
      waterBilled: billed,
      waterCollected: collected,
      waterOutstanding: balanceDue(billed, collected),
      waterPurchased: purchased,
      waterSupplyCost: supplyCost,
      surplusDeficit: waterSurplusDeficit(collected, supplyCost),
      collectionRate: waterCollectionRate(collected, billed),
      currency: settings.currency,
    };
  }));
}

// Outstanding water by unit — used by the arrears and dashboard charts.
export async function outstandingWaterByUnit(year?: number): Promise<unknown[]> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;
  const rows = await query(
    `SELECT u.id, u.unit_number, t.full_name AS tenant_name,
            COALESCE(b.billed, 0) AS billed, COALESCE(p.paid, 0) AS paid
     FROM units u
     LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     LEFT JOIN (SELECT unit_id, SUM(water_bill) AS billed
                FROM water_meter_readings WHERE billing_year = $1 GROUP BY unit_id) b ON b.unit_id = u.id
     LEFT JOIN (SELECT unit_id, SUM(amount) AS paid
                FROM water_payments WHERE billing_year = $1 GROUP BY unit_id) p ON p.unit_id = u.id
     WHERE u.water_enabled = TRUE
     ORDER BY (COALESCE(b.billed, 0) - COALESCE(p.paid, 0)) DESC`,
    [targetYear]
  );
  return rows.map((r: any) => ({
    unitId: r.id,
    unitNumber: r.unit_number,
    tenantName: r.tenant_name,
    waterBilled: n(r.billed),
    waterPaid: n(r.paid),
    waterOutstanding: balanceDue(n(r.billed), n(r.paid)),
  }));
}