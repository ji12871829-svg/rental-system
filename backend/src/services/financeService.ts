import { query, queryOne } from '../config/db';
import { MONTH_NAMES } from '../types';
import { balanceDue, paymentStatus, rentCollectionRate } from '../utils/businessRules';
import { notFound } from '../utils/httpError';
import { monthlyReportPdfBytes } from '../utils/monthlyReportPdf';
import { arrearsReportPdfBytes } from '../utils/arrearsReportPdf';
import { n, round2 } from '../utils/money';
import { tenantStatementPdfBytes } from '../utils/tenantStatementPdf';
import { getSmsBalance } from './smsService';

// Shape of the Dashboard's compact messaging-health strip (SMS + email).
type BalanceStatusLike = ReturnType<typeof getSmsBalance> extends Promise<infer T> ? T : never;
interface SmsHealth {
  balance: BalanceStatusLike;
  sentThisMonth: number;
  failedThisMonth: number;
  // Most recent FAILED send this month, so the strip can say why (provider
  // rejection, bad number, ...) without leaving the dashboard.
  lastFailure: { at: string; reason: string } | null;
}

interface EmailHealth {
  sentThisMonth: number;
  failedThisMonth: number;
  pendingCount: number;
  lastFailure: { at: string; reason: string } | null;
}
import { getBusinessIdentity } from './brandingService';
import { monthlyRentSummary } from './rentService';
import { getSettings } from './settingsService';
import { monthlyWaterSummary, outstandingWaterByUnit, waterSummary } from './waterService';

function currentMonthForYear(year: number): number {
  const now = new Date();
  if (now.getFullYear() === year) return now.getMonth() + 1;
  return 12; // reporting year in the past/future → full-year view
}

