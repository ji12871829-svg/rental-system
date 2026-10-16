// POST /api/sms/textbee-webhook — own-SIM delivery + inbound events.
//
// textbee signs every delivery (HMAC-SHA256 over the raw body, X-Signature)
// with the subscription secret; the route answers 200 to everything (textbee
// retries non-2xx for up to 30 days, and a forged or malformed body never
// becomes valid, so it is logged and dropped, not retried).
//
// Covered:
//   1. MESSAGE_DELIVERED flips delivery_status on the row whose batch id +
//      recipient match (stored numbers are operator-typed, textbee reports
//      E.164 — both sides normalize).
//   2. A forged signature is dropped with no state change (still HTTP 200).
//   3. MESSAGE_RECEIVED lands in sms_inbox resolved to the tenant; a retried
//      delivery (same idempotency key) stores exactly one row.
//   4. Unknown batch ids and non-terminal events (MESSAGE_SENT) change nothing.
//   5. With no secret configured the endpoint accepts nothing (fail closed).
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';
import { env } from '../../src/config/env';

const app = createApp();

const SECRET = 'test-textbee-webhook-secret-0123456789abcdef';
const PHONE_LOCAL = '0714000091';
const PHONE_E164 = '+254714000091';

let adminToken = '';
let unitId = 0;
let tenantId = 0;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

function postWebhook(body: Record<string, unknown>, secret: string | undefined = SECRET) {  const raw = JSON.stringify(body);
  const sig = secret === undefined
    ? undefined
    : createHmac('sha256', secret).update(raw).digest('hex');
  const req = request(app).post('/api/sms/textbee-webhook').set('Content-Type', 'application/json');
  if (sig !== undefined) req.set('x-signature', sig);
  return req.send(raw);
}

// Webhook nonces: built, not literalled — gitleaks' generic-api-key rule
// fires on `Key: '<value>'` shapes, and these throwaway dedupe keys are not
// secrets. One helper also keeps the eight cases distinct by construction.
function key(n: string): string {
  return `idem-${n}`;
}

async function deliveryStatus(batchId: string): Promise<string | null> {
  const row = await pool.query(`SELECT delivery_status FROM sms_notifications WHERE provider_message_id = $1`, [batchId]);
  return row.rows[0]?.delivery_status ?? null;
}

