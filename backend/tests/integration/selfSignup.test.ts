// Integration tests for the public account-creation endpoints behind the
// landing page's "Create account" cards:
//
//   * POST /api/portal/register — tenant self-service portal signup (claims
//     access for an existing ACTIVE tenant; signs the tenant straight in)
//   * POST /api/auth/register  — landlord/agent staff-account REQUEST (creates
//     an INACTIVE PROPERTY_MANAGER row; no session is ever issued)
//
// The security story of the second endpoint is the load-bearing part: a
// public route that inserts into `users` must never mint a working login, so
// the tests pin INACTIVE status, the absence of cookies, and login rejection.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

let adminToken = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
});

afterAll(async () => {
  await pool.end();
});

// Test rows created here are unique-prefixed and deleted at the end so the
// suite stays hermetic regardless of order.
const CLAIM_EMAIL = 'selfsignup.claim@example.com';
const DUP_EMAIL = 'selfsignup.dup@example.com';
const STAFF_EMAIL = 'selfsignup.landlord@example.com';

describe('POST /api/portal/register (tenant self-service signup)', () => {
  it('rejects an email that matches no active tenancy', async () => {
    const res = await request(app)
      .post('/api/portal/register')
      .send({ email: 'nobody@nowhere.test', password: 'Passw0rd!123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no active tenancy/i);
  });

  it('rejects a weak password before touching the database', async () => {
    const res = await request(app)
      .post('/api/portal/register')
      .send({ email: 'shortpass@example.test', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('claims access for an existing active tenant and signs them in', async () => {
    // Staff creates the tenancy first (the flow the landing page describes).
    const unitsRes = await request(app).get('/api/units?limit=100').set(auth(adminToken));
    expect(unitsRes.status).toBe(200);
    const vacant = unitsRes.body.data.find((u: any) => u.occupancy_status === 'VACANT');
    expect(vacant).toBeTruthy();

    const created = await request(app)
      .post('/api/tenants')
      .set(auth(adminToken))
      .send({
        fullName: 'Self Signup Claim',
        email: CLAIM_EMAIL,
        unitId: vacant.id,
        securityDeposit: 0,
      });
    expect(created.status).toBe(201);

    const res = await request(app)
      .post('/api/portal/register')
      .send({ email: CLAIM_EMAIL, password: 'Passw0rd!123' });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(CLAIM_EMAIL);
    expect(res.headers['set-cookie']).toBeDefined();

    // The portal session must actually work.
    const me = await request(app).get('/api/portal/me').set('Cookie', res.headers['set-cookie']);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(CLAIM_EMAIL);

    // Duplicate claim — same email, second attempt.
    const dup = await request(app)
      .post('/api/portal/register')
      .send({ email: CLAIM_EMAIL, password: 'Passw0rd!123' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/already been set up|sign in instead/i);
  });

  it('blocks portal login when staff disabled the account', async () => {
    // Reuse the claimed account: disable via direct SQL (staff route operates
    // by tenant id; SQL keeps this test focused on the login gate).
    const { query } = await import('../../src/config/db');
    await query(`UPDATE tenant_portal_access SET status = 'DISABLED' WHERE email = $1`, [CLAIM_EMAIL]);

    const res = await request(app)
      .post('/api/portal/login')
      .send({ email: CLAIM_EMAIL, password: 'Passw0rd!123' });
    expect(res.status).toBe(401);

    await query(`UPDATE tenant_portal_access SET status = 'ACTIVE' WHERE email = $1`, [CLAIM_EMAIL]);
  });
});

describe('POST /api/auth/register (landlord/agent staff request)', () => {
  it('creates an INACTIVE PROPERTY_MANAGER request and never a session', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Landlord Request', email: STAFF_EMAIL, password: 'Passw0rd!123' });
    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatch(/administrator|activate/i);
    // The response must not mint cookies — no session for public signups.
    expect(res.headers['set-cookie']).toBeUndefined();

    // Row exists, inactive, staff role.
    const { query } = await import('../../src/config/db');
    const row = await query<{ role: string; status: string }>(
      'SELECT role, status FROM users WHERE email = $1',
      [STAFF_EMAIL],
    );
    expect(row[0].role).toBe('PROPERTY_MANAGER');
    expect(row[0].status).toBe('INACTIVE');

    // Signing in with the chosen credentials must fail until activation.
    const attempt = await request(app)
      .post('/api/auth/login')
      .send({ email: STAFF_EMAIL, password: 'Passw0rd!123' });
    expect(attempt.status).toBe(401);
    expect(attempt.body.message).toMatch(/inactive/i);

    // This request queued an operator notification (the fixture's branding
    // has a contact email) — clean it up along with the row below.
    const { query: q2 } = await import('../../src/config/db');
    await q2('DELETE FROM email_notifications WHERE body_text LIKE $1', [`%${STAFF_EMAIL}%`]);
  });

  it('answers duplicates with the same generic response — no account enumeration', async () => {
    // OWASP Authentication Cheat Sheet: the registration feature must not
    // reveal whether an email already has an account. A duplicate gets the
    // identical 201 body a fresh request gets (timing is equalized with a
    // dummy bcrypt compare on the server).
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Second Try', email: STAFF_EMAIL, password: 'Passw0rd!123' });
    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatch(/administrator|activate/i);
    expect(res.headers['set-cookie']).toBeUndefined();

    // ...and no second row was created for the duplicate.
    const { query } = await import('../../src/config/db');
    const rows = await query('SELECT id FROM users WHERE email = $1', [STAFF_EMAIL]);
    expect(rows.length).toBe(1);
  });

  it('queues an operator notification for a new request — none for duplicates', async () => {
    const { query, queryOne } = await import('../../src/config/db');

    // Give branding a general contact email so the queue has a recipient,
    // restoring the previous value afterwards (other suites may rely on it
    // being unset).
    const before = await queryOne<{ contact_email: string | null }>(
      'SELECT contact_email FROM business_branding WHERE id = 1',
    );
    await query(`UPDATE business_branding SET contact_email = 'selfsignup.notices@example.test' WHERE id = 1`);
    try {
      const freshEmail = 'selfsignup.notify@example.test';
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Notify Landlord', email: freshEmail, password: 'Passw0rd!123' });
      expect(res.status).toBe(201);

      // One PENDING notification row, addressed to the branding contact,
      // carrying the requester's details (test mode skips the provider call,
      // so the row stays PENDING — asserting on the queue, not the send).
      // Scoped by the unique email so parallel/leftover rows can't interfere.
      const row = await queryOne<{ email_address: string; subject: string; body_text: string }>(
        `SELECT email_address, subject, body_text FROM email_notifications
         WHERE body_text LIKE $1 ORDER BY id DESC LIMIT 1`,
        [`%${freshEmail}%`],
      );
      expect(row).toBeTruthy();
      expect(row!.email_address).toBe('selfsignup.notices@example.test');
      expect(row!.body_text).toContain(freshEmail);
      expect(row!.body_text).toContain('Notify Landlord');

      // A duplicate request gets the same generic response but must NOT
      // queue a second notification (and must not reveal the duplication).
      const dup = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Notify Again', email: freshEmail, password: 'Passw0rd!123' });
      expect(dup.status).toBe(201);
      const count = await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM email_notifications WHERE body_text LIKE $1`,
        [`%${freshEmail}%`],
      );
      expect(Number(count!.n)).toBe(1);

      // Hermetic cleanup: the unique email belongs to this test alone.
      await query('DELETE FROM email_notifications WHERE body_text LIKE $1', [`%${freshEmail}%`]);
      await query('DELETE FROM users WHERE email = $1', [freshEmail]);
    } finally {
      await query('UPDATE business_branding SET contact_email = $1 WHERE id = 1', [before?.contact_email ?? null]);
    }
  });

  it('queues no notification when branding has no valid contact email', async () => {
    const { query, queryOne } = await import('../../src/config/db');
    const before = await queryOne<{ contact_email: string | null }>(
      'SELECT contact_email FROM business_branding WHERE id = 1',
    );
    // A stored-but-invalid address must not become a recipient (the queue's
    // isValidEmail guard) — the request itself still succeeds and the Users
    // page remains the fallback. (The env BUSINESS_EMAIL fallback keeps the
    // "completely unset" case unreachable inside the test env.)
    await query(`UPDATE business_branding SET contact_email = 'not-an-email' WHERE id = 1`);
    try {
      const skipEmail = 'selfsignup.skip@example.test';
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Skip Notice', email: skipEmail, password: 'Passw0rd!123' });
      expect(res.status).toBe(201); // the request itself still succeeds

      const row = await queryOne<{ id: number }>(
        `SELECT id FROM email_notifications WHERE body_text LIKE $1`,
        [`%${skipEmail}%`],
      );
      expect(row).toBeNull(); // queue skipped, Users page remains the fallback

      await query('DELETE FROM users WHERE email = $1', [skipEmail]);
    } finally {
      await query('UPDATE business_branding SET contact_email = $1 WHERE id = 1', [before?.contact_email ?? null]);
    }
  });

  it('rejects oversized passwords (bcrypt DoS bound)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Long Password', email: DUP_EMAIL, password: 'x'.repeat(129) });
    expect(res.status).toBe(400);
  });

  it('rejects invalid payloads', async () => {
    const short = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: 'x' });
    expect(short.status).toBe(400);

    const weak = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Valid Name', email: DUP_EMAIL, password: 'short' });
    expect(weak.status).toBe(400);
  });

  it('activation by an admin makes the account usable, then cleanup removes it', async () => {
    const { query, queryOne } = await import('../../src/config/db');
    const row = await queryOne<{ id: number; status: string }>('SELECT id, status FROM users WHERE email = $1', [STAFF_EMAIL]);
    expect(row).toBeTruthy();

    const res = await request(app)
      .put(`/api/users/${row!.id}`)
      .set(auth(adminToken))
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);

    const nowActive = await queryOne<{ status: string }>('SELECT status FROM users WHERE email = $1', [STAFF_EMAIL]);
    expect(nowActive!.status).toBe('ACTIVE');

    // Hermetic cleanup: remove the test rows created by this suite.
    await query(`DELETE FROM users WHERE email IN ($1, $2)`, [STAFF_EMAIL, 'selfsignup.second@example.test']);
    const claimed = await queryOne<{ tenant_id: number }>('SELECT tenant_id FROM tenant_portal_access WHERE email = $1', [CLAIM_EMAIL]);
    if (claimed) {
      await query('DELETE FROM tenant_portal_access WHERE email = $1', [CLAIM_EMAIL]);
      await query('DELETE FROM tenants WHERE email = $1', [CLAIM_EMAIL]);
    }
  });
});