// ---------------------------------------------------------------------------
// Dashboard (spec §30–§32)
// ---------------------------------------------------------------------------
export async function dashboard(year?: number): Promise<unknown> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;
  const currentMonth = currentMonthForYear(targetYear);

  const counts = await queryOne<{ total: string; occupied: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE occupancy_status = 'OCCUPIED')::text AS occupied
     FROM units`
  );
  const totalUnits = Number(counts?.total ?? 0);
  const occupied = Number(counts?.occupied ?? 0);
  const vacant = totalUnits - occupied;

  // Expected rent for the current month (occupied units).
  const expectedRentThisMonth = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(u.monthly_rent), 0)::text AS v
     FROM units u JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     WHERE t.move_in_date <= (DATE ($1::text || '-01-01') + $2 * INTERVAL '1 month' - INTERVAL '1 day')
       AND (t.move_out_date IS NULL OR t.move_out_date >= (DATE ($1::text || '-01-01') + ($2 - 1) * INTERVAL '1 month'))`,
    [targetYear, currentMonth]
  ))?.v);

  const rentCollected = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM rent_payments WHERE billing_year = $1`, [targetYear]
  ))?.v);
  const water = (await waterSummary(targetYear)) as {
    waterBilled: number; waterCollected: number; waterOutstanding: number;
    waterPurchased: number; waterSupplyCost: number; collectionRate: number;
    surplusDeficit: number;
  };
  const totalExpenses = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM expenses WHERE EXTRACT(YEAR FROM expense_date)::int = $1`, [targetYear]
  ))?.v);

  // Expected rent for the whole year-to-date (for YTD collection rate).
  const expectedRentYtd = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(u.monthly_rent * m.months), 0)::text AS v
     FROM units u
     JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     JOIN LATERAL (
       SELECT COUNT(*) AS months
       FROM generate_series(1, $2) AS mm
       WHERE (DATE ($1::text || '-01-01') + mm * INTERVAL '1 month' - INTERVAL '1 day') >= t.move_in_date
         AND (DATE ($1::text || '-01-01') + (mm - 1) * INTERVAL '1 month') <= COALESCE(t.move_out_date, DATE ($1::text || '-01-01') + 11 * INTERVAL '1 month')
     ) m ON TRUE`,
    [targetYear, currentMonth]
  ))?.v);

  const rentOutstanding = balanceDue(expectedRentYtd, rentCollected);
  const totalCollected = round2(rentCollected + water.waterCollected);

  // Charts
  const monthlyRent = await query<{ month: number; collected: string; expected: string }>(
    `SELECT m.m AS month,
            COALESCE((SELECT SUM(amount) FROM rent_payments WHERE billing_year = $1 AND billing_month = m.m), 0) AS collected,
            0 AS expected
     FROM generate_series(1, 12) AS m`,
    [targetYear]
  );
  const rentMonthlySummary = (await monthlyRentSummary(targetYear)) as any[];

  const rentByMethod = await query<{ method: string; total: string }>(
    `SELECT payment_method AS method, SUM(amount)::text AS total
     FROM rent_payments WHERE billing_year = $1
     GROUP BY payment_method ORDER BY total DESC`,
    [targetYear]
  );

  const outstandingRentByUnit = await query<{ unit_number: string; outstanding: string }>(
    `SELECT u.unit_number,
            (u.monthly_rent * COALESCE(occ.months, 0) - COALESCE((SELECT SUM(rp.amount) FROM rent_payments rp WHERE rp.unit_id = u.id AND rp.billing_year = $1::int), 0))::text AS outstanding
     FROM units u
     JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     JOIN LATERAL (
       -- Months the tenancy was actually live, matching expectedRentYtd
       -- semantics — a unit rented only since September must not show the
       -- whole year's rent as outstanding.
       SELECT COUNT(*)::int AS months
       FROM generate_series(1, $2) AS mm
       WHERE t.move_in_date <= (DATE ($1::text || '-01-01') + mm * INTERVAL '1 month' - INTERVAL '1 day')
         AND (t.move_out_date IS NULL OR t.move_out_date >= (DATE ($1::text || '-01-01') + (mm - 1) * INTERVAL '1 month'))
     ) occ ON TRUE
     ORDER BY outstanding DESC
     LIMIT 10`,
    [targetYear, currentMonth]
  );

  const monthlyWater = (await monthlyWaterSummary(targetYear)) as any[];
  const outstandingWater = (await outstandingWaterByUnit(targetYear)) as any[];
  // Compact SMS health for the Dashboard's SMS strip (balance + this month's
  // counts). Composed here so the page needs one request.
  const [sms, email] = await Promise.all([dashboardSmsHealth(), dashboardEmailHealth()]);

  return {
    reportingYear: targetYear,
    currency: settings.currency,
    sms: {
      balance: sms.balance,
      sentThisMonth: sms.sentThisMonth,
      failedThisMonth: sms.failedThisMonth,
      lastFailure: sms.lastFailure,
    },
    email: {
      sentThisMonth: email.sentThisMonth,
      failedThisMonth: email.failedThisMonth,
      pendingCount: email.pendingCount,
      lastFailure: email.lastFailure,
    },
    property: {
      totalUnits,
      occupiedUnits: occupied,
      vacantUnits: vacant,
      expectedRent: round2(expectedRentThisMonth),
      expectedRentYtd,
      rentCollected,
      rentOutstanding,
      rentCollectionRate: rentCollectionRate(rentCollected, expectedRentYtd),
      totalExpenses,
      netPropertyIncome: round2(totalCollected - totalExpenses),
    },
    water: {
      ...water,
      surplus: water.surplusDeficit >= 0,
    },
    combined: {
      totalDueThisMonth: round2(expectedRentThisMonth + water.waterBilled),
      totalCollected,
      totalOutstanding: round2(rentOutstanding + water.waterOutstanding),
      rentCollected,
      waterCollected: water.waterCollected,
      totalExpenses,
      netIncome: round2(totalCollected - totalExpenses),
    },
    charts: {
      monthlyRentCollected: monthlyRent.map((r) => ({ month: r.month, collected: n(r.collected) })),
      expectedVsCollected: rentMonthlySummary.map((r) => ({
        month: r.month, expected: r.expectedRent, collected: r.rentCollected,
      })),
      occupiedVsVacant: { occupied, vacant },
      rentByPaymentMethod: rentByMethod.map((r) => ({ method: r.method, total: n(r.total) })),
      outstandingRentByUnit: outstandingRentByUnit.map((r) => ({ unitNumber: r.unit_number, outstanding: n(r.outstanding) })),
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
export async function arrears(year?: number): Promise<unknown[]> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;
  const currentMonth = currentMonthForYear(targetYear);

  const occupiedUnits = await query<{
    id: number; unit_number: string; floor_name: string; monthly_rent: string;
    tenant_id: number; full_name: string; phone_number: string;
  }>(
    `SELECT u.id, u.unit_number, f.name AS floor_name, u.monthly_rent,
            t.id AS tenant_id, t.full_name, t.phone_number
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'`
  );

  return Promise.all(occupiedUnits.map(async (u) => {
    const expectedRent = n(u.monthly_rent);

    // Rent: expected YTD (from move-in) vs paid YTD.
    const rentPaid = n((await queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS v FROM rent_payments
       WHERE tenant_id = $1 AND billing_year = $2`, [u.tenant_id, targetYear]
    ))?.v);
    const rentExpectedYtd = n((await queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS v FROM (
         SELECT u2.monthly_rent AS amount
         FROM tenants t2
         JOIN units u2 ON u2.id = t2.unit_id
         CROSS JOIN generate_series(1, $3) AS mm
         WHERE t2.id = $1
           AND t2.move_in_date <= (DATE ($2::text || '-01-01') + mm * INTERVAL '1 month' - INTERVAL '1 day')
       ) s`,
      [u.tenant_id, targetYear, currentMonth]
    ))?.v);
    const rentBalance = balanceDue(rentExpectedYtd, rentPaid);

    // Water: billed vs paid YTD for the unit/tenant.
    const waterBilled = n((await queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(water_bill), 0)::text AS v FROM water_meter_readings
       WHERE unit_id = $1 AND billing_year = $2 AND billing_month <= $3`,
      [u.id, targetYear, currentMonth]
    ))?.v);
    const waterPaid = n((await queryOne<{ v: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments
       WHERE tenant_id = $1 AND billing_year = $2`, [u.tenant_id, targetYear]
    ))?.v);
    const waterBalance = balanceDue(waterBilled, waterPaid);

    // Months in arrears: months where the tenant was living in the unit
    // (same occupancy window as rentExpectedYtd above) AND paid less than
    // the rent due. Without the move-in filter, a tenant who moved in
    // mid-year carried every pre-move-in month as an arrears month and was
    // flagged OVERDUE on day one.
    const monthsInArrears = Number((await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM (
         SELECT mm AS month
         FROM generate_series(1, $3) AS mm
         JOIN tenants t ON t.id = $1
         JOIN units u2 ON u2.id = t.unit_id
         WHERE u2.monthly_rent > COALESCE((SELECT SUM(rp.amount) FROM rent_payments rp
                                           WHERE rp.tenant_id = t.id AND rp.billing_month = mm AND rp.billing_year = $2::int), 0)
           AND t.move_in_date <= (DATE ($2::text || '-01-01') + mm * INTERVAL '1 month' - INTERVAL '1 day')
           AND (t.move_out_date IS NULL OR t.move_out_date >= (DATE ($2::text || '-01-01') + (mm - 1) * INTERVAL '1 month'))
       ) s`,
      [u.tenant_id, targetYear, currentMonth]
    ))?.count ?? 0);

    const totalBalance = round2(rentBalance + waterBalance);
    let status: string;
    if (totalBalance < 0) status = 'OVERPAID';
    else if (rentBalance > 0 && monthsInArrears >= 2) status = 'OVERDUE';
    else if (rentBalance > 0 && rentPaid === 0) status = 'UNPAID';
    else if (rentBalance > 0) status = 'PARTIAL';
    else status = 'CLEARED';

    return {
      unitId: u.id,
      unitNumber: u.unit_number,
      floor: u.floor_name,
      tenantId: u.tenant_id,
      tenantName: u.full_name,
      phoneNumber: u.phone_number,
      monthlyRent: expectedRent,
      waterBill: waterBilled,
      totalAmountDue: round2(rentExpectedYtd + waterBilled),
      rentPaid,
      waterPaid,
      totalPaid: round2(rentPaid + waterPaid),
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
export async function tenantLedger(tenantId: number, year?: number): Promise<unknown> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;

  const tenant = await queryOne<{ id: number; full_name: string; phone_number: string; email: string | null; unit_id: number | null }>(
    'SELECT id, full_name, phone_number, email, unit_id FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (!tenant) throw notFound('Tenant not found.');

  const unit = tenant.unit_id
    ? await queryOne<{ id: number; unit_number: string; monthly_rent: string; water_enabled: boolean }>(
        'SELECT id, unit_number, monthly_rent, water_enabled FROM units WHERE id = $1',
        [tenant.unit_id]
      )
    : null;

  // ONE set-based query instead of the old 36 round-trips (3 per month × 12):
  // a 12-month spine LEFT JOINs per-month aggregates for rent paid, water
  // paid, and the meter reading (unique per unit+month+year in the schema).
  // All status/derivation logic stays in JS through the shared helpers so the
  // row shape is byte-identical to the loop version.
  const ledgerRows = await query<{
    month: number; unit_number: string | null; monthly_rent: string | null;
    rent_paid: string; water_paid: string;
    previous_reading: string | null; current_reading: string | null;
    consumption: string | null; water_bill: string | null;
  }>(
    `WITH months AS (SELECT generate_series(1, 12) AS m),
     tn AS (SELECT unit_id, move_in_date, move_out_date FROM tenants WHERE id = $1),
     rent AS (
       SELECT billing_month AS m, SUM(amount) AS paid
       FROM rent_payments WHERE tenant_id = $1 AND billing_year = $2::int
       GROUP BY billing_month
     ),
     water_paid AS (
       SELECT billing_month AS m, SUM(amount) AS paid
       FROM water_payments WHERE tenant_id = $1 AND billing_year = $2::int
       GROUP BY billing_month
     )
     SELECT ms.m AS month,
            u.unit_number,
            -- Expected rent follows the tenancy window: 0 before move-in and
            -- after move-out, the monthly rent for lived-in months. Keeps the
            -- ledger consistent with the move-in-aware YTD balances card.
            CASE WHEN tn.unit_id IS NULL THEN NULL
                 WHEN tn.move_in_date IS NOT NULL
                      AND tn.move_in_date <= (DATE ($2::text || '-01-01') + ms.m * INTERVAL '1 month' - INTERVAL '1 day')
                      AND (tn.move_out_date IS NULL OR tn.move_out_date >= (DATE ($2::text || '-01-01') + (ms.m - 1) * INTERVAL '1 month'))
                 THEN u.monthly_rent
                 ELSE 0 END AS monthly_rent,
            COALESCE(rp.paid, 0) AS rent_paid,
            COALESCE(wp.paid, 0) AS water_paid,
            wmr.previous_reading, wmr.current_reading, wmr.consumption,
            wmr.water_bill
     FROM months ms
     LEFT JOIN rent rp ON rp.m = ms.m
     LEFT JOIN water_paid wp ON wp.m = ms.m
     CROSS JOIN tn
     LEFT JOIN units u ON u.id = tn.unit_id
     LEFT JOIN water_meter_readings wmr
            ON wmr.unit_id = tn.unit_id AND wmr.billing_month = ms.m AND wmr.billing_year = $2::int
     ORDER BY ms.m`,
    [tenantId, targetYear]
  );

  const rows = ledgerRows.map((row) => {
    const expectedRent = row.monthly_rent === null ? 0 : n(row.monthly_rent);
    const rentPaid = n(row.rent_paid);
    const waterBill = n(row.water_bill);
    const waterPaid = n(row.water_paid);

    const rentBalance = balanceDue(expectedRent, rentPaid);
    const waterBalance = balanceDue(waterBill, waterPaid);
    const totalDue = round2(expectedRent + waterBill);
    const totalPaid = round2(rentPaid + waterPaid);
    const totalBalance = balanceDue(totalDue, totalPaid);

    return {
      month: row.month,
      monthName: MONTH_NAMES[row.month - 1],
      unit: row.unit_number ?? null,
      expectedRent,
      previousWaterReading: row.previous_reading === null ? null : n(row.previous_reading),
      currentWaterReading: row.current_reading === null ? null : n(row.current_reading),
      waterConsumed: row.consumption === null ? 0 : n(row.consumption),
      waterBill,
      rentPaid,
      waterPaid,
      totalPaid,
      rentBalance,
      waterBalance,
      totalBalance,
      status: totalDue > 0 ? paymentStatus(totalDue, totalPaid) : 'UNPAID',
    };
  });

  const totals = {
    rentPaid: round2(rows.reduce((s, r: any) => s + r.rentPaid, 0)),
    waterPaid: round2(rows.reduce((s, r: any) => s + r.waterPaid, 0)),
    totalPaid: round2(rows.reduce((s, r: any) => s + r.totalPaid, 0)),
    rentBalance: round2(rows.reduce((s, r: any) => s + r.rentBalance, 0)),
    waterBalance: round2(rows.reduce((s, r: any) => s + r.waterBalance, 0)),
    totalBalance: round2(rows.reduce((s, r: any) => s + r.totalBalance, 0)),
  };

  return {
    tenant: { id: tenant.id, fullName: tenant.full_name, phoneNumber: tenant.phone_number, email: tenant.email },
    unit: unit ? { id: unit.id, unitNumber: unit.unit_number, monthlyRent: n(unit.monthly_rent), waterEnabled: unit.water_enabled } : null,
    reportingYear: targetYear,
    currency: settings.currency,
    months: rows,
    totals,
  };
}

// ---------------------------------------------------------------------------
// Combined monthly summary (rent + water per month)
// ---------------------------------------------------------------------------
export async function combinedMonthlySummary(year?: number): Promise<unknown[]> {
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;
  const rent = (await monthlyRentSummary(targetYear)) as any[];
  const water = (await monthlyWaterSummary(targetYear)) as any[];

  return rent.map((r, i) => {
    const w = water[i] as any;
    return {
      month: r.month,
      monthName: r.monthName,
      expectedRent: r.expectedRent,
      rentCollected: r.rentCollected,
      rentOutstanding: r.rentOutstanding,
      waterBilled: w.waterBilled,
      waterCollected: w.waterCollected,
      waterOutstanding: w.waterOutstanding,
      totalDue: round2(r.expectedRent + w.waterBilled),
      totalCollected: round2(r.rentCollected + w.waterCollected),
      totalOutstanding: round2(r.rentOutstanding + w.waterOutstanding),
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
// Monthly financial report PDF — the combined monthly summary rendered as a
// one-page landscape document with year totals and the business identity
// footer. Reuses the same summary the Monthly Summary page displays.
export async function monthlyReportPdf(year: number): Promise<{ bytes: Uint8Array; year: number }> {
  const [rows, identity] = await Promise.all([
    combinedMonthlySummary(year),
    getBusinessIdentity(),
  ]);
  const bytes = await monthlyReportPdfBytes(
    { year, rows: rows as any, generatedAt: new Date() },
    identity
  );
  return { bytes, year };
}
// Per-tenant yearly statement PDF — the tenant ledger rendered as a one-page
// portrait document with year totals and the business identity footer.
// Reuses the exact tenantLedger data the ledger page displays.
export async function tenantStatementPdf(
  tenantId: number,
  year?: number
): Promise<{ bytes: Uint8Array; year: number; tenantName: string; tenantEmail: string | null }> {
  const [ledger, identity] = await Promise.all([
    tenantLedger(tenantId, year),
    getBusinessIdentity(),
  ]);
  const data = ledger as {
    tenant: { fullName: string; phoneNumber: string | null };
    unit: { unitNumber: string } | null;
    reportingYear: number;
    currency: string;
    months: any[];
    totals: any;
  };
  const bytes = await tenantStatementPdfBytes(
    {
      tenantName: data.tenant.fullName,
      tenantPhone: data.tenant.phoneNumber,
      unitLabel: data.unit?.unitNumber ?? null,
      year: data.reportingYear,
      currency: data.currency,
      months: data.months as any,
      totals: data.totals,
      generatedAt: new Date(),
    },
    identity
  );
  return { bytes, year: data.reportingYear, tenantName: data.tenant.fullName, tenantEmail: (ledger as any).tenant?.email ?? null };
}

// Dashboard SMS health: the wallet balance (live Africa's Talking only —
// mock/Twilio degrade to 'unknown' without erroring) composed with this
// month's send/failed counts. Never throws; the badge must not break the
// dashboard render.
async function dashboardSmsHealth(): Promise<SmsHealth> {
  const [balance, counts] = await Promise.all([
    getSmsBalance().catch(() => ({ state: 'unknown' as const, reason: 'Balance check failed.' })),
    queryOne<{ sent: string; failed: string }>(      `SELECT
         COUNT(*) FILTER (WHERE status = 'SENT')::text AS sent,
         COUNT(*) FILTER (WHERE status = 'FAILED')::text AS failed
       FROM sms_notifications
       WHERE created_at >= date_trunc('month', NOW())`,
      []
    ),
  ]);
  return {
    balance,
    sentThisMonth: Number(counts?.sent ?? 0),
    failedThisMonth: Number(counts?.failed ?? 0),
    lastFailure: await lastSmsFailure(),
  };
}

// Most recent failed SMS this month — at + truncated reason. null = none.
async function lastSmsFailure(): Promise<{ at: string; reason: string } | null> {
  const row = await queryOne<{ sent_at: Date | null; created_at: Date; failure_reason: string | null }>(
    `SELECT sent_at, created_at, failure_reason
     FROM sms_notifications
     WHERE status = 'FAILED' AND created_at >= date_trunc('month', NOW())
     ORDER BY COALESCE(sent_at, created_at) DESC
     LIMIT 1`
  );
  if (!row) return null;
  return {
    at: (row.sent_at ?? row.created_at).toISOString(),
    reason: (row.failure_reason ?? 'Unknown failure').slice(0, 300),
  };
}

// Dashboard email health: this month's sent/failed counts, rows still queued
// (PENDING), and the most recent failure with its provider reason. Never
// throws; the strip must not break the dashboard render.
async function dashboardEmailHealth(): Promise<EmailHealth> {
  const [counts, lastFailure] = await Promise.all([
    queryOne<{ sent: string; failed: string; pending: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'SENT')::text AS sent,
         COUNT(*) FILTER (WHERE status = 'FAILED')::text AS failed,
         COUNT(*) FILTER (WHERE status = 'PENDING')::text AS pending
       FROM email_notifications
       WHERE created_at >= date_trunc('month', NOW())`,
      []
    ),
    queryOne<{ sent_at: Date | null; created_at: Date; failure_reason: string | null }>(
      `SELECT sent_at, created_at, failure_reason
       FROM email_notifications
       WHERE status = 'FAILED' AND created_at >= date_trunc('month', NOW())
       ORDER BY COALESCE(sent_at, created_at) DESC
       LIMIT 1`
    ),
  ]);
  return {
    sentThisMonth: Number(counts?.sent ?? 0),
    failedThisMonth: Number(counts?.failed ?? 0),
    pendingCount: Number(counts?.pending ?? 0),
    lastFailure: lastFailure
      ? {
          at: (lastFailure.sent_at ?? lastFailure.created_at).toISOString(),
          reason: (lastFailure.failure_reason ?? 'Unknown failure').slice(0, 300),
        }
      : null,
  };
}

// Arrears report PDF — every occupied unit with outstanding rent/water
// balances for the reporting year, as a landscape document with totals and
// the business identity footer. Reuses the exact arrears() data the Arrears
// page displays.
export async function arrearsReportPdf(year: number): Promise<{ bytes: Uint8Array; year: number }> {
  const [rows, identity] = await Promise.all([
    arrears(year) as Promise<import('../utils/arrearsReportPdf').ArrearsPdfRow[]>,
    getBusinessIdentity(),
  ]);
  const bytes = await arrearsReportPdfBytes({ year, rows, generatedAt: new Date() }, identity);
  return { bytes, year };
}