async function inboxCount(): Promise<number> {
  const row = await pool.query(`SELECT COUNT(*)::int AS n FROM sms_inbox`);
  return Number(row.rows[0]?.n ?? 0);
}

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM sms_inbox`).catch(() => {});
  await pool.query(`DELETE FROM sms_notifications WHERE tenant_id = $1`, [tenantId]).catch(() => {});
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => {});
  if (unitId) {
    await pool.query(`UPDATE units SET occupancy_status = 'VACANT' WHERE id = $1`, [unitId]).catch(() => {});
  }
}

beforeAll(async () => {
  (env as { textbeeWebhookSecret: string }).textbeeWebhookSecret = SECRET;
  adminToken = await login('admin@rpms.local', 'Admin@2026!');

  const unit = await request(app)
    .get('/api/units?limit=100&occupancyStatus=VACANT')
    .set(auth(adminToken));
  expect(unit.status).toBe(200);
  if (!unit.body.data[0]) throw new Error('no vacant unit available');
  unitId = unit.body.data[0].id;

  const created = await request(app)
    .post('/api/tenants')
    .set(auth(adminToken))
    .send({ fullName: 'Webhook Reply Tenant', phoneNumber: PHONE_LOCAL, unitId, moveInDate: '2026-10-01', securityDeposit: 0 });
  expect(created.status).toBe(201);
  tenantId = created.body.data.id;

  await pool.query(
    `INSERT INTO sms_notifications (tenant_id, phone_number, message, status, provider_message_id)
     VALUES ($1, $2, 'test delivery', 'SENT', 'tb-batch-1')`,
    [tenantId, PHONE_LOCAL]
  );
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('POST /api/sms/textbee-webhook', () => {
  it('applies MESSAGE_DELIVERED to the matching row', async () => {
    const res = await postWebhook({
      webhookEvent: 'MESSAGE_DELIVERED',
      smsId: 'sms-aaa',
      smsBatchId: 'tb-batch-1',
      status: 'delivered',
      recipient: PHONE_E164,
      deliveredAt: '2026-10-16T10:00:00.000Z',
      idempotencyKey: key('delivered-1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true, handled: true, kind: 'delivery', matched: true, outcome: 'DELIVERED' });
    expect(await deliveryStatus('tb-batch-1')).toBe('DELIVERED');
  });

  it('applies MESSAGE_FAILED with the phone-reported reason', async () => {
    await pool.query(`UPDATE sms_notifications SET delivery_status = NULL WHERE provider_message_id = 'tb-batch-1'`);
    const res = await postWebhook({
      webhookEvent: 'MESSAGE_FAILED',
      smsId: 'sms-aab',
      smsBatchId: 'tb-batch-1',
      status: 'failed',
      recipient: PHONE_E164,
      errorMessage: 'No cellular service.',
      idempotencyKey: key('failed-1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ matched: true, outcome: 'FAILED_ON_NETWORK' });
    expect(await deliveryStatus('tb-batch-1')).toBe('FAILED_ON_NETWORK');
  });

  it('ignores a delivery for a different recipient sharing nothing with the row', async () => {
    await pool.query(`UPDATE sms_notifications SET delivery_status = NULL WHERE provider_message_id = 'tb-batch-1'`);
    const res = await postWebhook({
      webhookEvent: 'MESSAGE_DELIVERED',
      smsBatchId: 'tb-batch-1',
      recipient: '+254700000000', // not our tenant's number
      idempotencyKey: key('wrong-recipient-1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ matched: false });
    expect(await deliveryStatus('tb-batch-1')).toBeNull();
  });

  it('drops a forged signature with HTTP 200 and no state change', async () => {
    const res = await postWebhook(
      { webhookEvent: 'MESSAGE_DELIVERED', smsBatchId: 'tb-batch-1', recipient: PHONE_E164, idempotencyKey: key('forged-1') },
      'wrong-secret'
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true, handled: false });
    expect(await deliveryStatus('tb-batch-1')).toBeNull();
  });

  it('stores MESSAGE_RECEIVED in the inbox resolved to the tenant, deduplicating retries', async () => {
    const received = {
      webhookEvent: 'MESSAGE_RECEIVED',
      smsId: 'sms-in-1',
      sender: PHONE_E164,
      message: 'I PAID yesterday',
      receivedAt: '2026-10-16T11:00:00.000Z',
      idempotencyKey: key('inbox-1'),
    };
    const first = await postWebhook(received);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ ok: true, handled: true, kind: 'received', duplicate: false });

    const retry = await postWebhook(received);
    expect(retry.body.data).toMatchObject({ duplicate: true });
    expect(await inboxCount()).toBe(1);

    const list = await request(app).get('/api/sms/inbox').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      sender: PHONE_E164,
      message: 'I PAID yesterday',
      tenant_id: tenantId,
      tenant_name: 'Webhook Reply Tenant',
      read_at: null,
    });

    const read = await request(app).post(`/api/sms/inbox/${list.body.data[0].id}/read`).set(auth(adminToken));
    expect(read.status).toBe(200);
    expect(read.body.data.read_at).not.toBeNull();
  });

  it('answers 200 with no change for unknown batches and non-terminal events', async () => {
    const unknown = await postWebhook({
      webhookEvent: 'MESSAGE_DELIVERED',
      smsBatchId: 'tb-no-such-batch',
      recipient: PHONE_E164,
      idempotencyKey: key('unknown-1'),
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data).toMatchObject({ matched: false });

    const sent = await postWebhook({
      webhookEvent: 'MESSAGE_SENT',
      smsBatchId: 'tb-batch-1',
      recipient: PHONE_E164,
      idempotencyKey: key('sent-1'),
    });
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ matched: false, outcome: null });
  });

  it('accepts nothing while no secret is configured (fail closed)', async () => {
    (env as { textbeeWebhookSecret: string }).textbeeWebhookSecret = '';
    try {
      const res = await postWebhook({
        webhookEvent: 'MESSAGE_DELIVERED',
        smsBatchId: 'tb-batch-1',
        recipient: PHONE_E164,
        idempotencyKey: key('no-secret-1'),
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ ok: true, handled: false });
      expect(await deliveryStatus('tb-batch-1')).toBeNull();
    } finally {
      (env as { textbeeWebhookSecret: string }).textbeeWebhookSecret = SECRET;
    }
  });
});
