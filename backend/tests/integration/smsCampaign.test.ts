// POST /api/sms/campaign — one operator composition, personalised per tenant.
//
// The confirmation channel: {{name}} / {{unit}} merge per ACTIVE tenant,
// one PENDING sms_notifications row each. Guards under test:
//   1. Tenants without a phone are skipped (never queued, never sent).
//   2. Renders past the two-segment GSM-7 budget are counted as tooLong and
//      never queued — cost control, not silent drops.
//   3. The merge actually personalises (name + unit land in the stored row).
//   4. Validation rejects an empty composition (400, nothing queued).
//
// Auto-send is off under NODE_ENV=test, so rows stay PENDING here — the same
// rows a live deploy would auto-dispatch or leave for manual send.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

let adminToken = '';
let unitId = 0;
let phoneTenantId = 0;
let phonelessTenantId = 0;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

async function findVacantUnit(): Promise<{ id: number }> {
  const res = await request(app)
    .get('/api/units?limit=100&occupancyStatus=VACANT')
    .set(auth(adminToken));
  expect(res.status).toBe(200);
  const unit = res.body.data[0];
  if (!unit) throw new Error('no vacant unit available');
  return unit;
}

async function smsRowsFor(tenantIds: number[]): Promise<{ id: number; tenant_id: number; message: string; status: string }[]> {
  const res = await pool.query(
    `SELECT id, tenant_id, message, status FROM sms_notifications WHERE tenant_id = ANY($1::int[]) ORDER BY id`,
    [tenantIds]
  );
  return res.rows;
}

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM sms_notifications WHERE tenant_id = ANY($1::int[])`, [[phoneTenantId, phonelessTenantId].filter(Boolean)]).catch(() => {});
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1::int[])`, [[phoneTenantId, phonelessTenantId].filter(Boolean)]).catch(() => {});
  if (unitId) {
    await pool.query(`UPDATE units SET occupancy_status = 'VACANT' WHERE id = $1`, [unitId]).catch(() => {});
  }
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  const unit = await findVacantUnit();
  unitId = unit.id;

  const withPhone = await request(app)
    .post('/api/tenants')
    .set(auth(adminToken))
    .send({ fullName: 'Campaign Confirm Tenant', phoneNumber: '0714000099', unitId, moveInDate: '2026-10-01', securityDeposit: 0 });
  expect(withPhone.status).toBe(201);
  phoneTenantId = withPhone.body.data.id;

  // No unit, no phone: reachable by the campaign only as a skip.
  const withoutPhone = await request(app)
    .post('/api/tenants')
    .set(auth(adminToken))
    .send({ fullName: 'Campaign Silent Tenant', moveInDate: '2026-10-01', securityDeposit: 0 });
  expect(withoutPhone.status).toBe(201);
  phonelessTenantId = withoutPhone.body.data.id;
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('POST /api/sms/campaign', () => {
  it('queues a personalised row per reachable tenant and skips the phoneless one', async () => {
    const res = await request(app)
      .post('/api/sms/campaign')
      .set(auth(adminToken))
      .send({ tenantIds: [phoneTenantId, phonelessTenantId], message: 'Dear {{name}}, your Unit {{unit}} statement is ready. Regards, Olbano Plaza.' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ total: 2, queued: 1, skipped: 1, tooLong: 0 });

    const rows = await smsRowsFor([phoneTenantId, phonelessTenantId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(phoneTenantId);
    expect(rows[0].status).toBe('PENDING');
    // The merge landed in the stored row — not the raw tokens.
    expect(rows[0].message).toContain('Campaign Confirm Tenant');
    expect(rows[0].message).not.toContain('{{name}}');
    expect(rows[0].message).not.toContain('{{unit}}');
  });

  it('counts over-budget renders as tooLong and queues nothing', async () => {
    const before = await smsRowsFor([phoneTenantId]);
    const res = await request(app)
      .post('/api/sms/campaign')
      .set(auth(adminToken))
      .send({ tenantIds: [phoneTenantId], message: `Dear {{name}}, ${'x'.repeat(400)}` });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ total: 1, queued: 0, skipped: 0, tooLong: 1 });
    expect(await smsRowsFor([phoneTenantId])).toHaveLength(before.length);
  });

  it('rejects an empty composition without touching the queue', async () => {
    const before = await smsRowsFor([phoneTenantId, phonelessTenantId]);
    const res = await request(app)
      .post('/api/sms/campaign')
      .set(auth(adminToken))
      .send({ tenantIds: [phoneTenantId], message: '  ' });
    expect(res.status).toBe(400);
    expect(await smsRowsFor([phoneTenantId, phonelessTenantId])).toHaveLength(before.length);
  });
});
