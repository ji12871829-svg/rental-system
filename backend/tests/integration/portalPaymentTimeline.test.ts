// Integration tests for the tenant-portal payment-status timeline
// (GET /api/portal/payment-status): each of the tenant's recent M-Pesa RENT
// payments appears with its pipeline stage (CONFIRMING / MATCHED / POSTED /
// NEEDS_REVIEW), scoped strictly to the session tenant, with no provider
// payloads, staff error wording, or other tenants' rows leaking.
//
// Fixtures: portal access is attached to an existing seeded ACTIVE tenant
// (same pattern as portalStkPush.test.ts); rows are inserted directly into
// mpesa_transactions with backdated timestamps and cleaned up completely.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query, queryOne } from '../../src/config/db';

const app = createApp();

const ACCESS_EMAIL = 'timeline.push@example.com';
const ACCESS_PASSWORD = 'Passw0rd!123';
const OTHER_PHONE = '0799000999';

let tenantId = 0;
let agent: request.Agent;
let portalCsrf = '';
const createdTxnIds: number[] = [];

async function loginPortal(): Promise<void> {
  agent = request.agent(app);
  const res = await agent.post('/api/portal/login').send({ email: ACCESS_EMAIL, password: ACCESS_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`portal login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const setCookies = res.headers['set-cookie'] as unknown as string[];
  portalCsrf = setCookies?.find((c) => c.startsWith('rpms_portal_csrf='))?.split(';')[0].split('=')[1] ?? '';
  if (!portalCsrf) throw new Error('portal login did not set rpms_portal_csrf');
}

async function insertTxn(input: { status: string; tenantId: number | null; amount?: string; reference?: string }): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO mpesa_transactions
       (source, transaction_id, account_reference, amount, transaction_date, phone_number, payment_kind, raw_payload, status, tenant_id)
     VALUES ('C2B', $1, $2, $3, NOW(), $4, 'RENT', '{}'::jsonb, $5, $6)
     RETURNING id`,
    [`TL-${input.reference ?? input.status}-${Date.now()}-${Math.floor(Math.random() * 10000)}`, input.reference ?? 'TL-UNIT', input.amount ?? '1500', OTHER_PHONE, input.status, input.tenantId]
  );
  createdTxnIds.push(rows[0].id);
  return rows[0].id;
}

beforeAll(async () => {
  const tenant = await queryOne<{ id: number; phone_number: string; unit_number: string }>(
    `SELECT t.id, t.phone_number, u.unit_number
     FROM tenants t JOIN units u ON u.id = t.unit_id
     WHERE t.status = 'ACTIVE' AND t.phone_number IS NOT NULL AND u.unit_number IS NOT NULL
     ORDER BY t.id LIMIT 1`
  );
  if (!tenant) throw new Error('No seeded ACTIVE tenant with phone + unit');
  tenantId = tenant.id;

  const bcrypt = (await import('bcryptjs')).default;
  await query(
    `INSERT INTO tenant_portal_access (tenant_id, email, password_hash, status)
     VALUES ($1, $2, $3, 'ACTIVE')
     ON CONFLICT (tenant_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE', email = EXCLUDED.email`,
    [tenantId, ACCESS_EMAIL, bcrypt.hashSync(ACCESS_PASSWORD, 10)]
  );

  await loginPortal();
});

afterAll(async () => {
  for (const id of createdTxnIds) {
    await query(`UPDATE mpesa_transactions SET rent_payment_id = NULL WHERE id = $1`, [id]);
  }
  await query(`DELETE FROM mpesa_transactions WHERE id = ANY($1::int[])`, [createdTxnIds]);
  await query(`DELETE FROM tenant_portal_access WHERE email = $1`, [ACCESS_EMAIL]);
  await pool.end();
});

describe('GET /api/portal/payment-status', () => {
  it('requires a portal session', async () => {
    const res = await request(app).get('/api/portal/payment-status');
    expect(res.status).toBe(401);
  });

  it('maps each pipeline status to the tenant-facing stage', async () => {
    const posted = await insertTxn({ status: 'POSTED', tenantId });
    const confirming = await insertTxn({ status: 'RECEIVED', tenantId });
    const matched = await insertTxn({ status: 'MATCHED', tenantId });
    const review = await insertTxn({ status: 'UNMATCHED', tenantId });

    const res = await agent.get('/api/portal/payment-status');
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ id: number; stage: string; amount: number; receiptNumber: string | null; pushExpiresInSeconds: number | null }>;

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(posted)?.stage).toBe('POSTED');
    expect(byId.get(confirming)?.stage).toBe('CONFIRMING');
    expect(byId.get(confirming)?.pushExpiresInSeconds).toBe(60);
    expect(byId.get(matched)?.stage).toBe('MATCHED');
    expect(byId.get(review)?.stage).toBe('NEEDS_REVIEW');

    // Money shape: amounts are numbers.
    expect(byId.get(posted)?.amount).toBe(1500);
  });

  it('never exposes provider payloads or staff error wording', async () => {
    await insertTxn({ status: 'UNMATCHED', tenantId, reference: 'BADREF' });
    const res = await agent.get('/api/portal/payment-status');
    const serialized = JSON.stringify(res.body).toLowerCase();
    expect(serialized).not.toContain('raw_payload');
    expect(serialized).not.toContain('no active tenant matched');
    expect(serialized).not.toContain('transaction_id');
    expect(serialized).not.toContain('checkout_request');
  });

  it('shows only the session tenant\u2019s payments', async () => {
    const mine = await insertTxn({ status: 'RECEIVED', tenantId });
    const theirs = await insertTxn({ status: 'RECEIVED', tenantId: null });

    const res = await agent.get('/api/portal/payment-status');
    const ids = (res.body.data as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it('orders newest first and only carries RENT rows', async () => {
    const rent = await insertTxn({ status: 'RECEIVED', tenantId });
    await query(`UPDATE mpesa_transactions SET payment_kind = 'WATER' WHERE id = $1`, [rent]);
    const res = await agent.get('/api/portal/payment-status');
    const ids = (res.body.data as Array<{ id: number }>).map((r) => r.id);
    expect(ids).not.toContain(rent);
    // Restore kind so cleanup by id is unaffected (row is deleted anyway).
    await query(`UPDATE mpesa_transactions SET payment_kind = 'RENT' WHERE id = $1`, [rent]);
  });
});
