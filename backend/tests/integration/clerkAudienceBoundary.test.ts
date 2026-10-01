// The audience boundary has a second stack it must survive: with
// CLERK_SECRET_KEY set, app.ts mounts clerkMiddleware() + clerkAuth BEFORE
// requireAuth on every staff route. audienceBoundary.test.ts pins the
// boundary WITHOUT that stack; this file pins it WITH the Clerk path live:
//
//   * a portal-signed token (right portal key, portal audience) is refused
//     on staff routes no matter how it arrives — staff cookie, bearer, or
//     sitting next to a fully valid, mapped Clerk session;
//   * the Clerk bridge mints nothing from portal cookies;
//   * the portal keeps working untouched — the boundary isolates the two
//     auth domains, it does not fold portal auth into the Clerk stack.
//
// If anyone ever loosens requireAuth's key/audience pin "to make Clerk
// work", or teaches clerkAuth to fall back to any JWT-ish cookie, these
// tests fail before that change ships.
process.env.CLERK_SECRET_KEY = 'test-sk-aud-boundary-0123456789abcdef';

// What the mocked getAuth() reports as the verified Clerk session. Null =
// no or invalid session. (`mock` prefix required: jest.mock factories may
// only reference out-of-scope variables that start with "mock".)
let mockClerkUserId: string | null = null;

jest.mock('@clerk/express', () => ({
  // app.ts does app.use(clerkMiddleware()) — a factory returning middleware.
  // The real one parses Clerk's cookies, which do not exist here; passing
  // through is the exact behaviour for a request with none.
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: jest.fn(() => (mockClerkUserId ? { userId: mockClerkUserId } : {})),
}));

import jwt from 'jsonwebtoken';
import request from 'supertest';

// Portal tokens carry sub = tenants.id. Point it at the id that collides
// with the fixture ADMIN's users.id — the sharpest case: even a portal
// token whose sub resolves to a real staff row must be refused on staff
// routes (same reasoning as audienceBoundary.test.ts).
const COLLIDING_ADMIN_USER_ID = 1;
const MAPPED_CLERK_ID = 'user_test_aud_mapped';

// Everything that evaluates env.ts is imported lazily inside beforeAll:
// env.ts reads process.env once, and CLERK_SECRET_KEY is only set at module
// scope — a static import chain (config/db → config/env, portalAuth → env)
// would cache an empty clerkSecretKey before this file's assignment ran.
let portalSecret = '';
let portalAudience = '';
let app: ReturnType<typeof import('../../src/app').createApp>;

function portalToken(): string {
  return jwt.sign(
    { sub: COLLIDING_ADMIN_USER_ID, email: 'tenant1@rpms.local', name: 'Test Tenant' },
    portalSecret,
    { expiresIn: '8h', audience: portalAudience },
  );
}

function staffCookie(token: string): string {
  return `rpms_session=${token}`;
}

function portalCookie(token: string): string {
  return `rpms_portal_session=${token}`;
}

function cookieHeader(setCookie: unknown): string {
  const list: string[] = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
  return list.map((c) => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  const [{ createApp }, { env }, { PORTAL_JWT_AUDIENCE }] = await Promise.all([
    import('../../src/app'),
    import('../../src/config/env'),
    import('../../src/middleware/portalAuth'),
  ]);
  app = createApp();
  portalSecret = env.jwtPortalSecret;
  portalAudience = PORTAL_JWT_AUDIENCE;

  // Give the fixture admin a Clerk identity so the suite can prove the
  // boundary holds even when the Clerk path fully resolves to a local user.
  const { query, queryOne } = await import('../../src/config/db');
  const admin = await queryOne<{ id: number }>(
    "SELECT id FROM users WHERE email = 'admin@rpms.local'",
  );
  if (!admin) throw new Error('fixture admin user missing');
  await query(
    `INSERT INTO user_external_ids (user_id, provider, external_id)
     VALUES ($1, 'clerk', $2) ON CONFLICT DO NOTHING`,
    [admin.id, MAPPED_CLERK_ID],
  );
});

afterAll(async () => {
  // Hermetic cleanup, and do not leak the key into other suites sharing
  // this jest worker (same hygiene as clerkBridgeMapped.test.ts).
  const { query, pool } = await import('../../src/config/db');
  await query('DELETE FROM user_external_ids WHERE external_id = $1', [MAPPED_CLERK_ID]);
  delete process.env.CLERK_SECRET_KEY;
  await pool.end();
});

describe('portal tokens can never satisfy staff auth, even through the Clerk path', () => {
  it('control: the Clerk path is live and mints a real staff session for the mapped identity', async () => {
    // Guards the rest of the suite against vacuousness: if this mock or the
    // mapping fixture broke, every 401 below would pass for the wrong reason.
    mockClerkUserId = MAPPED_CLERK_ID;
    const bridge = await request(app).post('/api/auth/clerk/session');
    expect(bridge.status).toBe(200);
    expect(bridge.headers['set-cookie']).toBeDefined();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(bridge.headers['set-cookie']));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ userId: expect.any(Number), role: 'ADMIN' });
  });

  it('refuses a portal token in the staff session cookie (Clerk stack mounted)', async () => {
    mockClerkUserId = null;
    const res = await request(app).get('/api/auth/me').set('Cookie', staffCookie(portalToken()));
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('refuses a portal bearer token even alongside a valid mapped Clerk session', async () => {
    mockClerkUserId = MAPPED_CLERK_ID;
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${portalToken()}`);
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('refuses a portal staff-cookie token even with a fully valid Clerk session', async () => {
    // The strongest form of the boundary: clerkAuth resolves the Clerk
    // session and stamps the local user, yet requireAuth's key+audience pin
    // still owns the verdict on the staff token itself. A portal token —
    // correctly signed, correctly scoped to the portal — never rides in.
    mockClerkUserId = MAPPED_CLERK_ID;
    const res = await request(app).get('/api/auth/me').set('Cookie', staffCookie(portalToken()));
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('never reads the portal cookie on staff routes — a Clerk session alone is not a staff session', async () => {
    mockClerkUserId = MAPPED_CLERK_ID;
    const res = await request(app).get('/api/auth/me').set('Cookie', portalCookie(portalToken()));
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('the bridge mints nothing from portal cookies', async () => {
    mockClerkUserId = null;
    for (const cookie of [staffCookie(portalToken()), portalCookie(portalToken())]) {
      const res = await request(app).post('/api/auth/clerk/session').set('Cookie', cookie);
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body.data).toBeUndefined();
    }
  });

  it('control: genuine portal tokens still work on portal routes', async () => {
    mockClerkUserId = null;
    // Seed an ACTIVE portal row so the 200 isolates the token boundary (not
    // a missing DB row), exactly as audienceBoundary.test.ts does.
    const { pool } = await import('../../src/config/db');
    await pool.query(
      `INSERT INTO tenant_portal_access (tenant_id, email, password_hash, status)
       VALUES (1, 'tenant1@rpms.local', 'not-a-real-hash', 'ACTIVE')
       ON CONFLICT (tenant_id) DO UPDATE SET status = 'ACTIVE'`,
    );
    const res = await request(app).get('/api/portal/me').set('Cookie', portalCookie(portalToken()));
    expect(res.status).toBe(200);
    expect(res.body.data.tenantId).toBe(COLLIDING_ADMIN_USER_ID);
  });
});
