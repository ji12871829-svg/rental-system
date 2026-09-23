// Integration tests for the tenant portal's "Pay with M-Pesa" STK push.
//
// The load-bearing properties:
//   * auth — only a logged-in portal tenant can push, and only for themselves
//     (there is no tenant-id parameter at all: the session IS the tenant);
//   * gating — with PayHero unconfigured (the dev/test default) the POST
//     returns 503 PAYHERO_UNCONFIGURED and the config endpoint says disabled,
//     so the frontend hides the card;
//   * validation — amount must be a positive number under the ceiling;
//   * money-path honesty — a successful push must NOT pre-create an
//     mpesa_transactions row: the completed payment arrives as an ordinary
//     C2B collection and the poller posts it exactly once. A pre-created row
//     would give the same money two identities (double-posting surface).
//
// Fixtures: portal access is attached to an existing seeded ACTIVE tenant
// (access rows authenticate independently of tenants.email), so no units or
// tenancies are created here and suite ordering cannot break the data.
// PayHero's HTTP boundary is stubbed at global.fetch.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query, queryOne } from '../../src/config/db';
import { env } from '../../src/config/env';
import { normalizePhoneNumber } from '../../src/services/smsProvider';

const app = createApp();

const ACCESS_EMAIL = 'stkp.push@example.com';
const ACCESS_PASSWORD = 'Passw0rd!123';

// Snapshot BEFORE the suite runs, so audit cleanup touches only this suite's
// rows even if another suite wrote PORTAL_* rows for the same tenant.
let tenantId = 0;
let agent: request.Agent;
let portalCsrf = '';

async function loginPortal(email: string, password: string): Promise<void> {
  agent = request.agent(app);
  const res = await agent.post('/api/portal/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`portal login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  // The login mints the portal csrf cookie; capture its value so the unsafe
  // (POST) calls below can send the matching header (double-submit).
  const setCookies = res.headers['set-cookie'] as unknown as string[];
  portalCsrf = setCookies?.find((c) => c.startsWith('rpms_portal_csrf='))?.split(';')[0].split('=')[1] ?? '';
  if (!portalCsrf) throw new Error('portal login did not set rpms_portal_csrf');
}

beforeAll(async () => {
  const tenant = await queryOne<{ id: number; phone_number: string; unit_number: string }>(
    `SELECT t.id, t.phone_number, u.unit_number
     FROM tenants t JOIN units u ON u.id = t.unit_id
     WHERE t.status = 'ACTIVE' AND t.phone_number IS NOT NULL AND u.unit_number IS NOT NULL
     ORDER BY t.id LIMIT 1`
  );
  if (!tenant) throw new Error('No seeded ACTIVE tenant with phone + unit — seed data missing?');
  tenantId = tenant.id;

  const bcrypt = (await import('bcryptjs')).default;
  await query(
    `INSERT INTO tenant_portal_access (tenant_id, email, password_hash, status)
     VALUES ($1, $2, $3, 'ACTIVE')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE'`,
    [tenantId, ACCESS_EMAIL, bcrypt.hashSync(ACCESS_PASSWORD, 10)]
  );

  await loginPortal(ACCESS_EMAIL, ACCESS_PASSWORD);
});

afterAll(async () => {
  await query(`DELETE FROM audit_logs WHERE action LIKE 'PORTAL_STK_PUSH%' AND entity = 'tenants' AND entity_id = $1`, [tenantId]);
  await query(`DELETE FROM tenant_portal_access WHERE email = $1`, [ACCESS_EMAIL]);
  await pool.end();
});

function withFetchStub<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = global.fetch;
  global.fetch = impl as typeof fetch;
  return fn().finally(() => {
    global.fetch = original;
  });
}

function withPayheroConfigured<T>(fn: () => Promise<T>): Promise<T> {
  const prevUser = env.payheroApiUsername;
  const prevPass = env.payheroApiPassword;
  const prevChannel = env.payheroChannelId;
  (env as { payheroApiUsername: string }).payheroApiUsername = 'stk-test-user';
  (env as { payheroApiPassword: string }).payheroApiPassword = 'stk-test-pass';
  (env as { payheroChannelId: string }).payheroChannelId = '12345';
  return fn().finally(() => {
    (env as { payheroApiUsername: string }).payheroApiUsername = prevUser;
    (env as { payheroApiPassword: string }).payheroApiPassword = prevPass;
    (env as { payheroChannelId: string }).payheroChannelId = prevChannel;
  });
}

