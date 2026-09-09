// Integration tests for tenants: CRUD, archive-instead-of-delete, and the
// archive-blocked-by-active-lease rule (HARD-QUESTIONS.md Q7).
const request = require('supertest');
const app = require('../../server/src/app');
const { resetDatabase, loginAgent, csrfHeader } = require('./helpers');

describe('Tenants API', () => {
  let agent;
  beforeAll(async () => {
    await resetDatabase();
    agent = await loginAgent(app);
  });

  describe('GET /api/tenants', () => {
    it('returns tenants with pagination', async () => {
      const res = await agent.get('/api/tenants').expect(200);
      expect(res.body.pagination.total).toBe(2);
      expect(res.body.data[0]).toHaveProperty('firstName');
    });

    it('excludes archived tenants by default', async () => {
      // Create one that gets archived below, then re-check both list modes.
      const created = await agent
        .post('/api/tenants').set(csrfHeader(agent))
        .send({ firstName: 'Grace', lastName: 'Achieng', email: 'grace@example.com', phone: '+254700999888' })
        .expect(201);
      await agent.patch(`/api/tenants/${created.body.id}/archive`).set(csrfHeader(agent)).expect(200);

      const list = await agent.get('/api/tenants').expect(200);
      expect(list.body.data.every((t) => t.isArchived === false)).toBe(true);

      const withArchived = await agent.get('/api/tenants?includeArchived=true').expect(200);
      expect(withArchived.body.data.some((t) => t.isArchived === true)).toBe(true);
    });
  });

  describe('POST /api/tenants', () => {
    it('creates a tenant', async () => {
      const res = await agent
        .post('/api/tenants').set(csrfHeader(agent))
        .send({ firstName: 'John', lastName: 'Kamau', email: 'john.kamau@example.com', phone: '+254711222333' })
        .expect(201);
      expect(res.body).toMatchObject({ firstName: 'John', lastName: 'Kamau', isArchived: false });
    });

    it('rejects duplicate email with 409', async () => {
      const res = await agent
        .post('/api/tenants').set(csrfHeader(agent))
        .send({ firstName: 'Jane', lastName: 'Wanjiru', email: 'jane.wanjiru@example.com', phone: '+254700111222' })
        .expect(409);
      expect(res.body.error).toBe('DUPLICATE_EMAIL');
    });
  });

  describe('PATCH /api/tenants/:id/archive (archive instead of delete)', () => {
    it('archives a tenant without an active lease', async () => {
      const created = await agent
        .post('/api/tenants').set(csrfHeader(agent))
        .send({ firstName: 'Alice', lastName: 'Njeri', email: 'alice.njeri@example.com', phone: '+254733444555' })
        .expect(201);
      const res = await agent.patch(`/api/tenants/${created.body.id}/archive`).set(csrfHeader(agent)).expect(200);
      expect(res.body).toEqual({ id: created.body.id, isArchived: true });
    });

    it('blocks archiving a tenant with an active lease (409 ARCHIVE_BLOCKED_ACTIVE_LEASE)', async () => {
      // Seed tenant 1 (Jane) holds lease 1 (active).
      const res = await agent.patch('/api/tenants/1/archive').set(csrfHeader(agent)).expect(409);
      expect(res.body.error).toBe('ARCHIVE_BLOCKED_ACTIVE_LEASE');
    });
  });

  describe('DELETE /api/tenants/:id', () => {
    it('is blocked for tenants with an active lease (409)', async () => {
      const res = await agent.delete('/api/tenants/1').set(csrfHeader(agent)).expect(409);
      expect(res.body.error).toBe('TENANT_HAS_ACTIVE_LEASE');
    });

    it('is forbidden for non-admin roles (403 before CSRF even matters)', async () => {
      // Create a manager user row directly (no admin API for users in v1).
      const { Client } = require('pg');
      const bcrypt = require('bcrypt');
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      const hash = await bcrypt.hash('Manager123!', 12);
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,'manager') ON CONFLICT (email) DO NOTHING`,
        ['manager@olbano.example', hash, 'Property Manager']
      );
      await client.end();

      const manager = await loginAgent(app, { email: 'manager@olbano.example', password: 'Manager123!' });
      const res = await manager.delete('/api/tenants/2').set(csrfHeader(manager)).expect(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });
  });
});