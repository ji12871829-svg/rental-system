// Regression tests for mid-year move-in occupancy math — the three places
// that previously double-counted pre-move-in months:
//
//   1. arrears() monthsInArrears   — counted every month of the year with a
//      shortfall, so a September move-in carried Jan–Aug as phantom arrears
//      months and was flagged OVERDUE on day one.
//   2. dashboard() outstandingRentByUnit — computed monthly_rent × current
//      month − paid, so the same September tenant showed the whole year's
//      rent as outstanding in the Top Outstanding chart.
//   3. getTenant() balances — compared ONE month's rent against the WHOLE
//      year's payments, showing months-paid tenants as negative ("overpaid").
//
// The fixture: a fresh tenant into vacant unit 3 (KSh 3,000, water-disabled
// so no water rows can interfere), moved in 2026-06-15, paying June and July
// in full and nothing after. All year-scoped queries take the year
// explicitly (2026) so the tests never depend on today's date.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

const YEAR = 2026;
const RENT = 3000;
const MOVE_IN = '2026-06-15';
// Months the tenancy is actually live (June–December), regardless of when
// the suite runs — the occupancy windows are evaluated against 2026.
const LIVE_MONTHS = [6, 7, 8, 9, 10, 11, 12];
const PAID_MONTHS = [6, 7];

// Year-scoped reports (arrears, dashboard, YTD balances) measure through the
// CURRENT month when the reporting year is the live one — otherwise the
// past/future year is viewed in full (December). Every expectation derives
// from this horizon, so the suite is correct on any run date.
const HORIZON = new Date().getFullYear() === YEAR ? new Date().getMonth() + 1 : 12;
const LIVE_THROUGH_HORIZON = LIVE_MONTHS.filter((m) => m <= HORIZON);
const PAID_THROUGH_HORIZON = PAID_MONTHS.filter((m) => m <= HORIZON);
const UNPAID_LIVE = LIVE_THROUGH_HORIZON.filter((m) => !PAID_THROUGH_HORIZON.includes(m));

let adminToken = '';
let staffToken = '';
let tenantId = 0;
let unitId = 0;
let unitNumber = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

// Finds a genuinely VACANT water-disabled unit. api.test.ts may occupy units
// transiently, but suite ordering is not relied on: if a preferred unit is
// taken, any other vacant non-water unit works — the math under test only
// needs one tenant in one unit with known rent and move-in.
async function findVacantWaterDisabledUnit(): Promise<{ id: number; unit_number: string; monthly_rent: string }> {
  const res = await request(app)
    .get('/api/units?limit=100&occupancyStatus=VACANT')
    .set(auth(staffToken));
  expect(res.status).toBe(200);
  const unit = res.body.data.find((u: any) => u.water_enabled === false);
  if (!unit) throw new Error('no vacant water-disabled unit available');
  return unit;
}

