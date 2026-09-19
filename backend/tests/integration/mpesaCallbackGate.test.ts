// Regression tests for the Daraja callback gate (routes/mpesa.ts): shared
// secret (MPESA_CALLBACK_TOKEN), business-shortcode validation, and the
// behavior when neither is configured (local mock mode — endpoints open).
// The env object is mutated per test and restored afterwards.
import request from 'supertest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { pool, query } from '../../src/config/db';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

// Resolves the tenant id for a fixture unit number (ids are not sequential
// with unit numbers in the seed).
async function tenantIdForUnit(unitNumber: string): Promise<number> {
  const rows = await query<{ tenant_id: number }>(
    `SELECT t.id AS tenant_id FROM tenants t JOIN units u ON u.id = t.unit_id
     WHERE UPPER(TRIM(u.unit_number)) = $1 AND t.status = 'ACTIVE' LIMIT 1`,
    [unitNumber]
  );
  if (!rows[0]) throw new Error(`no active tenant for unit ${unitNumber}`);
  return rows[0].tenant_id;
}

const originalToken = env.mpesaCallbackToken;
const originalShortcode = env.mpesaShortcode;

afterAll(() => {
  env.mpesaCallbackToken = originalToken;
  env.mpesaShortcode = originalShortcode;
});

describe('M-Pesa callback gate', () => {
  afterEach(() => {
    env.mpesaCallbackToken = originalToken;
    env.mpesaShortcode = originalShortcode;
  });

  it('stays open when no token is configured (mock/local mode)', async () => {
    env.mpesaCallbackToken = '';
    const res = await request(app).post('/api/mpesa/c2b/validate').send({});
    expect(res.status).toBe(200);
    expect(res.body.ResultCode).toBe(0);
  });

  it('posts a full C2B confirmation into the ledger (partial-index ON CONFLICT works)', async () => {
    // Regression for the ON CONFLICT (transaction_id) vs partial-unique-index
    // bug: this insert previously threw "no unique or exclusion constraint
    // matching the ON CONFLICT specification", so every real paybill
    // confirmation failed and Daraja would retry forever.
    env.mpesaShortcode = '4100100';
    const tenantId = await tenantIdForUnit('1'); // fixture tenant: Peter Otieno
    const before = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM rent_payments WHERE tenant_id = $1',
      [tenantId]
    );
    const transId = `RGATE${Date.now()}`;

    const res = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send({
        TransID: transId,
        TransAmount: '1500',
        BusinessShortCode: '4100100',
        BillRefNumber: '1',
        TransTime: '20260919120002',
        MSISDN: '254700000000',
      });
    expect(res.status).toBe(200);
    expect(res.body.ResultCode).toBe(0);

    const after = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM rent_payments WHERE tenant_id = $1',
      [tenantId]
    );
    expect(Number(after[0].count)).toBe(Number(before[0].count) + 1);

    // Replay of the same TransID must be a no-op (idempotent dedup).
    const replay = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send({
        TransID: transId,
        TransAmount: '1500',
        BusinessShortCode: '4100100',
        BillRefNumber: '1',
        TransTime: '20260919120002',
        MSISDN: '254700000000',
      });
    const replayed = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM rent_payments WHERE tenant_id = $1',
      [tenantId]
    );
    void replay;
    expect(Number(replayed[0].count)).toBe(Number(after[0].count));
  });

  it('rejects callback bodies naming a different business shortcode', async () => {
    env.mpesaShortcode = '4100100';
    const res = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send({
        TransID: 'RJ68Q5FM9Z',
        TransAmount: '1000',
        BusinessShortCode: '999777', // not our till
        BillRefNumber: 'A1',
        TransTime: '20260919120000',
        MSISDN: '254700000000',
      });
    expect(res.status).toBe(400);
    expect(res.body.ResultCode).toBe(1);
  });

  describe('with MPESA_CALLBACK_TOKEN configured', () => {
    beforeEach(() => {
      env.mpesaCallbackToken = 'unit-test-callback-secret';
    });

    it('rejects a callback with no token (404 — endpoint not revealed)', async () => {
      const res = await request(app).post('/api/mpesa/c2b/validate').send({});
      expect(res.status).toBe(404);
    });

    it('rejects a wrong token', async () => {
      const res = await request(app)
        .post('/api/mpesa/c2b/validate?token=wrong-secret')
        .send({});
      expect(res.status).toBe(404);
    });

    it('passes the correct token through to the handler', async () => {
      const res = await request(app)
        .post('/api/mpesa/c2b/validate?token=unit-test-callback-secret')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.ResultCode).toBe(0);
    });
  });
});
