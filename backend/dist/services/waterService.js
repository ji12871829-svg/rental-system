"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listReadings = listReadings;
exports.createReading = createReading;
exports.updateReading = updateReading;
exports.deleteReading = deleteReading;
exports.listWaterPayments = listWaterPayments;
exports.createWaterPayment = createWaterPayment;
exports.deleteWaterPayment = deleteWaterPayment;
exports.listPurchases = listPurchases;
exports.createPurchase = createPurchase;
exports.updatePurchase = updatePurchase;
exports.deletePurchase = deletePurchase;
exports.waterSummary = waterSummary;
exports.monthlyWaterSummary = monthlyWaterSummary;
exports.outstandingWaterByUnit = outstandingWaterByUnit;
const db_1 = require("../config/db");
const types_1 = require("../types");
const businessRules_1 = require("../utils/businessRules");
const httpError_1 = require("../utils/httpError");
const money_1 = require("../utils/money");
const auditService_1 = require("./auditService");
const receiptService_1 = require("./receiptService");
const smsService_1 = require("./smsService");
const settingsService_1 = require("./settingsService");
async function listReadings(filters) {
    const where = [];
    const params = [];
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
    const totalRow = await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count FROM water_meter_readings wmr ${whereSql}`, params);
    const total = Number(totalRow?.count ?? 0);
    const offset = (filters.page - 1) * filters.limit;
    const rows = await (0, db_1.query)(`SELECT wmr.*, t.full_name AS tenant_name, u.unit_number, u.unit_type
     FROM water_meter_readings wmr
     JOIN units u ON u.id = wmr.unit_id
     LEFT JOIN tenants t ON t.id = wmr.tenant_id
     ${whereSql}
     ORDER BY wmr.reading_date DESC, wmr.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, filters.limit, offset]);
    const enriched = await Promise.all(rows.map(async (row) => {
        const paidRes = await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS paid FROM water_payments
         WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [row.tenant_id, row.billing_month, row.billing_year]);
        const paid = (0, money_1.n)(paidRes?.paid);
        const bill = (0, money_1.n)(row.water_bill);
        return {
            ...row,
            totalWaterPaid: (0, money_1.round2)(paid),
            waterBalance: (0, businessRules_1.balanceDue)(bill, paid),
            status: (0, businessRules_1.paymentStatus)(bill, paid),
        };
    }));
    return {
        rows: enriched,
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
}
// STRICT WATER RULE: only water_enabled units (12–23 in this property) may
// have readings. Enforced here AND by the DB trigger.
async function assertWaterEnabled(unitId) {
    const unit = await (0, db_1.queryOne)('SELECT id, unit_number, water_enabled, occupancy_status FROM units WHERE id = $1', [unitId]);
    if (!unit)
        throw (0, httpError_1.notFound)('Unit not found.');
    if (!unit.water_enabled) {
        throw (0, httpError_1.unprocessable)(`Unit ${unit.unit_number} does not support water billing.`);
    }
    const tenant = await (0, db_1.queryOne)('SELECT id FROM tenants WHERE unit_id = $1 AND status = $2', [unitId, 'ACTIVE']);
    return { unit_number: unit.unit_number, tenant_id: tenant?.id ?? null };
}
async function createReading(input, userId) {
    const { unit_number, tenant_id } = await assertWaterEnabled(input.unitId);
    const settings = await (0, settingsService_1.getSettings)();
    const waterRate = (0, money_1.n)(settings.water_rate);
    // Automatic previous reading: the most recent reading for the unit whose
    // reading_date precedes this one (chronological history).
    const previousRow = await (0, db_1.queryOne)(`SELECT current_reading, reading_date FROM water_meter_readings
     WHERE unit_id = $1 AND reading_date < $2
     ORDER BY reading_date DESC, id DESC
     LIMIT 1`, [input.unitId, input.readingDate]);
    const previousOverride = input.previousReading;
    const previous = previousOverride !== undefined
        ? previousOverride
        : previousRow ? (0, money_1.n)(previousRow.current_reading) : null;
    const result = (0, businessRules_1.computeWaterBill)(previous, input.currentReading, waterRate);
    if (!result.ok)
        throw (0, httpError_1.unprocessable)(result.error);
    try {
        const inserted = await (0, db_1.query)(`INSERT INTO water_meter_readings
         (unit_id, tenant_id, reading_date, billing_month, billing_year,
          previous_reading, current_reading, consumption, water_rate, water_bill)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`, [
            input.unitId, tenant_id, input.readingDate, input.billingMonth, input.billingYear,
            result.previousReading, result.currentReading, result.consumption, result.waterRate, result.waterBill,
        ]);
        await (0, auditService_1.logAudit)({
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
            monthName: types_1.MONTH_NAMES[input.billingMonth - 1],
            currency: settings.currency,
        };
    }
    catch (err) {
        if (err.code === '23505') {
            throw (0, httpError_1.conflict)('A meter reading for this unit and month already exists.', 'DUPLICATE_READING');
        }
        throw err;
    }
}
async function updateReading(id, input, userId) {
    const existing = await (0, db_1.queryOne)('SELECT id, unit_id, previous_reading, reading_date FROM water_meter_readings WHERE id = $1', [id]);
    if (!existing)
        throw (0, httpError_1.notFound)('Meter reading not found.');
    const settings = await (0, settingsService_1.getSettings)();
    if (input.currentReading === undefined)
        return existing;
    // Recompute consumption + bill; the previous reading stays fixed (it is
    // the historical reading the current one is measured against).
    const r = (0, businessRules_1.computeWaterBill)((0, money_1.n)(existing.previous_reading), input.currentReading, (0, money_1.n)(settings.water_rate));
    if (!r.ok)
        throw (0, httpError_1.unprocessable)(r.error);
    const updated = await (0, db_1.query)(`UPDATE water_meter_readings
     SET current_reading = $2, consumption = $3, water_bill = $4,
         reading_date = COALESCE($5, reading_date)
     WHERE id = $1
     RETURNING *`, [id, r.currentReading, r.consumption, r.waterBill, input.readingDate ?? null]);
    await (0, auditService_1.logAudit)({ userId, action: 'WATER_READING_UPDATED', entity: 'water_meter_readings', entityId: id });
    return updated[0];
}
async function deleteReading(id, userId) {
    const row = await (0, db_1.queryOne)('SELECT id FROM water_meter_readings WHERE id = $1', [id]);
    if (!row)
        throw (0, httpError_1.notFound)('Meter reading not found.');
    await (0, db_1.query)('DELETE FROM water_meter_readings WHERE id = $1', [id]);
    await (0, auditService_1.logAudit)({ userId, action: 'WATER_READING_DELETED', entity: 'water_meter_readings', entityId: id });
}
async function listWaterPayments(filters) {
    const where = [];
    const params = [];
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
    const totalRow = await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count
     FROM water_payments wp
     JOIN tenants t ON t.id = wp.tenant_id
     JOIN units u ON u.id = wp.unit_id
     ${whereSql}`, params);
    const total = Number(totalRow?.count ?? 0);
    const offset = (filters.page - 1) * filters.limit;
    const rows = await (0, db_1.query)(`SELECT wp.*, t.full_name AS tenant_name, u.unit_number
     FROM water_payments wp
     JOIN tenants t ON t.id = wp.tenant_id
     JOIN units u ON u.id = wp.unit_id
     ${whereSql}
     ORDER BY wp.payment_date DESC, wp.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, filters.limit, offset]);
    const enriched = await Promise.all(rows.map(async (row) => {
        const billRes = await (0, db_1.queryOne)(`SELECT COALESCE(SUM(water_bill), 0)::text AS bill FROM water_meter_readings
         WHERE unit_id = $1 AND billing_month = $2 AND billing_year = $3`, [row.unit_id, row.billing_month, row.billing_year]);
        const paidRes = await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS paid FROM water_payments
         WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [row.tenant_id, row.billing_month, row.billing_year]);
        const bill = (0, money_1.n)(billRes?.bill);
        const paid = (0, money_1.n)(paidRes?.paid);
        return {
            ...row,
            waterBill: bill,
            totalWaterPaid: (0, money_1.round2)(paid),
            waterBalance: (0, businessRules_1.balanceDue)(bill, paid),
            status: (0, businessRules_1.paymentStatus)(bill, paid),
        };
    }));
    return {
        rows: enriched,
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
}
async function createWaterPayment(input, userId) {
    const tenant = await (0, db_1.queryOne)('SELECT id, unit_id, full_name, status FROM tenants WHERE id = $1', [input.tenantId]);
    if (!tenant)
        throw (0, httpError_1.notFound)('Tenant not found.');
    if (!tenant.unit_id)
        throw (0, httpError_1.unprocessable)('Tenant has no assigned unit.');
    const waterUnitId = tenant.unit_id; // narrowed copy — survives the closure below
    await assertWaterEnabled(waterUnitId);
    const settings = await (0, settingsService_1.getSettings)();
    return (0, db_1.withTransaction)(async (client) => {
        const inserted = await client.query(`INSERT INTO water_payments
         (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`, [
            input.tenantId, waterUnitId, input.paymentDate, input.billingMonth,
            input.billingYear, input.amount, input.paymentMethod, input.notes ?? null,
        ]);
        const payment = inserted.rows[0];
        const billRes = await client.query(`SELECT COALESCE(SUM(water_bill), 0) AS bill FROM water_meter_readings
       WHERE unit_id = $1 AND billing_month = $2 AND billing_year = $3`, [waterUnitId, input.billingMonth, input.billingYear]);
        const paidRes = await client.query(`SELECT COALESCE(SUM(amount), 0) AS paid FROM water_payments
       WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [input.tenantId, input.billingMonth, input.billingYear]);
        const bill = (0, money_1.n)(billRes.rows[0].bill);
        const paid = (0, money_1.n)(paidRes.rows[0].paid);
        const balance = (0, businessRules_1.balanceDue)(bill, paid);
        const receipt = await (0, receiptService_1.createReceipt)({
            type: 'WATER',
            tenantId: input.tenantId,
            unitId: waterUnitId,
            paymentDate: input.paymentDate,
            billingMonth: input.billingMonth,
            billingYear: input.billingYear,
            rentAmount: 0,
            waterAmount: input.amount,
            balance,
        }, client);
        await client.query('UPDATE water_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, payment.id]);
        await (0, smsService_1.prepareForReceipt)(receipt, client);
        await (0, auditService_1.logAudit)({
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
            totalWaterPaid: (0, money_1.round2)(paid),
            waterBalance: balance,
            status: (0, businessRules_1.paymentStatus)(bill, paid),
            tenant: { id: tenant.id, fullName: tenant.full_name },
            currency: settings.currency,
            monthName: types_1.MONTH_NAMES[input.billingMonth - 1],
        };
    });
}
async function deleteWaterPayment(id, userId) {
    const row = await (0, db_1.queryOne)('SELECT id FROM water_payments WHERE id = $1', [id]);
    if (!row)
        throw (0, httpError_1.notFound)('Water payment not found.');
    await (0, db_1.query)('DELETE FROM water_payments WHERE id = $1', [id]);
    await (0, auditService_1.logAudit)({ userId, action: 'WATER_PAYMENT_DELETED', entity: 'water_payments', entityId: id });
}
async function listPurchases(filters) {
    const where = [];
    const params = [];
    if (filters.year) {
        params.push(filters.year);
        where.push(`EXTRACT(YEAR FROM purchase_date)::int = $${params.length}`);
    }
    if (filters.month) {
        params.push(filters.month);
        where.push(`EXTRACT(MONTH FROM purchase_date)::int = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count FROM water_purchases ${whereSql}`, params);
    const total = Number(totalRow?.count ?? 0);
    const offset = (filters.page - 1) * filters.limit;
    const rows = await (0, db_1.query)(`SELECT * FROM water_purchases ${whereSql}
     ORDER BY purchase_date DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, filters.limit, offset]);
    return {
        rows,
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
}
async function createPurchase(input, userId) {
    const totalCost = (0, money_1.round2)(input.quantity * input.costPerUnit); // spec §18
    const inserted = await (0, db_1.query)(`INSERT INTO water_purchases
       (purchase_date, supplier, quantity, measurement_unit, cost_per_unit, total_cost, payment_method, reference_number, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`, [
        input.purchaseDate, input.supplier, input.quantity,
        input.measurementUnit ?? 'units', input.costPerUnit, totalCost,
        input.paymentMethod, input.referenceNumber ?? null, input.notes ?? null,
    ]);
    await (0, auditService_1.logAudit)({ userId, action: 'WATER_PURCHASE_CREATED', entity: 'water_purchases', entityId: inserted[0].id });
    return inserted[0];
}
async function updatePurchase(id, input, userId) {
    const existing = await (0, db_1.queryOne)('SELECT id FROM water_purchases WHERE id = $1', [id]);
    if (!existing)
        throw (0, httpError_1.notFound)('Water purchase not found.');
    const qty = input.quantity ?? (0, money_1.n)((await (0, db_1.queryOne)('SELECT quantity FROM water_purchases WHERE id = $1', [id]))?.quantity);
    const cost = input.costPerUnit ?? (0, money_1.n)((await (0, db_1.queryOne)('SELECT cost_per_unit FROM water_purchases WHERE id = $1', [id]))?.cost_per_unit);
    const totalCost = (0, money_1.round2)(qty * cost);
    const updated = await (0, db_1.query)(`UPDATE water_purchases
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
     RETURNING *`, [id, input.purchaseDate ?? null, input.supplier ?? null, input.quantity ?? null,
        input.measurementUnit ?? null, input.costPerUnit ?? null, totalCost,
        input.paymentMethod ?? null, input.referenceNumber ?? null, input.notes ?? null]);
    await (0, auditService_1.logAudit)({ userId, action: 'WATER_PURCHASE_UPDATED', entity: 'water_purchases', entityId: id });
    return updated[0];
}
async function deletePurchase(id, userId) {
    const row = await (0, db_1.queryOne)('SELECT id FROM water_purchases WHERE id = $1', [id]);
    if (!row)
        throw (0, httpError_1.notFound)('Water purchase not found.');
    await (0, db_1.query)('DELETE FROM water_purchases WHERE id = $1', [id]);
    await (0, auditService_1.logAudit)({ userId, action: 'WATER_PURCHASE_DELETED', entity: 'water_purchases', entityId: id });
}
// ---------------------------------------------------------------------------
// Summaries (spec §19, §22, §24, §47)
// ---------------------------------------------------------------------------
async function waterSummary(year) {
    const settings = await (0, settingsService_1.getSettings)();
    const targetYear = year ?? settings.reporting_year;
    const billed = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(water_bill), 0)::text AS v FROM water_meter_readings WHERE billing_year = $1`, [targetYear]))?.v);
    const collected = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments WHERE billing_year = $1`, [targetYear]))?.v);
    const purchasedQty = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(quantity), 0)::text AS v FROM water_purchases WHERE EXTRACT(YEAR FROM purchase_date)::int = $1`, [targetYear]))?.v);
    const supplyCost = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(total_cost), 0)::text AS v FROM water_purchases WHERE EXTRACT(YEAR FROM purchase_date)::int = $1`, [targetYear]))?.v);
    return {
        waterBilled: billed,
        waterCollected: collected,
        waterOutstanding: (0, businessRules_1.balanceDue)(billed, collected),
        waterPurchased: purchasedQty,
        waterSupplyCost: supplyCost,
        averagePurchaseCost: purchasedQty > 0 ? (0, money_1.round2)(supplyCost / purchasedQty) : 0,
        collectionRate: (0, businessRules_1.waterCollectionRate)(collected, billed),
        surplusDeficit: (0, businessRules_1.waterSurplusDeficit)(collected, supplyCost),
        surplus: collected >= supplyCost,
        currency: settings.currency,
    };
}
async function monthlyWaterSummary(year) {
    const settings = await (0, settingsService_1.getSettings)();
    const targetYear = year ?? settings.reporting_year;
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    return Promise.all(months.map(async (m) => {
        const billed = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(water_bill), 0)::text AS v FROM water_meter_readings WHERE billing_year = $1 AND billing_month = $2`, [targetYear, m]))?.v);
        const collected = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments WHERE billing_year = $1 AND billing_month = $2`, [targetYear, m]))?.v);
        const supplyCost = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(total_cost), 0)::text AS v FROM water_purchases
       WHERE EXTRACT(YEAR FROM purchase_date)::int = $1 AND EXTRACT(MONTH FROM purchase_date)::int = $2`, [targetYear, m]))?.v);
        const purchased = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(quantity), 0)::text AS v FROM water_purchases
       WHERE EXTRACT(YEAR FROM purchase_date)::int = $1 AND EXTRACT(MONTH FROM purchase_date)::int = $2`, [targetYear, m]))?.v);
        return {
            month: m,
            monthName: types_1.MONTH_NAMES[m - 1],
            waterBilled: billed,
            waterCollected: collected,
            waterOutstanding: (0, businessRules_1.balanceDue)(billed, collected),
            waterPurchased: purchased,
            waterSupplyCost: supplyCost,
            surplusDeficit: (0, businessRules_1.waterSurplusDeficit)(collected, supplyCost),
            collectionRate: (0, businessRules_1.waterCollectionRate)(collected, billed),
            currency: settings.currency,
        };
    }));
}
// Outstanding water by unit — used by the arrears and dashboard charts.
async function outstandingWaterByUnit(year) {
    const settings = await (0, settingsService_1.getSettings)();
    const targetYear = year ?? settings.reporting_year;
    const rows = await (0, db_1.query)(`SELECT u.id, u.unit_number, t.full_name AS tenant_name,
            COALESCE(b.billed, 0) AS billed, COALESCE(p.paid, 0) AS paid
     FROM units u
     LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     LEFT JOIN (SELECT unit_id, SUM(water_bill) AS billed
                FROM water_meter_readings WHERE billing_year = $1 GROUP BY unit_id) b ON b.unit_id = u.id
     LEFT JOIN (SELECT unit_id, SUM(amount) AS paid
                FROM water_payments WHERE billing_year = $1 GROUP BY unit_id) p ON p.unit_id = u.id
     WHERE u.water_enabled = TRUE
     ORDER BY (COALESCE(b.billed, 0) - COALESCE(p.paid, 0)) DESC`, [targetYear]);
    return rows.map((r) => ({
        unitId: r.id,
        unitNumber: r.unit_number,
        tenantName: r.tenant_name,
        waterBilled: (0, money_1.n)(r.billed),
        waterPaid: (0, money_1.n)(r.paid),
        waterOutstanding: (0, businessRules_1.balanceDue)((0, money_1.n)(r.billed), (0, money_1.n)(r.paid)),
    }));
}
//# sourceMappingURL=waterService.js.map