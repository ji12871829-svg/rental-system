// Integration tests for units CRUD + pagination + duplicate detection.
const app = require('../../server/src/app');
const { resetDatabase, loginAgent, csrfHeader } = require('./helpers');

describe('Units API', () => {
  let agent;
  beforeAll(async () => {
    await resetDatabase();
    agent = await loginAgent(app);
  });

  describe('GET /api/units', () => {
    it('returns paginated units', async () => {
      const res = await agent.get('/api/units?page=1&limit=2').expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, totalPages: 2 });
      expect(res.body.data[0]).toHaveProperty('unitNumber');
    });

    it('filters by status', async () => {
      const res = await agent.get('/api/units?status=vacant').expect(200);
      expect(res.body.data.every((u) => u.status === 'vacant')).toBe(true);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('clamps limit to 100', async () => {
      const res = await agent.get('/api/units?limit=9999').expect(200);
      expect(res.body.pagination.limit).toBe(100);
    });
  });

  describe('POST /api/units', () => {
    it('creates a unit', async () => {
      const res = await agent
        .post('/api/units')
        .set(csrfHeader(agent))
        .send({ unitNumber: '4A', floor: '2nd', bedrooms: 2, bathrooms: 2, squareFeet: 800, baseRent: 600 })
        .expect(201);
      expect(res.body).toMatchObject({ unitNumber: '4A', baseRent: '600.00', status: 'vacant' });
    });

    it('rejects a duplicate unit_number with 409', async () => {
      const res = await agent
        .post('/api/units')
        .set(csrfHeader(agent))
        .send({ unitNumber: '1', baseRent: 100 })
        .expect(409);
      expect(res.body.error).toBe('DUPLICATE_UNIT_NUMBER');
    });

    it('rejects negative rent with 422', async () => {
      const res = await agent
        .post('/api/units')
        .set(csrfHeader(agent))
        .send({ unitNumber: '5B', baseRent: -10 })
        .expect(422);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/units/:id', () => {
    it('updates unit fields', async () => {
      const res = await agent
        .patch('/api/units/1')
        .set(csrfHeader(agent))
        .send({ baseRent: 375.5, notes: 'Renovated' })
        .expect(200);
      expect(res.body.baseRent).toBe('375.50');
      expect(res.body.notes).toBe('Renovated');
    });
  });
});