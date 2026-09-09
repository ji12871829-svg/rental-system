// Integration tests for admin-only user management: role gate, CRUD,
// password reset with session invalidation (password_version), self-lockout
// and last-admin guards.
const app = require('../../server/src/app');
const { resetDatabase, loginAgent, csrfHeader, SEED_ADMIN } = require('./helpers');

describe('Users API (admin-only management)', () => {
  let agent; // admin
  let manager; // manager agent, for 403 checks

  beforeAll(async () => {
    await resetDatabase();
    agent = await loginAgent(app); // seeded admin
  });

  // Helper: create a manager through the API and log them in.
  async function createAndLoginManager(email) {
    await agent
      .post('/api/users').set(csrfHeader(agent))
      .send({ email, password: 'Manager123!', fullName: 'Test Manager', role: 'manager' })
      .expect(201);
    return loginAgent(app, { email, password: 'Manager123!' });
  }

  describe('role gating', () => {
    it('403s every users endpoint for managers', async () => {
      manager = await createAndLoginManager('gatekeeper@example.com');
      await manager.get('/api/users').expect(403);
      await manager.get('/api/users/1').expect(403);
      await manager
        .post('/api/users').set(csrfHeader(manager))
        .send({ email: 'x@example.com', password: 'Password1', fullName: 'X', role: 'manager' })
        .expect(403);
      await manager.patch('/api/users/1').set(csrfHeader(manager)).send({ fullName: 'X' }).expect(403);
    });
  });

  describe('GET /api/users', () => {
    it('lists users with pagination, never exposing hashes', async () => {
      const res = await agent.get('/api/users').expect(200);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
      expect(res.body.data[0]).not.toHaveProperty('passwordHash');
      expect(res.body.data[0]).not.toHaveProperty('password_version');
      expect(JSON.stringify(res.body)).not.toContain('$2b$');
    });
  });

  describe('POST /api/users', () => {
    it('creates a manager (201, hashed password never returned)', async () => {
      const res = await agent
        .post('/api/users').set(csrfHeader(agent))
        .send({ email: 'new.manager@example.com', password: 'Password123', fullName: 'New Manager', role: 'manager' })
        .expect(201);
      expect(res.body).toMatchObject({ email: 'new.manager@example.com', role: 'manager', isActive: true });
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('rejects duplicate email with 409', async () => {
      const res = await agent
        .post('/api/users').set(csrfHeader(agent))
        .send({ email: 'new.manager@example.com', password: 'Password123', fullName: 'Dup', role: 'manager' })
        .expect(409);
      expect(res.body.error).toBe('DUPLICATE_EMAIL');
    });

    it('rejects a weak password with 422 (min 8 chars + a number)', async () => {
      await agent
        .post('/api/users').set(csrfHeader(agent))
        .send({ email: 'weak@example.com', password: 'short', fullName: 'Weak', role: 'manager' })
        .expect(422);
      await agent
        .post('/api/users').set(csrfHeader(agent))
        .send({ email: 'weak2@example.com', password: 'NoNumbersHere', fullName: 'Weak2', role: 'manager' })
        .expect(422);
    });
  });

  describe('PATCH /api/users/:id — role changes', () => {
    it('promotes a manager to admin', async () => {
      const created = await agent
        .post('/api/users').set(csrfHeader(agent))
        .send({ email: 'promote.me@example.com', password: 'Password123', fullName: 'Promote Me', role: 'manager' })
        .expect(201);
      const res = await agent
        .patch(`/api/users/${created.body.id}`).set(csrfHeader(agent))
        .send({ role: 'admin' })
        .expect(200);
      expect(res.body.role).toBe('admin');
    });

    it('blocks demoting YOURSELF (422 SELF_LOCKOUT)', async () => {
      // agent IS the seeded admin (id 1).
      const res = await agent
        .patch('/api/users/1').set(csrfHeader(agent))
        .send({ role: 'manager' })
        .expect(422);
      expect(res.body.error).toBe('SELF_LOCKOUT');
    });

    it('blocks deactivating YOURSELF (422 SELF_LOCKOUT)', async () => {
      const res = await agent
        .patch('/api/users/1').set(csrfHeader(agent))
        .send({ isActive: false })
        .expect(422);
      expect(res.body.error).toBe('SELF_LOCKOUT');
    });

    it('blocks demoting the LAST active admin (422 LAST_ADMIN)', async () => {
      // There is exactly one admin so far (seeded admin, id 1).
      const res = await agent
        .patch('/api/users/1').set(csrfHeader(agent))
        // self-lockout would also trigger; use the OTHER admin created above.
        .send({})
        .expect(422); // empty update — sanity guard
      expect(res.body.error).toBe('EMPTY_UPDATE');

      // Promote-me (admin #2) demotes the seeded admin: still blocked if seeded
      // admin is the LAST admin? No — two admins exist. Instead verify the true
      // last-admin case: demote BOTH but only one at a time is possible, so
      // test via a fresh second admin demoting the other while only one active.
      const second = await agent
        .post('/api/users').set(csrfHeader(agent))
        .send({ email: 'admin2@example.com', password: 'Password123', fullName: 'Admin Two', role: 'admin' })
        .expect(201);
      // Now 3 admins. Deactivate promote.me and admin2 → seeded admin is last.
      await agent.patch(`/api/users/${second.body.id}`).set(csrfHeader(agent)).send({ isActive: false }).expect(200);
      const promoteMe = await agent.get('/api/users').then((r) =>
        r.body.data.find((u) => u.email === 'promote.me@example.com'));
      await agent.patch(`/api/users/${promoteMe.id}`).set(csrfHeader(agent)).send({ isActive: false }).expect(200);
      // Only the seeded admin remains active → deactivating them must fail.
      const res2 = await agent
        .patch('/api/users/1').set(csrfHeader(agent))
        .send({ isActive: false })
        .expect(422);
      expect(res2.body.error).toBe('LAST_ADMIN');
    });
  });

  describe('PATCH /api/users/:id — password reset & session invalidation', () => {
    it('invalidates the target user’s existing sessions after a reset', async () => {
      const victim = await createAndLoginManager('victim@example.com');
      await victim.get('/api/auth/me').expect(200); // session works now

      const admin = await agent.get('/api/users').then((r) =>
        r.body.data.find((u) => u.email === 'victim@example.com'));
      await agent
        .patch(`/api/users/${admin.id}`).set(csrfHeader(agent))
        .send({ password: 'NewPassword123' })
        .expect(200);

      // Old session token now carries a stale pwdv → 401.
      await victim.get('/api/auth/me').expect(401);
      // New password logs in fine.
      const relogin = await loginAgent(app, { email: 'victim@example.com', password: 'NewPassword123' });
      await relogin.get('/api/auth/me').expect(200);
    });

    it('lets an admin reset their OWN password and keeps their session (cookie rotation)', async () => {
      // The admin resets their own password; the response rotates the session
      // cookies so the same agent stays authenticated.
      const res = await agent
        .patch('/api/users/1').set(csrfHeader(agent))
        .send({ password: 'ChangeMe123!new' })
        .expect(200);
      expect(res.body.passwordChanged).toBe(true);
      expect(res.body.csrfToken).toBeTruthy();
      agent._rmsCsrf = res.body.csrfToken; // adopt rotated CSRF token
      await agent.get('/api/auth/me').expect(200);
      // Password actually changed: new one logs in, old one fails.
      await loginAgent(app, { email: SEED_ADMIN.email, password: 'ChangeMe123!new' });
      await request401(SEED_ADMIN.email, 'ChangeMe123!');
    });

    async function request401(email, password) {
      const request = require('supertest');
      await request(app).post('/api/auth/login').send({ email, password }).expect(401);
    }
  });

  describe('deactivation', () => {
    it('deactivated users cannot log in and their sessions die', async () => {
      const mgr = await createAndLoginManager('deactivate.me@example.com');
      await mgr.get('/api/auth/me').expect(200);

      const row = await agent.get('/api/users').then((r) =>
        r.body.data.find((u) => u.email === 'deactivate.me@example.com'));
      await agent
        .patch(`/api/users/${row.id}`).set(csrfHeader(agent))
        .send({ isActive: false })
        .expect(200);

      await mgr.get('/api/auth/me').expect(401); // live session killed
      const request = require('supertest');
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'deactivate.me@example.com', password: 'Manager123!' })
        .expect(401);
    });
  });
});