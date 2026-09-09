// Integration tests for leases: creation, overlap rejection, unit status
// sync, date-range validation, status transitions. (Coverage per
// IMPLEMENTATION-PLAN.md Phase 3 exit criteria.)
const app = require('../../server/src/app');
const { resetDatabase, loginAgent, csrfHeader } = require('./helpers');

describe('Leases API', () => {
  let agent;
  beforeAll(async () => {
    await resetDatabase();
    agent = await loginAgent(app);
  });

  describe('POST /api/leases', () => {
    it('creates a lease for a vacant unit and flips the unit to occupied', async () => {
      // Seed unit 3 is vacant; tenant 2 (Peter) is free.
      const res = await agent
        .post('/api/leases').set(csrfHeader(agent))
        .send({ unitId: 3, tenantId: 2, startDate: '2026-09-01', endDate: '2027-08-31', monthlyRent: 350, depositAmount: 350 })
        .expect(201);
      expect(res.body).toMatchObject({
        unitNumber: '3',
        tenantName: 'Peter Otieno',
        status: 'active',
        monthlyRent: '350.00',
        depositAmount: '350.00',
      });
      // Unit status side effect (same transaction).
      const unit = await agent.get('/api/units/3').expect(200);
      expect(unit.body.status).toBe('occupied');
    });

    it('rejects an overlapping active lease with 409 (controller pre-check)', async () => {
      // Seed lease 1 covers unit 1 for 2026-01-01 → 2026-12-31 (active).
      const res = await agent
        .post('/api/leases').set(csrfHeader(agent))
        .send({ unitId: 1, tenantId: 2, startDate: '2026-06-01', endDate: '2027-05-31', monthlyRent: 400 })
        .expect(409);
      expect(res.body.error).toBe('LEASE_OVERLAP');
      expect(res.body.message).toContain('already has an active lease');
    });

    it('rejects end_date <= start_date with 422', async () => {
      const res = await agent
        .post('/api/leases').set(csrfHeader(agent))
        .send({ unitId: 2, tenantId: 1, startDate: '2027-02-01', endDate: '2026-12-31', monthlyRent: 400 })
        .expect(422);
      expect(res.body.error).toBe('INVALID_DATE_RANGE');
    });

    it('rejects a lease for a missing unit with 404', async () => {
      const res = await agent
        .post('/api/leases').set(csrfHeader(agent))
        .send({ unitId: 9999, tenantId: 2, startDate: '2027-01-01', endDate: '2027-12-31', monthlyRent: 400 })
        .expect(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });

  describe('unit status sync on termination', () => {
    it('flips the unit back to vacant when its only active lease is terminated', async () => {
      // Lease 1 (unit 1) is active → terminate (PATCH status).
      const res = await agent
        .patch('/api/leases/1').set(csrfHeader(agent))
        .send({ status: 'terminated' })
        .expect(200);
      expect(res.body.status).toBe('terminated');
      const unit = await agent.get('/api/units/1').expect(200);
      expect(unit.body.status).toBe('vacant');
    });

    it('rejects illegal lease status transitions with 422', async () => {
      // Lease 2 is active: reactivating/re-asserting the same status is invalid.
      const res = await agent
        .patch('/api/leases/2').set(csrfHeader(agent))
        .send({ status: 'active' })
        .expect(422);
      expect(res.body.error).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('DELETE /api/leases/:id', () => {
    it('is not allowed (405) — leases are history, use PATCH to terminate', async () => {
      const res = await agent.delete('/api/leases/1').set(csrfHeader(agent)).expect(405);
      expect(res.body.error).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('GET /api/leases', () => {
    it('returns leases joined with unit number and tenant name', async () => {
      const res = await agent.get('/api/leases?status=active').expect(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data[0]).toHaveProperty('unitNumber');
      expect(res.body.data[0]).toHaveProperty('tenantName');
      expect(res.body.data[0]).toHaveProperty('startDate');
    });
  });
});