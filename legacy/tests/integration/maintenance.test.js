// Integration tests for maintenance: lifecycle transitions, resolved_at
// stamping, and rejection of illegal transitions (incl. direct open→resolved).
const app = require('../../server/src/app');
const { resetDatabase, loginAgent, csrfHeader } = require('./helpers');

describe('Maintenance API', () => {
  let agent;
  beforeAll(async () => {
    await resetDatabase();
    agent = await loginAgent(app);
  });

  describe('POST /api/maintenance', () => {
    it('creates a request in open status', async () => {
      const res = await agent
        .post('/api/maintenance').set(csrfHeader(agent))
        .send({ unitId: 2, description: 'Broken door handle', priority: 'medium' })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'open', priority: 'medium', unitNumber: '2', resolvedAt: null });
    });

    it('accepts a request without a tenant (vacant-unit walkthrough)', async () => {
      const res = await agent
        .post('/api/maintenance').set(csrfHeader(agent))
        .send({ unitId: 3, description: 'Fence inspection', priority: 'low' })
        .expect(201);
      expect(res.body.tenantId).toBe(null);
    });

    it('rejects a missing unit with 404', async () => {
      const res = await agent
        .post('/api/maintenance').set(csrfHeader(agent))
        .send({ unitId: 9999, description: 'x', priority: 'low' })
        .expect(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /api/maintenance/:id (status lifecycle)', () => {
    let id;
    beforeAll(async () => {
      const created = await agent
        .post('/api/maintenance').set(csrfHeader(agent))
        .send({ unitId: 1, description: 'Lifecycle request', priority: 'high' })
        .expect(201);
      id = created.body.id;
    });

    it('rejects open → resolved directly (must pass through in_progress)', async () => {
      const res = await agent
        .patch(`/api/maintenance/${id}`).set(csrfHeader(agent))
        .send({ status: 'resolved' })
        .expect(422);
      expect(res.body.error).toBe('INVALID_STATUS_TRANSITION');
    });

    it('allows open → in_progress → resolved', async () => {
      await agent.patch(`/api/maintenance/${id}`).set(csrfHeader(agent)).send({ status: 'in_progress' }).expect(200);
      const res = await agent
        .patch(`/api/maintenance/${id}`).set(csrfHeader(agent))
        .send({ status: 'resolved', cost: 250, assignedVendor: 'FixIt Co' })
        .expect(200);
      expect(res.body.status).toBe('resolved');
      expect(res.body.cost).toBe('250.00');
      expect(res.body.assignedVendor).toBe('FixIt Co');
      // resolved_at must be stamped on resolution (rule 7).
      expect(res.body.resolvedAt).toBeTruthy();
    });

    it('rejects reopening a resolved request (resolved → open)', async () => {
      const res = await agent
        .patch(`/api/maintenance/${id}`).set(csrfHeader(agent))
        .send({ status: 'open' })
        .expect(422);
      expect(res.body.error).toBe('INVALID_STATUS_TRANSITION');
    });

    it('allows open → cancelled', async () => {
      const created = await agent
        .post('/api/maintenance').set(csrfHeader(agent))
        .send({ unitId: 2, description: 'Cancel me', priority: 'low' })
        .expect(201);
      const res = await agent
        .patch(`/api/maintenance/${created.body.id}`).set(csrfHeader(agent))
        .send({ status: 'cancelled' })
        .expect(200);
      expect(res.body.status).toBe('cancelled');
      expect(res.body.resolvedAt).toBe(null); // cancelled is not resolved
    });
  });
});