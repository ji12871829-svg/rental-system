// Integration tests for auth: login success/failure, /me, protected routes,
// cookie-based sessions, logout, and CSRF enforcement.
const request = require('supertest');
const app = require('../../server/src/app');
const { resetDatabase, loginAgent, csrfHeader, SEED_ADMIN } = require('./helpers');

function expectNoJwtInBody(res) {
  // The JWT must never appear in the response body (cookie-only token).
  expect(res.body.token).toBeUndefined();
  expect(JSON.stringify(res.body)).not.toContain('eyJ');
}

describe('POST /api/auth/login', () => {
  beforeAll(async () => { await resetDatabase(); });

  it('returns a user + CSRF token and sets httpOnly session cookies', async () => {
    const res = await request(app).post('/api/auth/login').send(SEED_ADMIN).expect(200);
    expectNoJwtInBody(res);
    expect(res.body.user).toMatchObject({ email: SEED_ADMIN.email, role: 'admin', fullName: 'Building Admin' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.csrfToken).toBe('string');
    expect(res.body.csrfToken.length).toBeGreaterThanOrEqual(32);

    // Cookies: the JWT cookie is httpOnly (JS can't read it); the CSRF cookie isn't.
    const setCookie = res.headers['set-cookie'].map((c) => c.split(';')[0]);
    const tokenCookie = res.headers['set-cookie'].find((c) => c.startsWith('rms_token='));
    const csrfCookie = res.headers['set-cookie'].find((c) => c.startsWith('rms_csrf='));
    expect(tokenCookie).toContain('HttpOnly');
    expect(tokenCookie.toLowerCase()).toContain('samesite=lax');
    // The CSRF value in the readable cookie matches the one returned in the body.
    expect(csrfCookie.split(';')[0]).toBe(`rms_csrf=${res.body.csrfToken}`);
  });

  it('rejects a wrong password with 401 and a generic message', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: SEED_ADMIN.email, password: 'WrongPassword1' })
      .expect(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('rejects an unknown email with the same 401 shape (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Whatever123' })
      .expect(401);
    expect(res.body.message).toBe('Invalid email or password.');
  });

  it('rejects a malformed body with 422', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'x' })
      .expect(422);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('Cookie-session flows', () => {
  beforeAll(async () => { await resetDatabase(); });

  it('GET /auth/me works via the httpOnly cookie (no Authorization header)', async () => {
    const agent = await loginAgent(app);
    const res = await agent.get('/api/auth/me').expect(200);
    expect(res.body.user.email).toBe(SEED_ADMIN.email);
  });

  it('allows mutating requests when the CSRF header matches', async () => {
    const agent = await loginAgent(app);
    const res = await agent
      .post('/api/units')
      .set(csrfHeader(agent))
      .send({ unitNumber: 'CSRF-1', baseRent: 100 })
      .expect(201);
    expect(res.body.unitNumber).toBe('CSRF-1');
  });

  it('REJECTS a mutating request without the CSRF header (403)', async () => {
    const agent = await loginAgent(app);
    const res = await agent
      .post('/api/units')
      .send({ unitNumber: 'CSRF-2', baseRent: 100 })
      .expect(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('REJECTS a mutating request with a WRONG CSRF header (403)', async () => {
    const agent = await loginAgent(app);
    const res = await agent
      .post('/api/units')
      .set(csrfHeader('deadbeefdeadbeefdeadbeef'))
      .send({ unitNumber: 'CSRF-3', baseRent: 100 })
      .expect(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('gets a fresh valid CSRF token after logging in again', async () => {
    const agent = await loginAgent(app);
    // Logout should clear cookies; a new login yields a new session + token.
    await agent.post('/api/auth/logout').expect(200);
    const loginAgain = await agent.post('/api/auth/login').send(SEED_ADMIN).expect(200);
    expect(loginAgain.body.csrfToken).toBeTruthy();
    expect(loginAgain.body.csrfToken).not.toBe(agent._rmsCsrf);
    agent._rmsCsrf = loginAgain.body.csrfToken;

    const res = await agent
      .patch('/api/tenants/1')
      .set(csrfHeader(agent))
      .send({ phone: '+254799999999' })
      .expect(200);
    expect(res.body.phone).toBe('+254799999999');
  });
});

describe('Bearer-token fallback (API clients)', () => {
  beforeAll(async () => { await resetDatabase(); });

  // A token-only client needs a way to obtain a token. For tooling we expose
  // a test-only login that returns the raw JWT — used by Postman examples and
  // the E2E suite. (The web client never uses this.)
  it('exchanges credentials for a Bearer token via /auth/login/token', async () => {
    const res = await request(app).post('/api/auth/login/token').send(SEED_ADMIN).expect(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe(SEED_ADMIN.email);
  });

  it('authenticates /me with the Bearer token (and no cookies / no CSRF needed)', async () => {
    const res = await request(app)
      .post('/api/auth/login/token')
      .send(SEED_ADMIN)
      .expect(200);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.token}`)
      .expect(200);
    expect(me.body.user.email).toBe(SEED_ADMIN.email);
  });
});

describe('protected routes', () => {
  beforeAll(async () => { await resetDatabase(); });

  it('rejects requests without a session on every resource', async () => {
    for (const path of ['/api/units', '/api/tenants', '/api/leases', '/api/payments', '/api/maintenance', '/api/reports/occupancy']) {
      const res = await request(app).get(path).expect(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    }
  });
});