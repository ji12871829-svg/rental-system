"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReceipt = createReceipt;
exports.listReceipts = listReceipts;
exports.getReceiptById = getReceiptById;
exports.generateCombinedReceipt = generateCombinedReceipt;
exports.backfillReceipts = backfillReceipts;
const db_1 = require("../config/db");
const httpError_1 = require("../utils/httpError");
const businessRules_1 = require("../utils/businessRules");
const money_1 = require("../utils/money");
// Sequence per type+year: count of existing receipts with that prefix/year + 1.
async function nextSequence(prefix, year, exec = db_1.poolExec) {
    const res = await exec.query(`SELECT COUNT(*)::int AS count FROM receipts WHERE receipt_number LIKE $1`, [`${prefix}-${year}-%`]);
    return (res.rows[0]?.count ?? 0) + 1;
}
async function createReceipt(input, exec = db_1.poolExec) {
    const prefix = (0, businessRules_1.receiptPrefixFor)(input.type);
    const seq = await nextSequence(prefix, input.billingYear, exec);
    const receiptNumber = (0, businessRules_1.formatReceiptNumber)(prefix, input.billingYear, seq);
    const total = (0, money_1.n)(input.rentAmount) + (0, money_1.n)(input.waterAmount);
    const res = await exec.query(`INSERT INTO receipts
       (receipt_number, receipt_type, tenant_id, unit_id, payment_date,
        billing_month, billing_year, rent_amount, water_amount, total_amount, balance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`, [
        receiptNumber, input.type, input.tenantId, input.unitId, input.paymentDate,
        input.billingMonth, input.billingYear,
        input.rentAmount, input.waterAmount, total, input.balance,
    ]);
    return res.rows[0];
}
async function listReceipts(filters) {
    const where = [];
    const params = [];
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
    const totalRow = await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count FROM receipts r ${whereSql}`, params);
    const total = Number(totalRow?.count ?? 0);
    const offset = (filters.page - 1) * filters.limit;
    const rows = await (0, db_1.query)(`SELECT r.*, t.full_name AS tenant_name, t.phone_number, u.unit_number, u.unit_type
     FROM receipts r
     JOIN tenants t ON t.id = r.tenant_id
     JOIN units u ON u.id = r.unit_id
     ${whereSql}
     ORDER BY r.generated_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, filters.limit, offset]);
    return {
        rows,
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
}
async function getReceiptById(id) {
    const row = await (0, db_1.queryOne)(`SELECT r.*, t.full_name AS tenant_name, t.phone_number, u.unit_number, u.unit_type,
            p.name AS property_name, p.address AS property_address, s.currency
     FROM receipts r
     JOIN tenants t ON t.id = r.tenant_id
     JOIN units u ON u.id = r.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN settings s ON s.id = 1
     WHERE r.id = $1`, [id]);
    if (!row)
        throw (0, httpError_1.notFound)('Receipt not found.');
    return row;
}
// Combined RWC receipt: aggregates every rent + water payment made by a
// tenant in one billing month. One per tenant+month+year.
async function generateCombinedReceipt(input) {
    const existing = await (0, db_1.queryOne)(`SELECT * FROM receipts
     WHERE receipt_type = 'COMBINED' AND tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [input.tenantId, input.billingMonth, input.billingYear]);
    if (existing)
        return existing;
    const tenant = await (0, db_1.queryOne)('SELECT id, unit_id FROM tenants WHERE id = $1', [input.tenantId]);
    if (!tenant)
        throw (0, httpError_1.notFound)('Tenant not found.');
    return (0, db_1.withTransaction)(async (client) => {
        const rentRes = await client.query(`SELECT COALESCE(SUM(amount), 0) AS paid, unit_id
       FROM rent_payments WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [input.tenantId, input.billingMonth, input.billingYear]);
        const waterRes = await client.query(`SELECT COALESCE(SUM(amount), 0) AS paid
       FROM water_payments WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [input.tenantId, input.billingMonth, input.billingYear]);
        const rentPaid = (0, money_1.n)(rentRes.rows[0]?.paid);
        const waterPaid = (0, money_1.n)(waterRes.rows[0]?.paid);
        const unitId = rentRes.rows[0]?.unit_id ?? tenant.unit_id;
        const unitRes = await client.query('SELECT monthly_rent FROM units WHERE id = $1', [unitId]);
        const waterBillRes = await client.query(`SELECT COALESCE(SUM(water_bill), 0) AS bill FROM water_meter_readings
       WHERE unit_id = $1 AND billing_month = $2 AND billing_year = $3`, [unitId, input.billingMonth, input.billingYear]);
        const expectedRent = (0, money_1.n)(unitRes.rows[0]?.monthly_rent);
        const waterBill = (0, money_1.n)(waterBillRes.rows[0]?.bill);
        const totalBalance = (0, businessRules_1.balanceDue)(expectedRent + waterBill, rentPaid + waterPaid);
        const seq = await nextSequence('RWC', input.billingYear, client);
        const receiptNumber = (0, businessRules_1.formatReceiptNumber)('RWC', input.billingYear, seq);
        const res = await client.query(`INSERT INTO receipts
         (receipt_number, receipt_type, tenant_id, unit_id, payment_date,
          billing_month, billing_year, rent_amount, water_amount, total_amount, balance)
       VALUES ($1, 'COMBINED', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`, [
            receiptNumber, input.tenantId, unitId, new Date().toISOString().slice(0, 10),
            input.billingMonth, input.billingYear, rentPaid, waterPaid, rentPaid + waterPaid, totalBalance,
        ]);
        return res.rows[0];
    });
}
// Backfill: seeded payments were inserted directly (no receipts). Create a
// receipt per payment and link the receipt_number onto the payment row.
async function backfillReceipts() {
    let created = 0;
    await (0, db_1.withTransaction)(async (client) => {
        const rentPayments = await client.query(`SELECT rp.*, t.unit_id, u.monthly_rent
       FROM rent_payments rp
       JOIN tenants t ON t.id = rp.tenant_id
       JOIN units u ON u.id = rp.unit_id
       WHERE rp.receipt_number IS NULL
       ORDER BY rp.payment_date, rp.id`);
        for (const p of rentPayments.rows) {
            const paid = await client.query(`SELECT COALESCE(SUM(amount), 0) AS paid FROM rent_payments
         WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [p.tenant_id, p.billing_month, p.billing_year]);
            const balance = (0, businessRules_1.balanceDue)((0, money_1.n)(p.monthly_rent), (0, money_1.n)(paid.rows[0].paid));
            const receipt = await createReceipt({
                type: 'RENT', tenantId: p.tenant_id, unitId: p.unit_id,
                paymentDate: p.payment_date, billingMonth: p.billing_month, billingYear: p.billing_year,
                rentAmount: (0, money_1.n)(p.amount), waterAmount: 0, balance,
            }, client);
            await client.query('UPDATE rent_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, p.id]);
            created += 1;
        }
        const waterPayments = await client.query(`SELECT wp.*, t.unit_id
       FROM water_payments wp
       JOIN tenants t ON t.id = wp.tenant_id
       WHERE wp.receipt_number IS NULL
       ORDER BY wp.payment_date, wp.id`);
        for (const p of waterPayments.rows) {
            const billRes = await client.query(`SELECT COALESCE(SUM(water_bill), 0) AS bill FROM water_meter_readings
         WHERE unit_id = $1 AND billing_month = $2 AND billing_year = $3`, [p.unit_id, p.billing_month, p.billing_year]);
            const paid = await client.query(`SELECT COALESCE(SUM(amount), 0) AS paid FROM water_payments
         WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [p.tenant_id, p.billing_month, p.billing_year]);
            const balance = (0, businessRules_1.balanceDue)((0, money_1.n)(billRes.rows[0].bill), (0, money_1.n)(paid.rows[0].paid));
            const receipt = await createReceipt({
                type: 'WATER', tenantId: p.tenant_id, unitId: p.unit_id,
                paymentDate: p.payment_date, billingMonth: p.billing_month, billingYear: p.billing_year,
                rentAmount: 0, waterAmount: (0, money_1.n)(p.amount), balance,
            }, client);
            await client.query('UPDATE water_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, p.id]);
            created += 1;
        }
    });
    return created;
}
//# sourceMappingURL=receiptService.js.map