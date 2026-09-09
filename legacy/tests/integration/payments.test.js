// Integration tests for payments: creation, balance-due calculation,
// terminated-lease rejection, duplicate guard, CSV export.
const app = require('../../server/src/app');
const { resetDatabase, loginAgent, csrfHeader } = require('./helpers');

// Balance-due truth table for seeded leases as of 2026-09-05 (see
// calculateCyclesElapsed Q3): lease 1 (Jan start) = 9 cycles × 350 = 3150;
// lease 2 (Feb start) = 8 cycles × 500 = 4000. Seed payments: 700 / 500.
describe('Payments API', () => {
  let agent;
  beforeAll(async () => {
    await resetDatabase();
    agent = await loginAgent(app);
  });

  describe('POST /api/payments', () => {
    it('records a payment and returns the updated balanceDue', async () => {
      // Lease 1: due 3150, paid 700 → balance 2450. Pay 350 → 2100.
      const res = await agent
        .post('/api/payments').set(csrfHeader(agent))
        .send({ leaseId: 1, amount: 350, paymentDate: '2026-09-02', paymentMethod: 'mpesa', referenceNumber: 'MPESA-IT-1' })
        .expect(201);
      expect(res.body).toMatchObject({ leaseId: 1, amount: '350.00', unitNumber: '1', tenantName: 'Jane Wanjiru' });
      expect(res.body.balanceDue).toBe('2100.00');
    });

    it('accepts partial payments (balance remains)', async () => {
      const res = await agent
        .post('/api/payments').set(csrfHeader(agent))
        .send({ leaseId: 2, amount: 100, paymentDate: '2026-09-02', paymentMethod: 'cash', notes: 'partial' })
        .expect(201);
      // Lease 2: due 4000, paid 500 → after 100 more → 3400.
      expect(res.body.balanceDue).toBe('3400.00');
    });

    it('accepts overpayments (negative balance) without error', async () => {
      const res = await agent
        .post('/api/payments').set(csrfHeader(agent))
        .send({ leaseId: 2, amount: 5000, paymentDate: '2026-09-02', paymentMethod: 'bank_transfer' })
        .expect(201);
      expect(Number(res.body.balanceDue)).toBeLessThan(0);
    });

    it('rejects a payment against a terminated lease with 409 LEASE_TERMINATED', async () => {
      await agent.patch('/api/leases/1').set(csrfHeader(agent)).send({ status: 'terminated' }).expect(200);
      const res = await agent
        .post('/api/payments').set(csrfHeader(agent))
        .send({ leaseId: 1, amount: 350, paymentDate: '2026-09-02', paymentMethod: 'cash' })
        .expect(409);
      expect(res.body.error).toBe('LEASE_TERMINATED');
    });

    it('rejects a zero/negative amount with 422', async () => {
      const res = await agent
        .post('/api/payments').set(csrfHeader(agent))
        .send({ leaseId: 2, amount: 0, paymentDate: '2026-09-02', paymentMethod: 'cash' })
        .expect(422);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects an invalid payment method with 422', async () => {
      const res = await agent
        .post('/api/payments').set(csrfHeader(agent))
        .send({ leaseId: 2, amount: 100, paymentDate: '2026-09-02', paymentMethod: 'bitcoin' })
        .expect(422);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('blocks a duplicate payment recorded within 60s (409 DUPLICATE_PAYMENT)', async () => {
      const payload = { leaseId: 2, amount: 123.45, paymentDate: '2026-09-02', paymentMethod: 'card', referenceNumber: 'CARD-DUP' };
      await agent.post('/api/payments').set(csrfHeader(agent)).send(payload).expect(201);
      const res = await agent.post('/api/payments').set(csrfHeader(agent)).send(payload).expect(409);
      expect(res.body.error).toBe('DUPLICATE_PAYMENT');
    });
  });

  describe('GET /api/payments', () => {
    it('returns payments with date-range filtering', async () => {
      const res = await agent
        .get('/api/payments?dateFrom=2026-02-01&dateTo=2026-02-28')
        .expect(200);
      // Seed has exactly two February payments (Jan 3 payment excluded by filter).
      expect(res.body.data.length).toBe(2);
      // paymentDate is YYYY-MM-DD → lexicographic comparison is correct.
      res.body.data.forEach((p) => {
        expect(p.paymentDate >= '2026-02-01' && p.paymentDate <= '2026-02-28').toBe(true);
      });
    });
  });

  describe('GET /api/payments/export', () => {
    it('streams a CSV with headers and formatted dates', async () => {
      const res = await agent.get('/api/payments/export').expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text).toContain('id,lease_id,unit_number,tenant_name,amount,payment_date');
      // Dates must be YYYY-MM-DD, never a locale string.
      expect(res.text).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(res.text).not.toMatch(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    });
  });
});