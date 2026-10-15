// Regression tests for the dashboard money aggregates — two bugs that
// combined to print "-51,080" as "Overdue Arrears" on a fully-paid estate:
//
//   1. combined.totalOutstanding was NET (expected − collected): a move-out
//      drops the tenant's expected rent from the occupancy math while their
//      payments stay in collected, so the card went deeply negative. It is
//      now GROSS (floored per tenant): credits can never cancel debts.
//   2. tenantAdvances counted occupancy with the WRONG year parameter index
//      (occupiedInMonth yearIdx 2 = the current-month NUMBER as a year, e.g.
//      year 10 AD), so every tenancy failed the window, expected months were
//      0, and every paid tenant showed their whole YTD payments as "credit"
//      (KSh 547,740 across 18 tenants in production).
//
// Fixtures (own units/tenants/payments, cleaned up afterwards):
//   - a DEBTOR (moved in 2026-01-15, pays nothing): owes RENT × horizon;
//   - an OVERPAYER (moved in 2026-01-15, pays every live month once plus a
//     double January): credit of exactly one RENT.
// Both use water-disabled units so water math stays at exactly zero.
// Assertions are BASELINE-THEN-DELTA on the dashboard endpoint, so seed data
// can be anything — only this file's fixtures may move the numbers.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

const YEAR = 2026;
const MOVE_IN = '2026-01-15';

// Months the tenancies are live through the reporting horizon (January up to
// the current month when the suite runs in 2026, else the full year).
const HORIZON = new Date().getFullYear() === YEAR ? new Date().getMonth() + 1 : 12;

let adminToken = '';
let staffToken = '';

interface Fixture {
  tenantId: number;
  unitId: number;
  rent: number;
}

let debtor: Fixture | null = null;
let overpayer: Fixture | null = null;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

// Two DISTINCT vacant water-disabled units — the math under test only needs
// known rents and move-ins, and water-disabled keeps the water columns zero.
async function findTwoVacantWaterDisabledUnits(): Promise<{ id: number; monthly_rent: string }[]> {
  const res = await request(app)
    .get('/api/units?limit=100&occupancyStatus=VACANT')
    .set(auth(staffToken));
  expect(res.status).toBe(200);
  const units = (res.body.data as any[]).filter((u) => u.water_enabled === false);
  if (units.length < 2) throw new Error('need two vacant water-disabled units');
  return units.slice(0, 2);
}

async function createTenant(name: string, unitId: number): Promise<number> {
  const res = await request(app)
    .post('/api/tenants')
    .set(auth(adminToken))
    .send({ fullName: name, unitId, moveInDate: MOVE_IN, securityDeposit: 0 });
  expect(res.status).toBe(201);
  return res.body.data.id as number;
}

async function payRent(tenantId: number, month: number, amount: number): Promise<void> {
  const res = await request(app)
    .post('/api/rent/payments')
    .set(auth(staffToken))
    .send({
      tenantId,
      paymentDate: `2026-${String(month).padStart(2, '0')}-05`,
      billingMonth: month,
      billingYear: YEAR,
      amount,
      paymentMethod: 'CASH',
    });
  expect(res.status).toBe(201);
}

async function dashboardCombined(): Promise<{ totalOutstanding: number; advances: { count: number; total: number } }> {
  const res = await request(app).get(`/api/reports/dashboard?year=${YEAR}`).set(auth(adminToken));
  expect(res.status).toBe(200);
  const c = res.body.data.combined;
  return { totalOutstanding: c.totalOutstanding, advances: { count: c.tenantAdvances.count, total: c.tenantAdvances.total } };
}

let baseOutstanding = 0;
let baseAdvTotal = 0;
let baseAdvCount = 0;

async function cleanup(f: Fixture | null): Promise<void> {
  if (!f) return;
  await pool.query('DELETE FROM sms_notifications WHERE tenant_id = $1', [f.tenantId]);
  await pool.query('DELETE FROM email_notifications WHERE tenant_id = $1', [f.tenantId]);
  await pool.query('DELETE FROM rent_payments WHERE tenant_id = $1', [f.tenantId]);
  await pool.query('DELETE FROM receipts WHERE tenant_id = $1', [f.tenantId]);
  await pool.query('DELETE FROM tenants WHERE id = $1', [f.tenantId]);
  await pool.query(`UPDATE units SET occupancy_status = 'VACANT' WHERE id = $1`, [f.unitId]);
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  staffToken = await login('staff@rpms.local', 'Staff@2026!');

  const base = await dashboardCombined();
  baseOutstanding = base.totalOutstanding;
  baseAdvTotal = base.advances.total;
  baseAdvCount = base.advances.count;

  const [u1, u2] = await findTwoVacantWaterDisabledUnits();

  // Debtor: owes every live month, pays nothing.
  debtor = { tenantId: await createTenant('Gross Debtor', u1.id), unitId: u1.id, rent: Number(u1.monthly_rent) };

  // Overpayer: every live month paid once, January paid double — a credit of
  // exactly one month's rent (no duplicate-month rows needed).
  const oRent = Number(u2.monthly_rent);
  overpayer = { tenantId: await createTenant('Gross Creditor', u2.id), unitId: u2.id, rent: oRent };
  await payRent(overpayer.tenantId, 1, oRent * 2);
  for (let m = 2; m <= HORIZON; m++) await payRent(overpayer.tenantId, m, oRent);
}, 120000);

afterAll(async () => {
  await cleanup(debtor);
  await cleanup(overpayer);
  await pool.end();
});

describe('Dashboard gross money aggregates', () => {
  it('totalOutstanding is gross: the debtor owes, the credit does not cancel it, and it can never be negative', async () => {
    const after = await dashboardCombined();
    // The debtor's unpaid live months, in full. The pre-fix NET formula
    // moved by (debtor debt − overpayer payments) instead.
    expect(after.totalOutstanding - baseOutstanding).toBe(debtor!.rent * HORIZON);
    expect(after.totalOutstanding).toBeGreaterThanOrEqual(0);
  });

  it('tenantAdvances counts only true credit with move-in-aware expected rent', async () => {
    const after = await dashboardCombined();
    // Exactly one new credit tenant (the overpayer), worth exactly one
    // month's rent. The pre-fix year-index bug counted 0 expected months, so
    // the delta was the overpayer's WHOLE year of payments instead.
    expect(after.advances.count - baseAdvCount).toBe(1);
    expect(after.advances.total - baseAdvTotal).toBe(overpayer!.rent);
  });
});
