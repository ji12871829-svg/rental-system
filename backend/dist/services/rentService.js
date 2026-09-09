"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listRentPayments = listRentPayments;
exports.createRentPayment = createRentPayment;
exports.deleteRentPayment = deleteRentPayment;
exports.rentPaymentsCsv = rentPaymentsCsv;
exports.monthlyRentSummary = monthlyRentSummary;
const db_1 = require("../config/db");
const types_1 = require("../types");
const businessRules_1 = require("../utils/businessRules");
const httpError_1 = require("../utils/httpError");
const money_1 = require("../utils/money");
const auditService_1 = require("./auditService");
const receiptService_1 = require("./receiptService");
const smsService_1 = require("./smsService");
const settingsService_1 = require("./settingsService");
async function listRentPayments(filters) {
    const where = [];
    const params = [];
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
    const totalRow = await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count
     FROM rent_payments rp
     JOIN tenants t ON t.id = rp.tenant_id
     JOIN units u ON u.id = rp.unit_id
     ${whereSql}`, params);
    const total = Number(totalRow?.count ?? 0);
    const offset = (filters.page - 1) * filters.limit;
    const rows = await (0, db_1.query)(`SELECT rp.*, t.full_name AS tenant_name, t.phone_number, u.unit_number, u.monthly_rent
     FROM rent_payments rp
     JOIN tenants t ON t.id = rp.tenant_id
     JOIN units u ON u.id = rp.unit_id
     ${whereSql}
     ORDER BY rp.payment_date DESC, rp.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, filters.limit, offset]);
    // Status/balance per row: expected rent (current) vs total paid in month.
    const enriched = await Promise.all(rows.map(async (row) => {
        const paidRes = await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS paid FROM rent_payments
         WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [row.tenant_id, row.billing_month, row.billing_year]);
        const paid = (0, money_1.n)(paidRes?.paid);
        const expected = (0, money_1.n)(row.monthly_rent);
        return {
            ...row,
            expectedRent: expected,
            totalPaidForMonth: (0, money_1.round2)(paid),
            balance: (0, businessRules_1.balanceDue)(expected, paid),
            status: (0, businessRules_1.paymentStatus)(expected, paid),
        };
    }));
    return {
        rows: enriched,
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
}
// The full payment transaction (spec §43): validate → record → receipt →
// SMS prep → audit, all-or-nothing.
async function createRentPayment(input, userId) {
    const tenant = await (0, db_1.queryOne)('SELECT id, unit_id, full_name, status FROM tenants WHERE id = $1', [input.tenantId]);
    if (!tenant)
        throw (0, httpError_1.notFound)('Tenant not found.');
    if (tenant.status !== 'ACTIVE') {
        throw (0, httpError_1.unprocessable)('Tenant has moved out. Payments can no longer be recorded.');
    }
    if (!tenant.unit_id)
        throw (0, httpError_1.unprocessable)('Tenant has no assigned unit.');
    const unitId = tenant.unit_id; // narrowed copy — survives the closure below
    const unit = await (0, db_1.queryOne)('SELECT id, unit_number, monthly_rent FROM units WHERE id = $1', [unitId]);
    if (!unit)
        throw (0, httpError_1.notFound)('Unit not found.');
    const expectedRent = (0, money_1.n)(unit.monthly_rent);
    return (0, db_1.withTransaction)(async (client) => {
        const inserted = await client.query(`INSERT INTO rent_payments
         (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year,
          amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`, [
            input.paymentReference ?? null, input.tenantId, unitId, input.paymentDate,
            input.billingMonth, input.billingYear, input.amount, input.paymentMethod, input.notes ?? null,
        ]);
        const payment = inserted.rows[0];
        // Totals + status for the period (supports multiple payments per month).
        const totals = await client.query(`SELECT COALESCE(SUM(amount), 0) AS paid FROM rent_payments
       WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [input.tenantId, input.billingMonth, input.billingYear]);
        const paid = (0, money_1.n)(totals.rows[0].paid);
        const balance = (0, businessRules_1.balanceDue)(expectedRent, paid);
        const receipt = await (0, receiptService_1.createReceipt)({
            type: 'RENT',
            tenantId: input.tenantId,
            unitId,
            paymentDate: input.paymentDate,
            billingMonth: input.billingMonth,
            billingYear: input.billingYear,
            rentAmount: input.amount,
            waterAmount: 0,
            balance,
        }, client);
        await client.query('UPDATE rent_payments SET receipt_number = $1 WHERE id = $2', [receipt.receipt_number, payment.id]);
        await (0, smsService_1.prepareForReceipt)(receipt, client);
        const settings = await (0, settingsService_1.getSettings)();
        await (0, auditService_1.logAudit)({
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
                status: (0, businessRules_1.paymentStatus)(expectedRent, paid),
                balance,
            },
        });
        return {
            payment,
            receipt: receipt.receipt_number,
            expectedRent,
            totalPaidForMonth: (0, money_1.round2)(paid),
            balance,
            status: (0, businessRules_1.paymentStatus)(expectedRent, paid),
            tenant: { id: tenant.id, fullName: tenant.full_name },
            unit: { id: unit.id, unitNumber: unit.unit_number },
            currency: settings.currency,
            monthName: types_1.MONTH_NAMES[input.billingMonth - 1],
        };
    });
}
async function deleteRentPayment(id, userId) {
    const payment = await (0, db_1.queryOne)('SELECT id FROM rent_payments WHERE id = $1', [id]);
    if (!payment)
        throw (0, httpError_1.notFound)('Rent payment not found.');
    await (0, db_1.query)('DELETE FROM rent_payments WHERE id = $1', [id]);
    await (0, auditService_1.logAudit)({ userId, action: 'RENT_PAYMENT_DELETED', entity: 'rent_payments', entityId: id });
}
async function rentPaymentsCsv(filters) {
    const where = [];
    const params = [];
    if (filters.year) {
        params.push(filters.year);
        where.push(`rp.billing_year = $${params.length}`);
    }
    if (filters.month) {
        params.push(filters.month);
        where.push(`rp.billing_month = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await (0, db_1.query)(`SELECT rp.payment_date, rp.billing_month, rp.billing_year, t.full_name, u.unit_number,
            rp.amount, rp.payment_method, rp.receipt_number, rp.payment_reference
     FROM rent_payments rp
     JOIN tenants t ON t.id = rp.tenant_id
     JOIN units u ON u.id = rp.unit_id
     ${whereSql}
     ORDER BY rp.payment_date`, params);
    const header = 'payment_date,billing_month,billing_year,tenant,unit,amount,payment_method,receipt_number,payment_reference';
    const lines = rows.map((r) => [r.payment_date, r.billing_month, r.billing_year, `"${r.full_name}"`, r.unit_number, r.amount, r.payment_method, r.receipt_number ?? '', r.payment_reference ?? ''].join(','));
    return [header, ...lines].join('\n');
}
// Monthly rent summary for the reporting year (spec §27). Expected rent comes
// from unit monthly_rent and occupancy by tenant move-in/move-out dates —
// never from hard-coded totals.
async function monthlyRentSummary(year) {
    const settings = await (0, settingsService_1.getSettings)();
    const targetYear = year ?? settings.reporting_year;
    const rows = await (0, db_1.query)(`WITH months AS (
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
     ORDER BY mb.m`, [targetYear]);
    const totalUnits = await (0, db_1.queryOne)('SELECT COUNT(*)::text AS count FROM units');
    const unitCount = Number(totalUnits?.count ?? 0);
    return Promise.all(rows.map(async (r) => {
        const expected = (0, money_1.n)(r.expected);
        const collected = (0, money_1.n)(r.collected);
        const occupied = Number(r.occupied_units);
        // Per-tenant status counts for the month.
        const statuses = await (0, db_1.query)(`SELECT t.full_name,
              u.monthly_rent AS expected,
              COALESCE((SELECT SUM(amount) FROM rent_payments rp
                        WHERE rp.tenant_id = t.id AND rp.billing_month = $1::int AND rp.billing_year = $2::int), 0) AS paid
       FROM tenants t
       JOIN units u ON u.id = t.unit_id AND t.status = 'ACTIVE'
       WHERE t.move_in_date <= (DATE ($2::text || '-01-01') + $1 * INTERVAL '1 month' - INTERVAL '1 day')
         AND (t.move_out_date IS NULL OR t.move_out_date >= (DATE ($2::text || '-01-01') + ($1 - 1) * INTERVAL '1 month'))`, [r.month, targetYear]);
        let paidTenants = 0;
        let partialTenants = 0;
        let unpaidTenants = 0;
        for (const s of statuses) {
            const st = (0, businessRules_1.paymentStatus)((0, money_1.n)(s.expected), (0, money_1.n)(s.paid));
            if (st === 'PAID' || st === 'OVERPAID')
                paidTenants += 1;
            else if (st === 'PARTIAL')
                partialTenants += 1;
            else
                unpaidTenants += 1;
        }
        const percentage = expected > 0 ? (0, money_1.round2)((collected / expected) * 100) : 0;
        return {
            month: r.month,
            monthName: types_1.MONTH_NAMES[r.month - 1],
            expectedRent: expected,
            rentCollected: collected,
            rentOutstanding: (0, businessRules_1.balanceDue)(expected, collected),
            collectionPercentage: percentage,
            paidTenants,
            partialTenants,
            unpaidTenants,
            occupiedUnits: occupied,
            vacantUnits: Math.max(0, unitCount - occupied),
        };
    }));
}
//# sourceMappingURL=rentService.js.map