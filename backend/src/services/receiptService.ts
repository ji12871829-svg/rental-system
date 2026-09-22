import { poolExec, query, queryOne, withTransaction, type SqlExec } from '../config/db';
import { paginate } from './paginate';
import type { Pagination, ReceiptType } from '../types';
import { notFound } from '../utils/httpError';
import { balanceDue, formatReceiptNumber, receiptPrefixFor } from '../utils/businessRules';
import { n } from '../utils/money';
import { getBusinessIdentity } from './brandingService';
import { mergePdfBytes, receiptPdfBytes } from '../utils/receiptPdf';

export interface ReceiptInput {
  type: ReceiptType;
  tenantId: number;
  unitId: number;
  paymentDate: string;
  billingMonth: number;
  billingYear: number;
  rentAmount: number;
  waterAmount: number;
  balance: number;
}

interface ReceiptRow {
  id: number;
  receipt_number: string;
  receipt_type: ReceiptType;
  tenant_id: number;
  unit_id: number;
  payment_date: string;
  billing_month: number;
  billing_year: number;
  rent_amount: string;
  water_amount: string;
  total_amount: string;
  balance: string;
  generated_at: string;
}

// Sequence per type+year: count of existing receipts with that prefix/year + 1.
async function nextSequence(prefix: string, year: number, exec: SqlExec = poolExec): Promise<number> {
  const res = await exec.query(
    `SELECT COUNT(*)::int AS count FROM receipts WHERE receipt_number LIKE $1`,
    [`${prefix}-${year}-%`]
  );
  return (res.rows[0]?.count ?? 0) + 1;
}

