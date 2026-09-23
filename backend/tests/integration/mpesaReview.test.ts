// Integration tests for the M-Pesa review flow — staff manually assigning
// UNMATCHED C2B payments to tenants. This endpoint routes real money, so the
// suite covers: the phone-suggestion on the list payload, arrears-aware
// rent resolve (the same allocator as the automatic path), the
// allocate:false escape hatch, water resolve, 404/400 edges, and authz
// (staff and unauthenticated callers must be rejected).
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query } from '../../src/config/db';

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

async function tenantIdForUnit(unitNumber: string): Promise<number> {
  const rows = await query<{ tenant_id: number }>(
    `SELECT t.id AS tenant_id FROM tenants t JOIN units u ON u.id = t.unit_id
     WHERE UPPER(TRIM(u.unit_number)) = $1 AND t.status = 'ACTIVE' LIMIT 1`,
    [unitNumber]
  );
  if (!rows[0]) throw new Error(`no active tenant for unit ${unitNumber}`);
  return rows[0].tenant_id;
}

/** Insert an UNMATCHED C2B transaction exactly as the pipeline leaves one. */
async function seedUnmatched(transId: string, reference: string, amount: string, phone: string | null): Promise<number> {
  const res = await query<{ id: number }>(
    `INSERT INTO mpesa_transactions
       (source, transaction_id, account_reference, amount, transaction_date, phone_number, payment_kind, raw_payload, status, error_message)
     VALUES ('C2B', $1, $2, $3, '2026-09-20T09:00:00Z', $4, 'RENT', '{}'::jsonb, 'UNMATCHED', 'No active tenant matched unit reference.'),
     ('C2B', $1 || '-2', $2, $3, '2026-09-20T09:05:00Z', $4, 'RENT', '{}'::jsonb, 'UNMATCHED', 'No active tenant matched unit reference.')
     RETURNING id`,
    // Only the first row is needed; the insert above creates two rows so the
    // second test can use a fresh one without re-seeding. Adjusted below.
    [transId, reference, amount, phone]
  );
  return res[0].id;
}

/** Remove every row the suite created (FK-safe order). */
async function cleanup(transIds: string[]): Promise<void> {
  for (const transId of transIds) {
    await query(
      `DELETE FROM sms_notifications WHERE receipt_id IN (
         SELECT r.id FROM receipts r
         WHERE r.receipt_number IN (SELECT receipt_number FROM rent_payments WHERE payment_reference = $1 AND receipt_number IS NOT NULL)
       )`,
      [transId]
    );
    await query(
      `DELETE FROM receipts WHERE receipt_number IN (
         SELECT receipt_number FROM rent_payments WHERE payment_reference = $1 AND receipt_number IS NOT NULL
       )`,
      [transId]
    );
    await query(`UPDATE mpesa_transactions SET rent_payment_id = NULL WHERE rent_payment_id IN (SELECT id FROM rent_payments WHERE payment_reference = $1)`, [transId]);
    await query(`DELETE FROM rent_payments WHERE payment_reference = $1`, [transId]);
    await query(`DELETE FROM rent_payments WHERE payment_reference = $1 || '-2'`, [transId]);
    await query(`DELETE FROM mpesa_transactions WHERE transaction_id = $1 OR transaction_id = $1 || '-2'`, [transId]);
  }
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
});

afterAll(async () => {
  await pool.end();
});

