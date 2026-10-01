// The audience boundary under the SHARED-KEY fallback posture.
//
// env.ts lets each token population fall back to JWT_SECRET, so an install
// without JWT_STAFF_SECRET / JWT_PORTAL_SECRET runs with both verifiers on
// ONE key — the exact posture in which the original escalation happened
// (see audienceBoundary.test.ts header). setup-env.ts gives every suite
// distinct split keys, which means the existing boundary tests exercise
// key+audience mismatch, never "audience is the ONLY separator". This file
// boots the app with both signing secrets deliberately EQUAL and pins that
// the audience claim alone keeps the domains apart — on the plain JWT path,
// on both /refresh grace windows, and with the Clerk stack mounted on top
// (shared key + Clerk live is the worst posture this app can run in).
//
// WARNING FOR FUTURE EDITS: if you ever remove an audience pin because "the
// secrets are different anyway", this suite is the one that fails — and it
// fails because the fallback posture silently re-merges the keys.
process.env.JWT_STAFF_SECRET = 'shared-boundary-key-0123456789abcdef';
process.env.JWT_PORTAL_SECRET = 'shared-boundary-key-0123456789abcdef';
process.env.CLERK_SECRET_KEY = 'test-sk-shared-aud-0123456789abcdef';

// Saved so afterAll can restore the split keys setup-env.ts installed —
// later suites in this worker must keep the distinct-key posture.
const SAVED_STAFF_SECRET = process.env.JWT_STAFF_SECRET;
const SAVED_PORTAL_SECRET = process.env.JWT_PORTAL_SECRET;

// What the mocked getAuth() reports as the verified Clerk session. Null =
// no or invalid session. (`mock` prefix required: jest.mock factories may
// only reference out-of-scope variables that start with "mock".)
let mockClerkUserId: string | null = null;

jest.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: jest.fn(() => (mockClerkUserId ? { userId: mockClerkUserId } : {})),
}));

import jwt from 'jsonwebtoken';
import request from 'supertest';

const SHARED_SECRET = 'shared-boundary-key-0123456789abcdef';
const MAPPED_CLERK_ID = 'user_test_shared_aud_mapped';

// Deferred imports: env.ts must observe the shared keys (set at module
// scope above) the first time it is evaluated in this file's registry.
let app: ReturnType<typeof import('../../src/app').createApp>;
let adminUserId = 0;

function staffToken(): string {
  return jwt.sign(
    { sub: adminUserId, role: 'ADMIN', name: 'Fixture Admin', email: 'admin@rpms.local' },
    SHARED_SECRET,
    { expiresIn: '8h', audience: 'staff_api' },
  );
}

function portalToken(): string {
  return jwt.sign(
    { sub: 1, email: 'tenant1@rpms.local', name: 'Test Tenant' },
    SHARED_SECRET,
    { expiresIn: '8h', audience: 'tenant_portal' },
  );
}

function staffCookie(token: string): string {
  return `rpms_session=${token}`;
}

function portalCookie(token: string): string {
  return `rpms_portal_session=${token}`;
}

beforeAll(async () => {
  const { createApp } = await import('../../src/app');
  app = createApp();

  const { query, queryOne } = await import('../../src/config/db');
  const admin = await queryOne<{ id: number }>(
    "SELECT id FROM users WHERE email = 'admin@rpms.local'",
  );
  if (!admin) throw new Error('fixture admin user missing');
  adminUserId = admin.id;

  await query(
    `INSERT INTO user_external_ids (user_id, provider, external_id)
     VALUES ($1, 'clerk', $2) ON CONFLICT DO NOTHING`,
    [adminUserId, MAPPED_CLERK_ID],
  );
});

afterAll(async () => {
  const { query, pool } = await import('../../src/config/db');
  await query('DELETE FROM user_external_ids WHERE external_id = $1', [MAPPED_CLERK_ID]);
  await pool.end();
  // Restore the split keys for later suites in this worker (jest gives each
  // file a fresh module registry but shares process.env across files), and
  // do not leak the Clerk key — same hygiene as clerkBridgeMapped.test.ts.
  if (SAVED_STAFF_SECRET === undefined) delete process.env.JWT_STAFF_SECRET;
  else process.env.JWT_STAFF_SECRET = SAVED_STAFF_SECRET;
  if (SAVED_PORTAL_SECRET === undefined) delete process.env.JWT_PORTAL_SECRET;
  else process.env.JWT_PORTAL_SECRET = SAVED_PORTAL_SECRET;
  delete process.env.CLERK_SECRET_KEY;
});

describe('audience is the only separator when both populations share one key', () => {
  it('control: the shared key really is live on the staff verifier', async () => {
    // Signed with the shared key — this 200 proves env picked it up; under
    // the setup-env split keys it would fail signature verification.
    const res = await request(app).get('/api/auth/me').set('Cookie', staffCookie(staffToken()));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ userId: adminUserId, role: 'ADMIN' });
  });

  it('control: the shared key really is live on the portal verifier', async () => {
    const { pool } = await import('../../src/config/db');
    await pool.query(
      `INSERT INTO tenant_portal_access (tenant_id, email, password_hash, status)
       VALUES (1, 'tenant1@rpms.local', 'not-a-real-hash', 'ACTIVE')
       ON CONFLICT (tenant_id) DO UPDATE SET status = 'ACTIVE'`,
    );
    const res = await request(app).get('/api/portal/me').set('Cookie', portalCookie(portalToken()));
    expect(res.status).toBe(200);
    expect(res.body.data.tenantId).toBe(1);
  });

  it('rejects a portal-audience token on a staff route — same key, valid signature, wrong audience', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', staffCookie(portalToken()));
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('rejects a staff-audience token on a portal route — same key, valid signature, wrong audience', async () => {
    const res = await request(app).get('/api/portal/me').set('Cookie', portalCookie(staffToken()));
    expect(res.status).toBe(401);
  });

  it('refuses to mint a staff session from a portal token via /refresh even with the grace window', async () => {
    const res = await request(app).post('/api/auth/refresh').set('Cookie', staffCookie(portalToken()));
    expect(res.status).toBe(401);
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain('rpms_session=');
  });

  it('the Clerk bridge still mints nothing from portal cookies (shared key + Clerk live)', async () => {
    mockClerkUserId = null;
    for (const cookie of [staffCookie(portalToken()), portalCookie(portalToken())]) {
      const res = await request(app).post('/api/auth/clerk/session').set('Cookie', cookie);
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('a portal token in the staff cookie is refused even with a valid mapped Clerk session', async () => {
    mockClerkUserId = MAPPED_CLERK_ID;
    const res = await request(app).get('/api/auth/me').set('Cookie', staffCookie(portalToken()));
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });
});