export async function createReceipt(input: ReceiptInput, exec: SqlExec = poolExec): Promise<ReceiptRow> {
  const prefix = receiptPrefixFor(input.type);
  const seq = await nextSequence(prefix, input.billingYear, exec);
  const receiptNumber = formatReceiptNumber(prefix, input.billingYear, seq);
  const total = n(input.rentAmount) + n(input.waterAmount);
  const res = await exec.query(
    `INSERT INTO receipts
       (receipt_number, receipt_type, tenant_id, unit_id, payment_date,
        billing_month, billing_year, rent_amount, water_amount, total_amount, balance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      receiptNumber, input.type, input.tenantId, input.unitId, input.paymentDate,
      input.billingMonth, input.billingYear,
      input.rentAmount, input.waterAmount, total, input.balance,
    ]
  );
  return res.rows[0] as ReceiptRow;
}

export interface ReceiptFilters {
  page: number;
  limit: number;
  receiptType?: string;
  tenantId?: number;
  unitId?: number;
  month?: number;
  year?: number;
  q?: string;
}

export async function listReceipts(filters: ReceiptFilters): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.receiptType) {
    params.push(filters.receiptType);
    where.push(`r.receipt_type = $${params.length}`);
  }
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`r.tenant_id = $${params.length}`);
  }
  if (filters.unitId) {
    params.push(filters.unitId);
    where.push(`r.unit_id = $${params.length}`);
  }
  if (filters.month) {
    params.push(filters.month);
    where.push(`r.billing_month = $${params.length}`);
  }
  if (filters.year) {
    params.push(filters.year);
    where.push(`r.billing_year = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(r.receipt_number ILIKE $${params.length} OR t.full_name ILIKE $${params.length} OR u.unit_number ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return paginate<Record<string, unknown>>({
    selectSql: `r.*, t.full_name AS tenant_name, t.phone_number, u.unit_number, u.unit_type`,
    tableSql: `FROM receipts r
     JOIN tenants t ON t.id = r.tenant_id
     JOIN units u ON u.id = r.unit_id`,
    whereSql,
    params,
    orderBy: `ORDER BY r.generated_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}

export async function getReceiptById(id: number): Promise<unknown> {
  const row = await queryOne(
    `SELECT r.*, t.full_name AS tenant_name, t.phone_number, u.unit_number, u.unit_type,
            p.name AS property_name, p.address AS property_address, s.currency
     FROM receipts r
     JOIN tenants t ON t.id = r.tenant_id
     JOIN units u ON u.id = r.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN settings s ON s.id = 1
     WHERE r.id = $1`,
    [id]
  );
  if (!row) throw notFound('Receipt not found.');
  return row;
}

// IDs of every receipt in a billing period, ordered for the bulk export
// (rent first, then water, then combined — within each type by date).
async function listReceiptIdsForPeriod(month: number, year: number): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM receipts
     WHERE billing_month = $1 AND billing_year = $2
     ORDER BY CASE receipt_type WHEN 'RENT' THEN 0 WHEN 'WATER' THEN 1 ELSE 2 END, payment_date, id`,
    [month, year]
  );
  return rows.map((r) => r.id);
}

// Bulk PDF export: every receipt in a billing month, merged into one PDF
// (one page per receipt, same layout as the single-receipt download).
export async function bulkReceiptsPdf(
  month: number,
  year: number
): Promise<{ bytes: Uint8Array; count: number }> {
  const ids = await listReceiptIdsForPeriod(month, year);
  if (ids.length === 0) return { bytes: new Uint8Array(), count: 0 };
  const identity = await getBusinessIdentity();
  const pdfs: Uint8Array[] = [];
  for (const id of ids) {
    const receipt = (await getReceiptById(id)) as any;
    pdfs.push(await receiptPdfBytes(receipt, identity));
  }
  return { bytes: await mergePdfBytes(pdfs), count: ids.length };
}

// Combined RWC receipt: aggregates every rent + water payment made by a
// tenant in one billing month. One per tenant+month+year.
export async function generateCombinedReceipt(input: {
  tenantId: number;
  billingMonth: number;
  billingYear: number;
}): Promise<ReceiptRow> {
  const existing = await queryOne<ReceiptRow>(
    `SELECT * FROM receipts
     WHERE receipt_type = 'COMBINED' AND tenant_id = $1 AND billing_month = $2 AND billing_year = $3`,
    [input.tenantId, input.billingMonth, input.billingYear]
  );
  if (existing) return existing;

  const tenant = await queryOne<{ id: number; unit_id: number }>(
    'SELECT id, unit_id FROM tenants WHERE id = $1',
    [input.tenantId]
  );
  if (!tenant) throw notFound('Tenant not found.');

  return withTransaction(async (client) => {
    const rentRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid, unit_id
       FROM rent_payments WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3
       GROUP BY unit_id`,
      [input.tenantId, input.billingMonth, input.billingYear]
    );
    const waterRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid
       FROM water_payments WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`,
      [input.tenantId, input.billingMonth, input.billingYear]
    );
    const rentPaid = n(rentRes.rows[0]?.paid);
    const waterPaid = n(waterRes.rows[0]?.paid);
    const unitId = rentRes.rows[0]?.unit_id ?? tenant.unit_id;

    const unitRes = await client.query('SELECT monthly_rent FROM units WHERE id = $1', [unitId]);
    const waterBillRes = await client.query(
      `SELECT COALESCE(SUM(water_bill), 0) AS bill FROM water_meter_readings
       WHERE unit_id = $1 AND billing_month = $2 AND billing_year = $3`,
      [unitId, input.billingMonth, input.billingYear]
    );
    const expectedRent = n(unitRes.rows[0]?.monthly_rent);
    const waterBill = n(waterBillRes.rows[0]?.bill);
    const totalBalance = balanceDue(expectedRent + waterBill, rentPaid + waterPaid);

    const seq = await nextSequence('RWC', input.billingYear, client);
    const receiptNumber = formatReceiptNumber('RWC', input.billingYear, seq);
    const res = await client.query(
      `INSERT INTO receipts
         (receipt_number, receipt_type, tenant_id, unit_id, payment_date,
          billing_month, billing_year, rent_amount, water_amount, total_amount, balance)
       VALUES ($1, 'COMBINED', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        receiptNumber, input.tenantId, unitId, new Date().toISOString().slice(0, 10),
        input.billingMonth, input.billingYear, rentPaid, waterPaid, rentPaid + waterPaid, totalBalance,
      ]
    );
    return res.rows[0] as ReceiptRow;
  });
}

// Backfill: seeded payments were inserted directly (no receipts). Create a
// receipt per payment and link the receipt_number onto the payment row.
export async function backfillReceipts(): Promise<number> {
  let created = 0;
  await withTransaction(async (client) => {
    const rentPayments = await client.query(
      `SELECT rp.*, t.unit_id, u.monthly_rent
       FROM rent_payments rp
       JOIN tenants t ON t.id = rp.tenant_id
       JOIN units u ON u.id = rp.unit_id
       WHERE rp.receipt_number IS NULL
       ORDER BY rp.payment_date, rp.id`
    );
    // Precompute balances set-based — the per-row SUMs below used to be one
    // round-trip per payment (N+1 on first boot with seeded data).
    const rentPaidRows = await client.query(
      `SELECT tenant_id, billing_month, billing_year, COALESCE(SUM(amount), 0) AS paid
       FROM rent_payments GROUP BY tenant_id, billing_month, billing_year`
    );
    const rentPaidByKey = new Map(
      rentPaidRows.rows.map((r: any) => [r.tenant_id + ":" + r.billing_month + ":" + r.billing_year, n(r.paid)])
    );
    for (const p of rentPayments.rows) {
      const paid = rentPaidByKey.get(p.tenant_id + ":" + p.billing_month + ":" + p.billing_year) ?? 0;
      const balance = balanceDue(n(p.monthly_rent), paid);
      const receipt = await createReceipt(
        {
          type: 'RENT', tenantId: p.tenant_id, unitId: p.unit_id,
          paymentDate: p.payment_date, billingMonth: p.billing_month, billingYear: p.billing_year,
          rentAmount: n(p.amount), waterAmount: 0, balance,
        },
        client
      );
      await client.query('UPDATE rent_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, p.id]);
      created += 1;
    }

    const waterPayments = await client.query(
      `SELECT wp.*, t.unit_id
       FROM water_payments wp
       JOIN tenants t ON t.id = wp.tenant_id
       WHERE wp.receipt_number IS NULL
       ORDER BY wp.payment_date, wp.id`
    );
    const waterBillRows = await client.query(
      `SELECT unit_id, billing_month, billing_year, COALESCE(SUM(water_bill), 0) AS bill
       FROM water_meter_readings GROUP BY unit_id, billing_month, billing_year`
    );
    const waterBillByKey = new Map(
      waterBillRows.rows.map((r: any) => [r.unit_id + ":" + r.billing_month + ":" + r.billing_year, n(r.bill)])
    );
    const waterPaidRows = await client.query(
      `SELECT tenant_id, billing_month, billing_year, COALESCE(SUM(amount), 0) AS paid
       FROM water_payments GROUP BY tenant_id, billing_month, billing_year`
    );
    const waterPaidByKey = new Map(
      waterPaidRows.rows.map((r: any) => [r.tenant_id + ":" + r.billing_month + ":" + r.billing_year, n(r.paid)])
    );
    for (const p of waterPayments.rows) {
      const bill = waterBillByKey.get(p.unit_id + ":" + p.billing_month + ":" + p.billing_year) ?? 0;
      const paid = waterPaidByKey.get(p.tenant_id + ":" + p.billing_month + ":" + p.billing_year) ?? 0;
      const balance = balanceDue(bill, paid);
      const receipt = await createReceipt(
        {
          type: 'WATER', tenantId: p.tenant_id, unitId: p.unit_id,
          paymentDate: p.payment_date, billingMonth: p.billing_month, billingYear: p.billing_year,
          rentAmount: 0, waterAmount: n(p.amount), balance,
        },
        client
      );
      await client.query('UPDATE water_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, p.id]);
      created += 1;
    }
  });
  return created;
}