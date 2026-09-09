// Integration tests for the four /reports endpoints. Numbers are derived
// from the seed data — see tests/integration/payments.test.js truth table.
const app = require('../../server/src/app');
const { resetDatabase, loginAgent } = require('./helpers');

describe('Reports API (seeded data, month = Sep 2026)', () => {
  let agent;
  beforeAll(async () => {
    await resetDatabase();
    agent = await loginAgent(app);
  });

  describe('GET /api/reports/occupancy', () => {
    it('returns seeded occupancy (3 units, 2 occupied, 1 vacant, 67%)', async () => {
      const res = await agent
        .get('/api/reports/occupancy?month=9&year=2026')
        .expect(200);
      expect(res.body).toMatchObject({
        totalUnits: 3,
        occupiedUnits: 2,
        vacantUnits: 1,
        maintenanceUnits: 0,
        occupancyRate: 66.7,
      });
    });

    it('rejects invalid month/year with 422', async () => {
      const res = await agent
        .get('/api/reports/occupancy?month=13&year=2026')
        .expect(422);
      expect(res.body.error).toBe('INVALID_MONTH_YEAR');
    });
  });

  describe('GET /api/reports/rent-collection', () => {
    it('returns totals for the seeded month', async () => {
      // Sep 2026: leases 1 (350) + 2 (500) cover the month → billed 850;
      // seed payments in Sep: none → collected 0.
      const res = await agent
        .get('/api/reports/rent-collection?month=9&year=2026')
        .expect(200);
      expect(res.body.totalBilled).toBe('850.00');
      expect(res.body.totalCollected).toBe('0.00');
      expect(res.body.outstandingBalance).toBe('850.00');
      expect(res.body.byUnit).toHaveLength(3);
      const unit1 = res.body.byUnit.find((u) => u.unitNumber === '1');
      expect(unit1.billed).toBe('350.00');
    });
  });

  describe('GET /api/reports/upcoming-lease-expirations', () => {
    it('returns active leases ending within the window', async () => {
      const res = await agent
        .get('/api/reports/upcoming-lease-expirations?withinDays=200')
        .expect(200);
      // Lease 1 ends 2026-12-31 (119 days from 2026-09-05) → included.
      expect(res.body.count).toBeGreaterThanOrEqual(1);
      expect(res.body.leases[0]).toHaveProperty('daysUntilExpiry');
    });

    it('returns zero leases for a too-small window', async () => {
      const res = await agent
        .get('/api/reports/upcoming-lease-expirations?withinDays=1')
        .expect(200);
      expect(res.body.count).toBe(0);
    });
  });

  describe('GET /api/reports/outstanding-balances', () => {
    it('computes balances from the cycle formula', async () => {
      const res = await agent
        .get('/api/reports/outstanding-balances')
        .expect(200);
      // Lease 1: 9 cycles × 350 − 700 paid = 2450; lease 2: 8 × 500 − 500 = 3500.
      const b1 = res.body.balances.find((b) => b.leaseId === 1);
      const b2 = res.body.balances.find((b) => b.leaseId === 2);
      expect(b1.balanceDue).toBe('2450.00');
      expect(b2.balanceDue).toBe('3500.00');
      expect(res.body.totalOutstanding).toBe('5950.00');
    });
  });
});