describe('M-Pesa review: manual assignment of UNMATCHED payments', () => {
  const created: string[] = [];

  afterEach(async () => {
    await cleanup([...created]);
    created.length = 0;
  });

  it('requires authentication (unauthenticated list is 401)', async () => {
    const res = await request(app).get('/api/mpesa/review');
    expect(res.status).toBe(401);
  });

  it('rejects staff-role callers (manager/admin only)', async () => {
    const staffToken = await login('staff@rpms.local', 'Staff@2026!');
    const res = await request(app).get('/api/mpesa/review').set(auth(staffToken));
    expect(res.status).toBe(403);
  });

  it('lists UNMATCHED transactions with a phone-based suggested tenant', async () => {
    // Peter Otieno (unit 1) has phone +254711000001 in the fixture; seed an
    // unmatched payment sent from that exact number.
    const transId = `REV${Date.now()}`;
    created.push(transId);
    await seedUnmatched(transId, 'GARBAGE', '4000', '+254711000001');

    const res = await request(app).get('/api/mpesa/review').set(auth(adminToken));
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { transaction_id: string }) => r.transaction_id === transId);
    expect(row).toBeDefined();
    expect(row.status).toBe('UNMATCHED');
    expect(row.amount).toBe(4000);
    expect(row.suggested_tenant).not.toBeNull();
    expect(row.suggested_tenant.unit_number).toBe('1');
  });

  it('omits the suggestion when the phone matches nobody', async () => {
    const transId = `REVX${Date.now()}`;
    created.push(transId);
    await seedUnmatched(transId, 'GARBAGE2', '1000', '254700000999');

    const res = await request(app).get('/api/mpesa/review').set(auth(adminToken));
    const row = res.body.data.find((r: { transaction_id: string }) => r.transaction_id === transId);
    expect(row.suggested_tenant).toBeNull();
  });

  it('resolves rent with oldest-arrears allocation (same engine as the auto path)', async () => {
    const tenantId = await tenantIdForUnit('1');
    const { rentArrearsForYear } = await import('../../src/services/mpesaService');
    const arrears = await rentArrearsForYear(tenantId, 2026);
    expect(arrears.length).toBeGreaterThanOrEqual(2);
    const [first, second] = arrears;
    const transId = `REVA${Date.now()}`;
    created.push(transId);
    const id = await seedUnmatched(transId, 'WHOAMI', String(first.balance + second.balance), null);

    const res = await request(app)
      .post(`/api/mpesa/review/${id}/resolve`)
      .set(auth(adminToken))
      .send({ tenantId, kind: 'RENT' });
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('RENT');

    const payments = await query<{ billing_month: number; amount: string }>(
      `SELECT billing_month, amount::text AS amount FROM rent_payments WHERE payment_reference = $1 ORDER BY billing_month`,
      [transId]
    );
    expect(payments).toHaveLength(2);
    expect(payments[0].billing_month).toBe(first.month);
    expect(Number(payments[0].amount)).toBe(first.balance);
    expect(payments[1].billing_month).toBe(second.month);
    expect(Number(payments[1].amount)).toBe(second.balance);

    const stored = await query<{ status: string; tenant_id: number | null }>(
      `SELECT status, tenant_id FROM mpesa_transactions WHERE id = $1`,
      [id]
    );
    expect(stored[0]?.status).toBe('POSTED');
    expect(stored[0]?.tenant_id).toBe(tenantId);
  });

  it('honors allocate:false to force the full amount onto the transaction month', async () => {
    const tenantId = await tenantIdForUnit('1');
    const transId = `REVB${Date.now()}`;
    created.push(transId);
    const id = await seedUnmatched(transId, 'WHOAMI2', '3000', null);

    const res = await request(app)
      .post(`/api/mpesa/review/${id}/resolve`)
      .set(auth(adminToken))
      .send({ tenantId, kind: 'RENT', allocate: false });
    expect(res.status).toBe(200);

    const payments = await query<{ billing_month: number; amount: string }>(
      `SELECT billing_month, amount::text AS amount FROM rent_payments WHERE payment_reference = $1`,
      [transId]
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].billing_month).toBe(9); // transaction month (2026-09-20)
    expect(Number(payments[0].amount)).toBe(3000);
  });

  it('resolves WATER payments to the transaction month (no allocation)', async () => {
    // Unit 12 (John Mwangi) is water-enabled in the fixture.
    const tenantId = await tenantIdForUnit('12');
    const transId = `REVW${Date.now()}`;
    created.push(transId);
    const id = await seedUnmatched(transId, 'WREF', '800', null);

    const res = await request(app)
      .post(`/api/mpesa/review/${id}/resolve`)
      .set(auth(adminToken))
      .send({ tenantId, kind: 'WATER' });
    expect(res.status).toBe(200);

    const water = await query<{ amount: string }>(
      `SELECT amount::text AS amount FROM water_payments WHERE tenant_id = $1 AND billing_month = 9 AND billing_year = 2026 AND amount = 800`,
      [tenantId]
    );
    expect(water.length).toBe(1);
  });

  it('404s an unknown transaction id', async () => {
    const res = await request(app)
      .post('/api/mpesa/review/999999/resolve')
      .set(auth(adminToken))
      .send({ tenantId: 1, kind: 'RENT' });
    expect(res.status).toBe(404);
  });

  it('rejects resolving an already-POSTED transaction', async () => {
    const transId = `REVP${Date.now()}`;
    created.push(transId);
    const id = await seedUnmatched(transId, 'DONE', '500', null);
    await query(`UPDATE mpesa_transactions SET status = 'POSTED' WHERE id = $1`, [id]);

    const res = await request(app)
      .post(`/api/mpesa/review/${id}/resolve`)
      .set(auth(adminToken))
      .send({ tenantId: await tenantIdForUnit('1'), kind: 'RENT' });
    expect(res.status).toBe(400);
  });

  it('rejects an inactive tenant', async () => {
    const transId = `REVI${Date.now()}`;
    created.push(transId);
    const id = await seedUnmatched(transId, 'WHOAMI3', '500', null);
    const movedOut = await query<{ id: number }>(
      `SELECT id FROM tenants WHERE status <> 'ACTIVE' LIMIT 1`
    );
    if (movedOut[0]) {
      const res = await request(app)
        .post(`/api/mpesa/review/${id}/resolve`)
        .set(auth(adminToken))
        .send({ tenantId: movedOut[0].id, kind: 'RENT' });
      expect(res.status).toBe(400);
    }
  });
});
