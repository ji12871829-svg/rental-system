// The Clerk bridge's fail-closed posture is covered by clerkBridge.test.ts
// (no CLERK_SECRET_KEY → 401). This suite covers the WITH-keys paths the
// other file's comment defers: given a VERIFIED Clerk session (getAuth
// mocked at the one external boundary — everything else is real, including
// the mapping lookups, the staff-JWT minting and the cookies), the bridge
// must:
//
//   * 401 a mapped but INACTIVE user — mapping alone is not enough;
//   * 401 an unmapped Clerk identity with the same generic message (no
//     enumeration — the response must not reveal whether the email exists);
//   * 401 a session getAuth cannot resolve;
//   * mint a real staff session for a mapped ACTIVE user: the standard
//     rpms_session cookie, accepted by /api/auth/me with the local role,
//     plus a LOGIN audit row — indistinguishable from a password sign-in,
//     which is the whole point of the bridge.
//
// CLERK_SECRET_KEY is set before the app module is imported (env.ts reads
// process.env once at first evaluation), so app.ts mounts clerkMiddleware()
// and the bridge is live. @clerk/express is mocked because producing a real
// signed Clerk session requires a live Clerk instance; the mock stands in
// for exactly that signature check, nothing else.
process.env.CLERK_SECRET_KEY = 'test-sk-clerk-bridge-0123456789abcdef';

// What the mocked getAuth() reports as the verified session. Null = no or
// invalid session. (`mock` prefix required: jest.mock factories may only
// reference out-of-scope variables that start with "mock".)
let mockClerkUserId: string | null = null;

jest.mock('@clerk/express', () => ({
  // app.ts does app.use(clerkMiddleware()) — a factory returning middleware.
  // The real one parses Clerk's cookies, which do not exist here; passing
  // through is the exact behaviour for a request with none.
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: jest.fn(() => (mockClerkUserId ? { userId: mockClerkUserId } : {})),
}));

import request from 'supertest';
import { pool } from '../../src/config/db';

describe('POST /api/auth/clerk/session (with CLERK_SECRET_KEY configured)', () => {
  const MAPPED_ACTIVE = 'user_test_mapped_active';
  const MAPPED_INACTIVE = 'user_test_mapped_inactive';
  const UNMAPPED = 'user_test_never_mapped';

  let adminUserId = 0;

  // Deferred import: env.ts must observe CLERK_SECRET_KEY (set at module
  // scope above) before it is first evaluated.
  const app = () => (global as any).__clerkBridgeApp as ReturnType<typeof import('../../src/app').createApp>;

  function cookieHeader(setCookie: unknown): string {
    const list: string[] = Array.isArray(setCookie) ? setCookie : [setCookie as string];
    return list.map((c) => c.split(';')[0]).join('; ');
  }

  beforeAll(async () => {
    const { createApp } = await import('../../src/app');
    (global as any).__clerkBridgeApp = createApp();

    // Fixture admin from globalSetup — give it a Clerk identity, plus a
    // dedicated INACTIVE user for the "mapped but disabled" case.
    const { query, queryOne } = await import('../../src/config/db');
    const admin = await queryOne<{ id: number }>(
      "SELECT id FROM users WHERE email = 'admin@rpms.local'",
    );
    if (!admin) throw new Error('fixture admin user missing');
    adminUserId = admin.id;

    await query(
      `INSERT INTO user_external_ids (user_id, provider, external_id)
       VALUES ($1, 'clerk', $2) ON CONFLICT DO NOTHING`,
      [adminUserId, MAPPED_ACTIVE],
    );

    const bcrypt = (await import('bcryptjs')).default;
    const inactive = await query<{ id: number }>(
      `INSERT INTO users (name, email, phone, password_hash, role, status)
       VALUES ('Clerk Inactive', 'clerk.inactive@example.test', NULL, $1, 'STAFF', 'INACTIVE')
       RETURNING id`,
      [await bcrypt.hash('Irrelevant#2026', 4)],
    );
    await query(
      `INSERT INTO user_external_ids (user_id, provider, external_id)
       VALUES ($1, 'clerk', $2) ON CONFLICT DO NOTHING`,
      [inactive[0].id, MAPPED_INACTIVE],
    );
  });

  afterAll(async () => {
    // Hermetic cleanup: this suite's mapping and user rows, and nothing else.
    const { query } = await import('../../src/config/db');
    await query('DELETE FROM user_external_ids WHERE external_id IN ($1, $2)', [
      MAPPED_ACTIVE,
      MAPPED_INACTIVE,
    ]);
    await query("DELETE FROM users WHERE email = 'clerk.inactive@example.test'");
    // Unset the key before the next suite runs: jest workers share one
    // process.env across the files a worker executes, and a leaked
    // CLERK_SECRET_KEY would break clerkBridge.test.ts's fail-closed
    // assertion if this file ran first in the same worker.
    delete process.env.CLERK_SECRET_KEY;
    await pool.end();
  });

  it('401s an unmapped Clerk identity with a generic message — no enumeration', async () => {
    mockClerkUserId = UNMAPPED;
    const res = await request(app()).post('/api/auth/clerk/session');
    expect(res.status).toBe(401);
    // Same generic body as the inactive case — no hint the email is unknown.
    expect(res.body.message).toMatch(/not enabled for app access/i);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('401s a mapped but INACTIVE user — the local row still decides', async () => {
    mockClerkUserId = MAPPED_INACTIVE;
    const res = await request(app()).post('/api/auth/clerk/session');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not enabled for app access/i);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('401s when getAuth resolves no session', async () => {
    mockClerkUserId = null;
    const res = await request(app()).post('/api/auth/clerk/session');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('mints a working staff session for a mapped ACTIVE user', async () => {
    mockClerkUserId = MAPPED_ACTIVE;
    const res = await request(app()).post('/api/auth/clerk/session');
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      id: adminUserId,
      email: 'admin@rpms.local',
      role: 'ADMIN',
    });

    // The standard staff cookies — same shape a password login sets.
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = cookieHeader(res.headers['set-cookie']);
    expect(cookie).toContain('rpms_session=');

    // The session is a real staff session, not a decorative one: it must
    // satisfy requireAuth on a guarded route with the LOCAL identity and
    // role attached (/api/auth/me echoes req.user: { userId, role, ... }).
    const me = await request(app()).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ userId: adminUserId, role: 'ADMIN' });

    // A LOGIN_CLERK audit row for the local user — the audit trail treats
    // this as a login, but with its own action so Clerk-minted sessions stay
    // distinguishable from password sign-ins.
    const { queryOne } = await import('../../src/config/db');
    const audit = await queryOne<{ id: number }>(
      `SELECT id FROM audit_logs
        WHERE action = 'LOGIN_CLERK' AND entity = 'users' AND entity_id = $1
        ORDER BY id DESC LIMIT 1`,
      [adminUserId],
    );
    expect(audit).toBeTruthy();

    // And it is the ONLY login-style row: the bridge must not also write a
    // plain LOGIN, or the two sign-in paths would blur together in the trail.
    const plainLogin = await queryOne<{ id: number }>(
      `SELECT id FROM audit_logs
        WHERE action = 'LOGIN' AND entity = 'users' AND entity_id = $1`,
      [adminUserId],
    );
    expect(plainLogin).toBeNull();
  });
});
