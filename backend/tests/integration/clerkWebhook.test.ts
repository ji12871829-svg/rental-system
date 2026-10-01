// The Clerk webhook auto-mapping. Signature verification is exercised for
// real: every payload below is signed with the standard-webhooks v1 scheme
// (the scheme Clerk/svix uses) and the route verifies with @clerk/backend's
// real verifyWebhook — the crypto decides, nothing is mocked.
//
// Security pins:
//   * fails closed without CLERK_WEBHOOK_SIGNING_SECRET / CLERK_SECRET_KEY;
//   * rejects tampered payloads, wrong secrets and missing headers (400);
//   * maps ONLY a verified primary email to an EXISTING ACTIVE staff user
//     (never creates local accounts; unverified emails link nothing);
//   * is idempotent under Clerk's at-least-once retries.
import crypto from 'node:crypto';
import request from 'supertest';

// svix/Clerk signing secrets are "whsec_" + base64 of the raw key bytes.
const SECRET_BYTES = Buffer.from('test-webhook-signing-secret-0123456789abcdef', 'utf8');
const SIGNING_SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

const ClerkUserCreated = 'user.created';
const ClerkUserUpdated = 'user.updated';

// Sign exactly like Clerk does: HMAC-SHA256 over "<id>.<timestamp>.<payload>"
// keyed with the decoded secret bytes, base64-encoded, prefixed "v1,".
function signed(payload: object, tamper = false) {
  const body = JSON.stringify(payload);
  const msgId = `msg_${crypto.randomBytes(8).toString('hex')}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac('sha256', SECRET_BYTES)
    .update(`${msgId}.${timestamp}.${body}`)
    .digest('base64');
  return {
    // A tampered payload keeps its genuine signature — the bytes no longer
    // match, which is precisely what verifyWebhook must detect.
    body: tamper ? body.replace('"status":"verified"', '"status":"unverified"') : body,
    headers: {
      'content-type': 'application/json',
      'svix-id': msgId,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
  };
}

let app: ReturnType<typeof import('../../src/app').createApp>;

beforeAll(async () => {
  // Set BEFORE importing the app: env.ts is evaluated once per test file's
  // module registry and app.ts only mounts the Clerk middleware when a key
  // is present at that moment.
  process.env.CLERK_SECRET_KEY = 'test-sk-webhook-0123456789abcdef';
  // This suite runs the REAL clerkMiddleware (only the webhook's own crypto
  // is under test). The express package needs a publishable key to parse
  // requests; with no session cookie present it resolves to unauthenticated
  // without calling Clerk's API. Format: pk_test_ + base64(domain$).
  process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_d2ViaG9vay10ZXN0LmNsZXJrLmFjY291bnRzLmRldiQ=';
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
  const { createApp } = await import('../../src/app');
  app = createApp();
});

afterAll(async () => {
  // Do not leak keys into other suites sharing this jest worker.
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  // Imported lazily: a static import would evaluate env.ts before beforeAll
  // sets the Clerk keys, and the app would boot with the feature disabled.
  const { query, pool } = await import('../../src/config/db');
  await query('DELETE FROM user_external_ids WHERE external_id LIKE $1', ['user_test_wh_%']);
  await query("DELETE FROM users WHERE email = 'clerk.webhook.inactive@example.test'");
  await pool.end();
});

describe('POST /api/webhooks/clerk', () => {
  it('401s when the webhook signing secret is not configured (fails closed)', async () => {
    // The route reads the cached env object per request, so blanking both
    // knobs there simulates a deployment booted without the feature.
    const envModule = await import('../../src/config/env');
    const savedSecret = envModule.env.clerkWebhookSigningSecret;
    const savedKey = envModule.env.clerkSecretKey;
    (envModule.env as Record<string, unknown>).clerkWebhookSigningSecret = '';
    (envModule.env as Record<string, unknown>).clerkSecretKey = '';
    try {
      const { body, headers } = signed({ type: ClerkUserCreated, data: { id: 'user_x' } });
      const res = await request(app).post('/api/webhooks/clerk').set(headers).send(body);
      expect(res.status).toBe(401);
    } finally {
      (envModule.env as Record<string, unknown>).clerkWebhookSigningSecret = savedSecret;
      (envModule.env as Record<string, unknown>).clerkSecretKey = savedKey;
    }
  });

  it('400s a tampered payload — the signature no longer matches', async () => {
    const { body, headers } = signed(
      {
        type: ClerkUserCreated,
        data: {
          id: 'user_test_wh_tamper',
          primary_email_address_id: 'email_1',
          email_addresses: [{ id: 'email_1', email_address: 'admin@rpms.local', verification: { status: 'verified' } }],
        },
      },
      true,
    );
    const res = await request(app).post('/api/webhooks/clerk').set(headers).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SIGNATURE');
  });

  it('400s a body signed with a different secret', async () => {
    const otherBytes = Buffer.from('entirely-different-secret-000000000000', 'utf8');
    const body = JSON.stringify({ type: ClerkUserCreated, data: { id: 'user_test_wh_other' } });
    const msgId = `msg_${crypto.randomBytes(8).toString('hex')}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto.createHmac('sha256', otherBytes).update(`${msgId}.${timestamp}.${body}`).digest('base64');
    const res = await request(app)
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', msgId)
      .set('svix-timestamp', timestamp)
      .set('svix-signature', `v1,${signature}`)
      .send(body);
    expect(res.status).toBe(400);
  });

  it('400s when the svix headers are missing entirely', async () => {
    const res = await request(app)
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ type: ClerkUserCreated, data: { id: 'user_test_wh_nohdr' } }));
    expect(res.status).toBe(400);
  });

  it('acknowledges unhandled event types without touching the table', async () => {
    const { body, headers } = signed({ type: 'session.created', data: { id: 'sess_1' } });
    const res = await request(app).post('/api/webhooks/clerk').set(headers).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.ignored).toBe('session.created');
  });

  it('maps nothing when the Clerk user has only unverified emails', async () => {
    const { body, headers } = signed({
      type: ClerkUserCreated,
      data: {
        id: 'user_test_wh_unverified',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'admin@rpms.local', verification: { status: 'unverified' } }],
      },
    });
    const res = await request(app).post('/api/webhooks/clerk').set(headers).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ mapped: null });

    const { queryOne } = await import('../../src/config/db');
    const row = await queryOne('SELECT id FROM user_external_ids WHERE external_id = $1', ['user_test_wh_unverified']);
    expect(row).toBeNull();
  });

  it('maps nothing when no ACTIVE staff user matches the verified email', async () => {
    const { body, headers } = signed({
      type: ClerkUserCreated,
      data: {
        id: 'user_test_wh_nobody',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'stranger@nowhere.test', verification: { status: 'verified' } }],
      },
    });
    const res = await request(app).post('/api/webhooks/clerk').set(headers).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.mapped).toBeNull();
  });

  it('auto-maps a verified email to the matching ACTIVE staff user (case-insensitively)', async () => {
    const { queryOne } = await import('../../src/config/db');
    const admin = await queryOne<{ id: number }>("SELECT id FROM users WHERE email = 'admin@rpms.local'");
    expect(admin).toBeTruthy();

    const { body, headers } = signed({
      type: ClerkUserCreated,
      data: {
        id: 'user_test_wh_admin',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'Admin@RPMs.local', verification: { status: 'verified' } }],
      },
    });
    const res = await request(app).post('/api/webhooks/clerk').set(headers).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ mapped: admin!.id });

    const row = await queryOne<{ user_id: number }>(
      "SELECT user_id FROM user_external_ids WHERE provider = 'clerk' AND external_id = 'user_test_wh_admin'",
    );
    expect(row!.user_id).toBe(admin!.id);

    // The auto-mapping replaces a manual provisioning step, so it shows in
    // the Audit trail attributed to the linked local user.
    const audit = await queryOne<{ new_value: { external_id: string; event: string } }>(
      `SELECT new_value FROM audit_logs
        WHERE action = 'CLERK_LINKED' AND entity = 'users' AND entity_id = $1
          AND new_value->>'external_id' = 'user_test_wh_admin'
        ORDER BY id DESC LIMIT 1`,
      [admin!.id],
    );
    expect(audit).toBeTruthy();
    expect(audit!.new_value).toMatchObject({ external_id: 'user_test_wh_admin', event: 'user.created' });
  });

  it('is idempotent — a replayed user.created does not duplicate or fail', async () => {
    const payload = {
      type: ClerkUserCreated,
      data: {
        id: 'user_test_wh_replay',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'staff@rpms.local', verification: { status: 'verified' } }],
      },
    };
    const first = signed(payload);
    const second = signed(payload); // fresh signature, same event (retry)
    const res1 = await request(app).post('/api/webhooks/clerk').set(first.headers).send(first.body);
    expect(res1.status).toBe(201);
    const res2 = await request(app).post('/api/webhooks/clerk').set(second.headers).send(second.body);
    expect(res2.status).toBe(200);
    expect(res2.body.data.alreadyMapped).toBe(true);
  });

  it('logs exactly one CLERK_LINKED row across the original event and its replay', async () => {
    const { queryOne } = await import('../../src/config/db');
    const count = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM audit_logs
        WHERE action = 'CLERK_LINKED' AND new_value->>'external_id' = 'user_test_wh_replay'`,
    );
    // The suite's mapping + replay above must have produced ONE trail row,
    // not one per delivery — Clerk retries must not flood the trail.
    expect(count).toMatchObject({ n: '1' });
  });

  it('records a refusal in the audit trail when nothing matches', async () => {
    const { body, headers } = signed({
      type: ClerkUserCreated,
      data: {
        id: 'user_test_wh_audit_refused',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'audit.refused@nowhere.test', verification: { status: 'verified' } }],
      },
    });
    const res = await request(app).post('/api/webhooks/clerk').set(headers).send(body);
    expect(res.status).toBe(200);

    const { queryOne } = await import('../../src/config/db');
    const audit = await queryOne<{ user_id: number | null; new_value: { reason: string; email: string } }>(
      `SELECT user_id, new_value FROM audit_logs
        WHERE action = 'CLERK_LINK_REFUSED' AND new_value->>'external_id' = 'user_test_wh_audit_refused'
        ORDER BY id DESC LIMIT 1`,
    );
    expect(audit).toBeTruthy();
    // Attributed to no local user ("system" in the trail) — the email did
    // not match one, and the row must not implicate an arbitrary user.
    expect(audit!.user_id).toBeNull();
    expect(audit!.new_value).toMatchObject({
      email: 'audit.refused@nowhere.test',
      reason: 'no matching active staff user',
    });
  });

  it('maps an INACTIVE local user only after an account update re-activates them', async () => {
    const { query } = await import('../../src/config/db');
    const bcrypt = (await import('bcryptjs')).default;
    const inserted = await query<{ id: number }>(
      `INSERT INTO users (name, email, phone, password_hash, role, status)
       VALUES ('Webhook Inactive', 'clerk.webhook.inactive@example.test', NULL, $1, 'PROPERTY_MANAGER', 'INACTIVE')
       RETURNING id`,
      [await bcrypt.hash('Irrelevant#2026', 4)],
    );
    const localId = inserted[0].id;

    // user.created while INACTIVE → no mapping.
    const created = signed({
      type: ClerkUserCreated,
      data: {
        id: 'user_test_wh_inactive',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'clerk.webhook.inactive@example.test', verification: { status: 'verified' } }],
      },
    });
    const res1 = await request(app).post('/api/webhooks/clerk').set(created.headers).send(created.body);
    expect(res1.status).toBe(200);
    expect(res1.body.data.mapped).toBeNull();

    // Admin activates the account; Clerk sends user.updated.
    await query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [localId]);
    const updated = signed({
      type: ClerkUserUpdated,
      data: {
        id: 'user_test_wh_inactive',
        primary_email_address_id: 'email_1',
        email_addresses: [{ id: 'email_1', email_address: 'clerk.webhook.inactive@example.test', verification: { status: 'verified' } }],
      },
    });
    const res2 = await request(app).post('/api/webhooks/clerk').set(updated.headers).send(updated.body);
    expect(res2.status).toBe(201);
    expect(res2.body.data).toMatchObject({ mapped: localId });
  });

  it('produces mapping rows in the exact shape the session bridge consumes', async () => {
    // The end-to-end promise of the feature: whatever this webhook inserts,
    // the Clerk session bridge (clerkBridgeMapped.test.ts) resolves to an
    // ACTIVE local user by (provider, external_id).
    const { queryOne } = await import('../../src/config/db');
    const row = await queryOne<{ id: number; status: string }>(
      `SELECT u.id, u.status
       FROM user_external_ids x
       JOIN users u ON u.id = x.user_id
       WHERE x.provider = 'clerk' AND x.external_id = 'user_test_wh_admin'`,
    );
    expect(row).toMatchObject({ status: 'ACTIVE' });
  });

  // --- Admin review of refused sign-ups (GET + link action) ----------------

  async function staffSession(email: string, password: string) {
    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookies = (Array.isArray(setCookie) ? setCookie : [String(setCookie)]).map((c) => c.split(';')[0]);
    const session = cookies.find((c) => c.startsWith('rpms_session='))!;
    const csrfCookie = cookies.find((c) => c.startsWith('rpms_csrf='))!;
    return { cookie: `${session}; ${csrfCookie}`, csrf: decodeURIComponent(csrfCookie.split('=')[1]) };
  }

  describe('admin review of refused sign-ups', () => {
    it('requires a staff session (webhook POST stays the only public path)', async () => {
      const res = await request(app).get('/api/webhooks/clerk/signups');
      expect(res.status).toBe(401);
    });

    it('forbids non-admin staff', async () => {
      const staff = await staffSession('staff@rpms.local', 'Staff@2026!');
      const res = await request(app).get('/api/webhooks/clerk/signups').set('Cookie', staff.cookie);
      expect(res.status).toBe(403);
    });

    it('lists deduplicated refusals with reason and live linked status', async () => {
      const admin = await staffSession('admin@rpms.local', 'Admin@2026!');
      // The earlier refusal tests produced rows for these two identities.
      const res = await request(app).get('/api/webhooks/clerk/signups').set('Cookie', admin.cookie);
      expect(res.status).toBe(200);
      const rows = res.body.data as {
        external_id: string; email: string | null; reason: string; refusals: number; linked_user_id: number | null;
      }[];
      const nobody = rows.find((r) => r.external_id === 'user_test_wh_nobody');
      expect(nobody).toMatchObject({
        email: 'stranger@nowhere.test',
        reason: 'no matching active staff user',
        linked_user_id: null,
      });
      expect(nobody!.refusals).toBeGreaterThanOrEqual(1);
      const unverified = rows.find((r) => r.external_id === 'user_test_wh_unverified');
      expect(unverified).toMatchObject({ reason: 'no verified email' });
    });

    it('links a refused identity to a staff user from the review view', async () => {
      const { queryOne } = await import('../../src/config/db');
      // Produce a refusal first, so the flow mirrors the real one: refused
      // sign-up appears in the review list, then an admin fixes it.
      const refused = signed({
        type: ClerkUserCreated,
        data: {
          id: 'user_test_wh_link_e2e',
          primary_email_address_id: 'email_1',
          email_addresses: [{ id: 'email_1', email_address: 'link.me@nowhere.test', verification: { status: 'verified' } }],
        },
      });
      const refusedRes = await request(app).post('/api/webhooks/clerk').set(refused.headers).send(refused.body);
      expect(refusedRes.status).toBe(200);
      expect(refusedRes.body.data.mapped).toBeNull();

      const admin = await staffSession('admin@rpms.local', 'Admin@2026!');
      const manager = await queryOne<{ id: number }>("SELECT id FROM users WHERE email = 'manager@rpms.local'");
      expect(manager).toBeTruthy();

      const link = await request(app)
        .post('/api/webhooks/clerk/signups/user_test_wh_link_e2e/link')
        .set('Cookie', admin.cookie)
        .set('x-csrf-token', admin.csrf)
        .send({ userId: manager!.id, refusalReason: 'no matching active staff user' });
      expect(link.status).toBe(201);
      expect(link.body.data).toMatchObject({ mapped: manager!.id });

      // The mapping is real: bridge-consumable shape, and the review list
      // now reports the identity as linked.
      const row = await queryOne<{ user_id: number }>(
        "SELECT user_id FROM user_external_ids WHERE provider = 'clerk' AND external_id = 'user_test_wh_link_e2e'",
      );
      expect(row!.user_id).toBe(manager!.id);
      const list = await request(app).get('/api/webhooks/clerk/signups').set('Cookie', admin.cookie);
      const linked = (list.body.data as { external_id: string; linked_user_id: number | null }[])
        .find((r) => r.external_id === 'user_test_wh_link_e2e');
      expect(linked!.linked_user_id).toBe(manager!.id);

      // Admin-attributed trail row (not system) — an admin action, not a
      // webhook decision.
      const audit = await queryOne<{ user_id: number }>(
        `SELECT user_id FROM audit_logs
          WHERE action = 'CLERK_LINKED' AND new_value->>'external_id' = 'user_test_wh_link_e2e'
            AND new_value->>'event' = 'admin_link'`,
      );
      expect(audit).toBeTruthy();
      expect(audit!.user_id).toEqual(expect.any(Number));

      // Double-link guards.
      const again = await request(app)
        .post('/api/webhooks/clerk/signups/user_test_wh_link_e2e/link')
        .set('Cookie', admin.cookie)
        .set('x-csrf-token', admin.csrf)
        .send({ userId: manager!.id });
      expect(again.status).toBe(409);
      expect(again.body.error).toBe('ALREADY_MAPPED');

      const other = signed({
        type: ClerkUserCreated,
        data: {
          id: 'user_test_wh_link_other',
          primary_email_address_id: 'email_1',
          email_addresses: [{ id: 'email_1', email_address: 'other@nowhere.test', verification: { status: 'verified' } }],
        },
      });
      await request(app).post('/api/webhooks/clerk').set(other.headers).send(other.body);
      const userDupe = await request(app)
        .post('/api/webhooks/clerk/signups/user_test_wh_link_other/link')
        .set('Cookie', admin.cookie)
        .set('x-csrf-token', admin.csrf)
        .send({ userId: manager!.id });
      expect(userDupe.status).toBe(409);
      expect(userDupe.body.error).toBe('USER_ALREADY_MAPPED');

      const missing = await request(app)
        .post('/api/webhooks/clerk/signups/user_test_wh_link_other/link')
        .set('Cookie', admin.cookie)
        .set('x-csrf-token', admin.csrf)
        .send({ userId: 999999999 });
      expect(missing.status).toBe(404);
    });
  });
});