describe('GET /api/portal/pay-rent/config', () => {
  it('requires a portal session', async () => {
    const res = await request(app).get('/api/portal/pay-rent/config');
    expect(res.status).toBe(401);
  });

  it('reports disabled with a reason when PayHero is unconfigured (test default)', async () => {
    const res = await agent.get('/api/portal/pay-rent/config');
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
    expect(res.body.data.reason).toMatch(/not available|send-money/i);
    expect(res.body.data.targetPhone).toBeNull();
  });
});

describe('POST /api/portal/pay-rent/stk-push', () => {
  it('requires a portal session', async () => {
    const res = await request(app).post('/api/portal/pay-rent/stk-push').send({ amount: 1000 });
    expect(res.status).toBe(401);
  });

  it('rejects missing/invalid amounts before any provider call', async () => {
    for (const amount of [undefined, 0, -50, 'abc', 5_000_000]) {
      const res = await agent.post('/api/portal/pay-rent/stk-push').set('X-CSRF-Token', portalCsrf).send({ amount });
      expect([400, 422]).toContain(res.status);
    }
  });

  it('returns 503 PAYHERO_UNCONFIGURED when PayHero is not configured', async () => {
    const res = await agent.post('/api/portal/pay-rent/stk-push').set('X-CSRF-Token', portalCsrf).send({ amount: 1000 });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('PAYHERO_UNCONFIGURED');
    expect(res.body.message).toMatch(/not available|send-money/i);
  });

  it('initiates a push with the tenant record phone, audits it, and pre-creates NO mpesa_transactions row', async () => {
    const tenant = await queryOne<{ phone_number: string; unit_number: string }>(
      `SELECT t.phone_number, u.unit_number FROM tenants t JOIN units u ON u.id = t.unit_id WHERE t.id = $1`,
      [tenantId]
    );
    const expectedPhone = normalizePhoneNumber(tenant!.phone_number);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = (input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(
        new Response(JSON.stringify({ checkout_request_id: 'CO-STK-TEST-1', response_description: 'Success. Request accepted' }), { status: 200 })
      );
    };

    await withPayheroConfigured(() =>
      withFetchStub(fetchImpl, async () => {
        const res = await agent.post('/api/portal/pay-rent/stk-push').set('X-CSRF-Token', portalCsrf).send({ amount: 4000 });
        expect(res.status).toBe(202);
        expect(res.body.data.checkoutRequestId).toBe('CO-STK-TEST-1');
        expect(res.body.data.phone).toBe(expectedPhone);
        expect(res.body.data.instructions).toMatch(/M-Pesa request/i);
      })
    );

    // The provider call went out with the right shape.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/mpesa/stk-push');
    const payload = JSON.parse(String(calls[0].init?.body ?? '{}'));
    expect(payload.phone_number).toBe(expectedPhone);
    expect(payload.amount).toBe(4000);
    expect(payload.channel_id).toBe('12345');
    expect(payload.external_reference).toBe(`RENT-${tenant!.unit_number}`);

    // Money-path honesty: no pre-created transaction row for this push.
    const rows = await query<{ id: number }>(
      `SELECT id FROM mpesa_transactions WHERE checkout_request_id = $1`,
      ['CO-STK-TEST-1']
    );
    expect(rows.length).toBe(0);

    // And the initiation is audit-logged.
    const audit = await query<{ id: number }>(
      `SELECT id FROM audit_logs WHERE action = 'PORTAL_STK_PUSH_INITIATED' AND entity_id = $1`,
      [tenantId]
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces provider failure as an error response and audit-logs the failure', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ message: 'Insufficient balance in channel' }), { status: 502 }));

    await withPayheroConfigured(() =>
      withFetchStub(fetchImpl, async () => {
        const res = await agent.post('/api/portal/pay-rent/stk-push').set('X-CSRF-Token', portalCsrf).send({ amount: 1000 });
        expect(res.status).toBe(502);
        expect(res.body.message).toMatch(/Insufficient balance/i);
      })
    );

    const audit = await query<{ id: number }>(
      `SELECT id FROM audit_logs WHERE action = 'PORTAL_STK_PUSH_FAILED' AND entity_id = $1`,
      [tenantId]
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});
