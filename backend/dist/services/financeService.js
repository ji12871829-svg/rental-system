"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboard = dashboard;
exports.arrears = arrears;
exports.tenantLedger = tenantLedger;
exports.combinedMonthlySummary = combinedMonthlySummary;
const db_1 = require("../config/db");
const types_1 = require("../types");
const businessRules_1 = require("../utils/businessRules");
const httpError_1 = require("../utils/httpError");
const money_1 = require("../utils/money");
const rentService_1 = require("./rentService");
const settingsService_1 = require("./settingsService");
const waterService_1 = require("./waterService");
function currentMonthForYear(year) {
    const now = new Date();
    if (now.getFullYear() === year)
        return now.getMonth() + 1;
    return 12; // reporting year in the past/future → full-year view
}
// ---------------------------------------------------------------------------
// Dashboard (spec §30–§32)
// ---------------------------------------------------------------------------
async function dashboard(year) {
    const settings = await (0, settingsService_1.getSettings)();
    const targetYear = year ?? settings.reporting_year;
    const currentMonth = currentMonthForYear(targetYear);
    const totalUnits = Number((await (0, db_1.queryOne)('SELECT COUNT(*)::text AS count FROM units'))?.count ?? 0);
    const occupied = Number((await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count FROM units WHERE occupancy_status = 'OCCUPIED'`))?.count ?? 0);
    const vacant = totalUnits - occupied;
    // Expected rent for the current month (occupied units).
    const expectedRentThisMonth = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(u.monthly_rent), 0)::text AS v
     FROM units u JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     WHERE t.move_in_date <= (DATE ($1::text || '-01-01') + $2 * INTERVAL '1 month' - INTERVAL '1 day')
       AND (t.move_out_date IS NULL OR t.move_out_date >= (DATE ($1::text || '-01-01') + ($2 - 1) * INTERVAL '1 month'))`, [targetYear, currentMonth]))?.v);
    const rentCollected = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM rent_payments WHERE billing_year = $1`, [targetYear]))?.v);
    const water = (await (0, waterService_1.waterSummary)(targetYear));
    const totalExpenses = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM expenses WHERE EXTRACT(YEAR FROM expense_date)::int = $1`, [targetYear]))?.v);
    // Expected rent for the whole year-to-date (for YTD collection rate).
    const expectedRentYtd = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(u.monthly_rent * m.months), 0)::text AS v
     FROM units u
     JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     JOIN LATERAL (
       SELECT COUNT(*) AS months
       FROM generate_series(1, $2) AS mm
       WHERE (DATE ($1::text || '-01-01') + mm * INTERVAL '1 month' - INTERVAL '1 day') >= t.move_in_date
         AND (DATE ($1::text || '-01-01') + (mm - 1) * INTERVAL '1 month') <= COALESCE(t.move_out_date, DATE ($1::text || '-01-01') + 11 * INTERVAL '1 month')
     ) m ON TRUE`, [targetYear, currentMonth]))?.v);
    const rentOutstanding = (0, businessRules_1.balanceDue)(expectedRentYtd, rentCollected);
    const totalCollected = (0, money_1.round2)(rentCollected + water.waterCollected);
    // Charts
    const monthlyRent = await (0, db_1.query)(`SELECT m.m AS month,
            COALESCE((SELECT SUM(amount) FROM rent_payments WHERE billing_year = $1 AND billing_month = m.m), 0) AS collected,
            0 AS expected
     FROM generate_series(1, 12) AS m`, [targetYear]);
    const rentMonthlySummary = (await (0, rentService_1.monthlyRentSummary)(targetYear));
    const rentByMethod = await (0, db_1.query)(`SELECT payment_method AS method, SUM(amount)::text AS total
     FROM rent_payments WHERE billing_year = $1
     GROUP BY payment_method ORDER BY total DESC`, [targetYear]);
    const outstandingRentByUnit = await (0, db_1.query)(`SELECT u.unit_number,
            (u.monthly_rent * $2 - COALESCE((SELECT SUM(rp.amount) FROM rent_payments rp WHERE rp.unit_id = u.id AND rp.billing_year = $1), 0))::text AS outstanding
     FROM units u
     JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     ORDER BY outstanding DESC
     LIMIT 10`, [targetYear, currentMonth]);
    const monthlyWater = (await (0, waterService_1.monthlyWaterSummary)(targetYear));
    const outstandingWater = (await (0, waterService_1.outstandingWaterByUnit)(targetYear));
    return {
        reportingYear: targetYear,
        currency: settings.currency,
        property: {
            totalUnits,
            occupiedUnits: occupied,
            vacantUnits: vacant,
            expectedRent: (0, money_1.round2)(expectedRentThisMonth),
            expectedRentYtd,
            rentCollected,
            rentOutstanding,
            rentCollectionRate: (0, businessRules_1.rentCollectionRate)(rentCollected, expectedRentYtd),
            totalExpenses,
            netPropertyIncome: (0, money_1.round2)(totalCollected - totalExpenses),
        },
        water: {
            ...water,
            surplus: water.surplusDeficit >= 0,
        },
        combined: {
            totalDueThisMonth: (0, money_1.round2)(expectedRentThisMonth + water.waterBilled),
            totalCollected,
            totalOutstanding: (0, money_1.round2)(rentOutstanding + water.waterOutstanding),
            rentCollected,
            waterCollected: water.waterCollected,
            totalExpenses,
            netIncome: (0, money_1.round2)(totalCollected - totalExpenses),
        },
        charts: {
            monthlyRentCollected: monthlyRent.map((r) => ({ month: r.month, collected: (0, money_1.n)(r.collected) })),
            expectedVsCollected: rentMonthlySummary.map((r) => ({
                month: r.month, expected: r.expectedRent, collected: r.rentCollected,
            })),
            occupiedVsVacant: { occupied, vacant },
            rentByPaymentMethod: rentByMethod.map((r) => ({ method: r.method, total: (0, money_1.n)(r.total) })),
            outstandingRentByUnit: outstandingRentByUnit.map((r) => ({ unitNumber: r.unit_number, outstanding: (0, money_1.n)(r.outstanding) })),
            monthlyWaterBilledVsCollected: monthlyWater.map((r) => ({
                month: r.month, billed: r.waterBilled, collected: r.waterCollected,
            })),
            waterSupplyCostVsCollected: monthlyWater.map((r) => ({
                month: r.month, supplyCost: r.waterSupplyCost, collected: r.waterCollected,
            })),
            monthlyWaterSurplusDeficit: monthlyWater.map((r) => ({
                month: r.month, surplusDeficit: r.surplusDeficit,
            })),
            outstandingWaterByUnit: outstandingWater,
        },
    };
}
// ---------------------------------------------------------------------------
// Arrears (spec §29) — rent arrears and water arrears clearly separated.
// ---------------------------------------------------------------------------
async function arrears(year) {
    const settings = await (0, settingsService_1.getSettings)();
    const targetYear = year ?? settings.reporting_year;
    const currentMonth = currentMonthForYear(targetYear);
    const occupiedUnits = await (0, db_1.query)(`SELECT u.id, u.unit_number, f.name AS floor_name, u.monthly_rent,
            t.id AS tenant_id, t.full_name, t.phone_number
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'`);
    return Promise.all(occupiedUnits.map(async (u) => {
        const expectedRent = (0, money_1.n)(u.monthly_rent);
        // Rent: expected YTD (from move-in) vs paid YTD.
        const rentPaid = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM rent_payments
       WHERE tenant_id = $1 AND billing_year = $2`, [u.tenant_id, targetYear]))?.v);
        const rentExpectedYtd = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM (
         SELECT u2.monthly_rent AS amount
         FROM tenants t2
         JOIN units u2 ON u2.id = t2.unit_id
         CROSS JOIN generate_series(1, $3) AS mm
         WHERE t2.id = $1
           AND t2.move_in_date <= (DATE ($2::text || '-01-01') + mm * INTERVAL '1 month' - INTERVAL '1 day')
       ) s`, [u.tenant_id, targetYear, currentMonth]))?.v);
        const rentBalance = (0, businessRules_1.balanceDue)(rentExpectedYtd, rentPaid);
        // Water: billed vs paid YTD for the unit/tenant.
        const waterBilled = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(water_bill), 0)::text AS v FROM water_meter_readings
       WHERE unit_id = $1 AND billing_year = $2 AND billing_month <= $3`, [u.id, targetYear, currentMonth]))?.v);
        const waterPaid = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments
       WHERE tenant_id = $1 AND billing_year = $2`, [u.tenant_id, targetYear]))?.v);
        const waterBalance = (0, businessRules_1.balanceDue)(waterBilled, waterPaid);
        // Months in arrears: months where the tenant paid less than the rent due.
        const monthsInArrears = Number((await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count FROM (
         SELECT mm AS month
         FROM generate_series(1, $3) AS mm
         JOIN tenants t ON t.id = $1
         JOIN units u2 ON u2.id = t.unit_id
         WHERE u2.monthly_rent > COALESCE((SELECT SUM(rp.amount) FROM rent_payments rp
                                           WHERE rp.tenant_id = t.id AND rp.billing_month = mm AND rp.billing_year = $2), 0)
       ) s`, [u.tenant_id, targetYear, currentMonth]))?.count ?? 0);
        const totalBalance = (0, money_1.round2)(rentBalance + waterBalance);
        let status;
        if (totalBalance < 0)
            status = 'OVERPAID';
        else if (rentBalance > 0 && monthsInArrears >= 2)
            status = 'OVERDUE';
        else if (rentBalance > 0 && rentPaid === 0)
            status = 'UNPAID';
        else if (rentBalance > 0)
            status = 'PARTIAL';
        else
            status = 'CLEARED';
        return {
            unitId: u.id,
            unitNumber: u.unit_number,
            floor: u.floor_name,
            tenantId: u.tenant_id,
            tenantName: u.full_name,
            phoneNumber: u.phone_number,
            monthlyRent: expectedRent,
            waterBill: waterBilled,
            totalAmountDue: (0, money_1.round2)(rentExpectedYtd + waterBilled),
            rentPaid,
            waterPaid,
            totalPaid: (0, money_1.round2)(rentPaid + waterPaid),
            rentBalance,
            waterBalance,
            totalOutstanding: totalBalance,
            monthsInArrears,
            status,
        };
    }));
}
// ---------------------------------------------------------------------------
// Tenant ledger (spec §26) — one row per billing month.
// ---------------------------------------------------------------------------
async function tenantLedger(tenantId, year) {
    const settings = await (0, settingsService_1.getSettings)();
    const targetYear = year ?? settings.reporting_year;
    const tenant = await (0, db_1.queryOne)('SELECT id, full_name, phone_number, unit_id FROM tenants WHERE id = $1', [tenantId]);
    if (!tenant)
        throw (0, httpError_1.notFound)('Tenant not found.');
    const unit = tenant.unit_id
        ? await (0, db_1.queryOne)('SELECT id, unit_number, monthly_rent, water_enabled FROM units WHERE id = $1', [tenant.unit_id])
        : null;
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const rows = await Promise.all(months.map(async (m) => {
        const expectedRent = unit ? (0, money_1.n)(unit.monthly_rent) : 0;
        const rentPaid = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM rent_payments
       WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [tenantId, m, targetYear]))?.v);
        const reading = unit ? await (0, db_1.queryOne)(`SELECT previous_reading, current_reading, consumption, water_bill, water_rate, reading_date
       FROM water_meter_readings WHERE unit_id = $1 AND billing_month = $2 AND billing_year = $3`, [unit.id, m, targetYear]) : null;
        const waterBill = reading ? (0, money_1.n)(reading.water_bill) : 0;
        const waterPaid = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments
       WHERE tenant_id = $1 AND billing_month = $2 AND billing_year = $3`, [tenantId, m, targetYear]))?.v);
        const rentBalance = (0, businessRules_1.balanceDue)(expectedRent, rentPaid);
        const waterBalance = (0, businessRules_1.balanceDue)(waterBill, waterPaid);
        const totalDue = (0, money_1.round2)(expectedRent + waterBill);
        const totalPaid = (0, money_1.round2)(rentPaid + waterPaid);
        const totalBalance = (0, businessRules_1.balanceDue)(totalDue, totalPaid);
        return {
            month: m,
            monthName: types_1.MONTH_NAMES[m - 1],
            unit: unit ? unit.unit_number : null,
            expectedRent,
            previousWaterReading: reading ? (0, money_1.n)(reading.previous_reading) : null,
            currentWaterReading: reading ? (0, money_1.n)(reading.current_reading) : null,
            waterConsumed: reading ? (0, money_1.n)(reading.consumption) : 0,
            waterBill,
            rentPaid,
            waterPaid,
            totalPaid,
            rentBalance,
            waterBalance,
            totalBalance,
            status: totalDue > 0 ? (0, businessRules_1.paymentStatus)(totalDue, totalPaid) : 'UNPAID',
        };
    }));
    const totals = {
        rentPaid: (0, money_1.round2)(rows.reduce((s, r) => s + r.rentPaid, 0)),
        waterPaid: (0, money_1.round2)(rows.reduce((s, r) => s + r.waterPaid, 0)),
        totalPaid: (0, money_1.round2)(rows.reduce((s, r) => s + r.totalPaid, 0)),
        rentBalance: (0, money_1.round2)(rows.reduce((s, r) => s + r.rentBalance, 0)),
        waterBalance: (0, money_1.round2)(rows.reduce((s, r) => s + r.waterBalance, 0)),
        totalBalance: (0, money_1.round2)(rows.reduce((s, r) => s + r.totalBalance, 0)),
    };
    return {
        tenant: { id: tenant.id, fullName: tenant.full_name, phoneNumber: tenant.phone_number },
        unit: unit ? { id: unit.id, unitNumber: unit.unit_number, monthlyRent: (0, money_1.n)(unit.monthly_rent), waterEnabled: unit.water_enabled } : null,
        reportingYear: targetYear,
        currency: settings.currency,
        months: rows,
        totals,
    };
}
// ---------------------------------------------------------------------------
// Combined monthly summary (rent + water per month)
// ---------------------------------------------------------------------------
async function combinedMonthlySummary(year) {
    const settings = await (0, settingsService_1.getSettings)();
    const targetYear = year ?? settings.reporting_year;
    const rent = (await (0, rentService_1.monthlyRentSummary)(targetYear));
    const water = (await (0, waterService_1.monthlyWaterSummary)(targetYear));
    return rent.map((r, i) => {
        const w = water[i];
        return {
            month: r.month,
            monthName: r.monthName,
            expectedRent: r.expectedRent,
            rentCollected: r.rentCollected,
            rentOutstanding: r.rentOutstanding,
            waterBilled: w.waterBilled,
            waterCollected: w.waterCollected,
            waterOutstanding: w.waterOutstanding,
            totalDue: (0, money_1.round2)(r.expectedRent + w.waterBilled),
            totalCollected: (0, money_1.round2)(r.rentCollected + w.waterCollected),
            totalOutstanding: (0, money_1.round2)(r.rentOutstanding + w.waterOutstanding),
            collectionPercentage: r.collectionPercentage,
            paidTenants: r.paidTenants,
            partialTenants: r.partialTenants,
            unpaidTenants: r.unpaidTenants,
            occupiedUnits: r.occupiedUnits,
            vacantUnits: r.vacantUnits,
            currency: settings.currency,
        };
    });
}
//# sourceMappingURL=financeService.js.map