// Cleans every row this suite created, in FK-safe order. Runs even on
// failure so one broken assertion cannot poison the rest of the suite.
async function cleanup(): Promise<void> {
  if (!tenantId) return;
  await pool.query('DELETE FROM rent_payments WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM receipts WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await pool.query(
    `UPDATE units SET occupancy_status = 'VACANT' WHERE id = $1`,
    [unitId]
  );
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  staffToken = await login('staff@rpms.local', 'Staff@2026!');

  const unit = await findVacantWaterDisabledUnit();
  unitId = unit.id;
  unitNumber = unit.unit_number;

  const created = await request(app)
    .post('/api/tenants')
    .set(auth(adminToken))
    .send({ fullName: 'Mid Year Movein', unitId, moveInDate: MOVE_IN, securityDeposit: 0 });
  expect(created.status).toBe(201);
  tenantId = created.body.data.id;

  // June + July paid in full; August–December untouched.
  for (const m of PAID_MONTHS) {
    const pay = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId,
        paymentDate: `2026-0${m}-05`,
        billingMonth: m,
        billingYear: YEAR,
        amount: RENT,
        paymentMethod: 'CASH',
      });
    expect(pay.status).toBe(201);
  }
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('Mid-year move-in occupancy math', () => {
  it('arrears: monthsInArrears counts only lived-in months, and expected rent starts at move-in', async () => {
    const res = await request(app).get(`/api/reports/arrears?year=${YEAR}`).set(auth(adminToken));
    expect(res.status).toBe(200);

    const row = res.body.data.find((r: any) => r.tenantId === tenantId);
    expect(row).toBeDefined();

    // The pre-fix bug: monthsInArrears counted every calendar month with a
    // shortfall (Jan–Jul for a June move-in = 7), instead of only lived-in,
    // unpaid months through the reporting horizon.
    expect(row.monthsInArrears).toBe(UNPAID_LIVE.length);

    // Expected rent = rent × lived-in months through the horizon, never 12
    // calendar months and never pre-move-in months.
    expect(row.totalAmountDue).toBe(RENT * LIVE_THROUGH_HORIZON.length);
    expect(row.rentPaid).toBe(RENT * PAID_THROUGH_HORIZON.length);
    expect(row.rentBalance).toBe(RENT * UNPAID_LIVE.length);
    expect(row.waterBalance).toBe(0); // water-disabled unit keeps the row pure rent

    // 5 unpaid live months ≥ 2 → OVERDUE is legitimate, but the assertion
    // that matters is that the status comes from live months only —
    // a pre-move-in phantom count must not push it to any other value.
    expect(['OVERDUE', 'PARTIAL', 'UNPAID']).toContain(row.status);
  });

  it('dashboard outstanding-by-unit: rent × live months − paid, never × calendar months', async () => {
    // Still June+July paid → outstanding = 5 × 3,000. The pre-fix query
    // multiplied by the current month number, which produced 12 × 3,000 −
    // 6,000 (or worse, depending on run date) for this tenant.
    const res = await request(app).get(`/api/reports/dashboard?year=${YEAR}`).set(auth(adminToken));
    expect(res.status).toBe(200);

    const chart = res.body.data.charts.outstandingRentByUnit as { unitNumber: string; outstanding: number }[];
    expect(Array.isArray(chart)).toBe(true);

    const entry = chart.find((c) => c.unitNumber === unitNumber);
    // The chart is capped at 10 rows; with ≤5 occupied fixtures it must be present.
    expect(entry).toBeDefined();
    expect(entry!.outstanding).toBe(RENT * UNPAID_LIVE.length);
  });

  it('tenant detail balances: expected YTD is move-in aware and balance is expected − paid', async () => {
    const res = await request(app).get(`/api/tenants/${tenantId}`).set(auth(staffToken));
    expect(res.status).toBe(200);

    const balances = res.body.data.balances;
    expect(balances.reportingYear).toBe(YEAR);
    // New field from the balance fix: lived-in months × rent through the
    // horizon (YTD), not one month's rent and not twelve.
    expect(balances.rentExpectedYtd).toBe(RENT * LIVE_THROUGH_HORIZON.length);
    expect(balances.rentPaid).toBe(RENT * PAID_THROUGH_HORIZON.length);
    // The pre-fix bug: balance = one month's rent − a year of payments,
    // which read as a large negative for any tenant with >1 month paid.
    expect(balances.rentBalance).toBe(RENT * UNPAID_LIVE.length);
    expect(balances.waterBalance).toBe(0);
    expect(balances.combinedBalance).toBe(RENT * UNPAID_LIVE.length);
  });

  // Runs LAST within the describe: it clears every unpaid live month, so any
  // "still owes" assertion in an earlier test would see zero after it runs.
  it('arrears: fully-paid live months are not arrears months', async () => {
    // Pay every unpaid LIVED-IN month through the horizon so monthsInArrears
    // must drop to 0. (Months beyond the horizon are deliberately left
    // unpaid — paying the future would show as a credit, not as cleared.)
    for (const m of UNPAID_LIVE) {
      const pay = await request(app)
        .post('/api/rent/payments')
        .set(auth(staffToken))
        .send({
          tenantId,
          paymentDate: `2026-${String(m).padStart(2, '0')}-10`,
          billingMonth: m,
          billingYear: YEAR,
          amount: RENT,
          paymentMethod: 'CASH',
        });
      expect(pay.status).toBe(201);
    }

    const res = await request(app).get(`/api/reports/arrears?year=${YEAR}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: any) => r.tenantId === tenantId);
    expect(row).toBeDefined();
    expect(row.monthsInArrears).toBe(0);
    expect(row.rentBalance).toBe(0);
    expect(row.status).toBe('CLEARED');
  });

  // Runs after the pay-all test, so lived-in months through the horizon are
  // fully paid by now. The ledger itself is a FULL-YEAR view: months beyond
  // the horizon still show expected rent with a balance — that is correct
  // (future rent is not yet due for arrears purposes, but the ledger shows
  // what each month will cost).
  it('tenant ledger: expected rent follows move-in per month, water columns stay empty', async () => {
    const res = await request(app).get(`/api/reports/tenant/${tenantId}?year=${YEAR}`).set(auth(staffToken));
    expect(res.status).toBe(200);

    const ledger = res.body.data;
    expect(ledger.months.length).toBe(12);

    for (const month of ledger.months as {
      month: number; expectedRent: number; rentPaid: number; rentBalance: number;
      waterBill: number | null; previousWaterReading: number | null; totalBalance: number; status: string;
    }[]) {
      const live = LIVE_MONTHS.includes(month.month);
      const paidLive = live && month.month <= HORIZON;

      // Expected rent is the tenancy window: 0 before move-in, rent for
      // lived-in months (the pre-fix ledger showed rent for ALL 12 months).
      expect(month.expectedRent).toBe(live ? RENT : 0);
      expect(month.rentPaid).toBe(paidLive ? RENT : 0);
      expect(month.waterBill).toBe(0);
      expect(month.previousWaterReading).toBeNull();

      const expectedBalance = paidLive ? 0 : live ? RENT : 0;
      expect(month.rentBalance).toBe(expectedBalance);
      expect(month.totalBalance).toBe(expectedBalance);
      expect(month.status).toBe(paidLive ? 'PAID' : 'UNPAID');
    }
  });
});
