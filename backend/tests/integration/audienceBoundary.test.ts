// Regression tests for the JWT audience boundary between the two token
// populations: staff sessions (aud 'staff_api') and tenant-portal sessions
// (aud 'tenant_portal'). Both are signed with the same secret, so the
// audience claim is the only thing separating the auth domains.
//
// Before the fix, staff-side verification did not pin an audience, so a
// token minted for the tenant portal (sub = tenant_id, aud = 'tenant_portal')
// was accepted by every staff route as users.id = tenant_id. In any install
// where ids from the two tables collide (all fresh seeds: users 1-3 are
// ADMIN/PROPERTY_MANAGER/STAFF, tenants 1-3 exist), that is a full
// tenant→admin privilege escalation. /refresh was worse: with
// ignoreExpiration it minted a fresh 8h staff token carrying the REAL role of
// whichever user id the tenant's sub collided with.
//
// These tests mint portal-style tokens directly (no portal password needed)
// and assert they are rejected everywhere staff auth is required.
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { pool } from '../../src/config/db';
import { PORTAL_JWT_AUDIENCE, STAFF_JWT_AUDIENCE } from '../../src/middleware/portalAuth';
import { PORTAL_COOKIE, SESSION_COOKIE } from '../../src/utils/authCookies';

const app = createApp();

// A live collision: users.id 1 is the ADMIN seeded by globalSetup and
// tenants.id 1 exists in the fixture data. Portal tokens carry sub=tenant_id.
const COLLIDING_ADMIN_USER_ID = 1;

function portalTokenFor(tenantId: number): string {
  return jwt.sign(
    { sub: tenantId, email: 'tenant1@rpms.local', name: 'Test Tenant' },
    env.jwtPortalSecret,
    { expiresIn: '8h', audience: PORTAL_JWT_AUDIENCE }
  );
}

function staffBearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}function portalCookie(token: string): string {  return `${PORTAL_COOKIE}=${token}`;}

afterAll(async () => {
  await pool.end();
});

describe('JWT audience boundary (staff vs tenant portal)', () => {
  it('rejects a portal token on a staff route via Authorization header', async () => {
    const token = portalTokenFor(COLLIDING_ADMIN_USER_ID);
    const res = await request(app).get('/api/auth/me').set(staffBearer(token));
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('rejects a portal token on a staff-only admin route', async () => {
    const token = portalTokenFor(COLLIDING_ADMIN_USER_ID);
    const res = await request(app).get('/api/users').set(staffBearer(token));
    expect(res.status).toBe(401);
  });

  it('rejects a portal token presented in the staff session cookie', async () => {
    const token = portalTokenFor(COLLIDING_ADMIN_USER_ID);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `rpms_session=${token}`);
    expect(res.status).toBe(401);
  });

  it('refuses to mint a staff session from a portal token via /refresh', async () => {
    const token = portalTokenFor(COLLIDING_ADMIN_USER_ID);
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `rpms_session=${token}`);
    expect(res.status).toBe(401);
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain(SESSION_COOKIE);
  });

  it('keeps accepting genuine staff tokens on the same routes', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@rpms.local', password: 'Admin@2026!' });
    expect(login.status).toBe(200);

    const me = await request(app)
      .get('/api/auth/me')
      .set(staffBearer(login.body.data.token));
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe('ADMIN');
  });  it('keeps accepting genuine portal tokens on portal routes', async () => {
    // requireTenant also validates the portal row in the DB — seed an ACTIVE
    // access row for tenant 1 so this test isolates the token boundary (the
    // 200 must come from the audience check, not a missing DB row).
    await pool.query(
      `INSERT INTO tenant_portal_access (tenant_id, email, password_hash, status)
       VALUES (1, 'tenant1@rpms.local', 'not-a-real-hash', 'ACTIVE')
       ON CONFLICT (tenant_id) DO UPDATE SET status = 'ACTIVE'`
    );
    const token = portalTokenFor(COLLIDING_ADMIN_USER_ID);
    const res = await request(app)
      .get('/api/portal/me')
      .set('Cookie', portalCookie(token));
    expect(res.status).toBe(200);
    expect(res.body.data.tenantId).toBe(COLLIDING_ADMIN_USER_ID);
  });

  it('staff tokens carry the staff audience and nothing else', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@rpms.local', password: 'Admin@2026!' });
    const decoded = jwt.decode(login.body.data.token) as { aud: string };
    expect(decoded.aud).toBe('staff_api');
  });

  // --- Key-split hardening: distinct signing secrets per population ---------

  it('rejects a portal token signed with the STAFF key on a staff route (wrong-key semantics)', async () => {
    // A staff-audience token minted with the portal key must fail signature
    // verification — proving the verifier is pinned to the staff key.
    const token = jwt.sign(
      { sub: COLLIDING_ADMIN_USER_ID, role: 'ADMIN', name: 'X', email: 'x@rpms.local' },
      env.jwtPortalSecret,
      { expiresIn: '8h', audience: STAFF_JWT_AUDIENCE }
    );
    const res = await request(app).get('/api/auth/me').set(staffBearer(token));
    expect(res.status).toBe(401);
  });

  it('rejects a staff token signed with the PORTAL key on a portal route (wrong-key semantics)', async () => {
    // Staff-audience token signed with the staff key must fail the portal
    // verifier's key+audience checks (already covered); the inverse here:
    // a staff-key-signed token with the portal audience is still rejected —
    // the portal side verifies with its own key only.
    const token = jwt.sign(
      { sub: COLLIDING_ADMIN_USER_ID, email: 't@rpms.local', name: 'T' },
      env.jwtStaffSecret,
      { expiresIn: '8h', audience: PORTAL_JWT_AUDIENCE }
    );
    const res = await request(app)
      .get('/api/portal/me')
      .set('Cookie', portalCookie(token));
    expect(res.status).toBe(401);
  });
});
