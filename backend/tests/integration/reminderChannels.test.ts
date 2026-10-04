// Tenant reminders — the POST /api/tenants/:id/sms-reminder router.
//
// The reminder flow moved out of smsService into the Tenant reminder module;
// this suite drives all three channels through HTTP, the way the frontend
// calls them:
//   * auth       — 401 without a session, 403 for STAFF (managerOrAdmin)
//   * SMS        — PENDING sms_notifications row + SMS_REMINDER_QUEUED audit
//   * EMAIL      — PENDING email_notifications row (statement breakdown) +
//                  REMINDER_EMAIL_QUEUED audit, via emailService's queue
//   * WHATSAPP   — no queue: a wa.me click-to-chat URL + composed audit
//   * no-contact — 409 TENANT_NO_CONTACT per channel, nothing written
//   * unknown    — 404, and a malformed body 400s
//
// Hermetic: the suite creates its own unit and two tenants (one with phone +
// email, one with neither) and removes them — with their notification and
// audit rows — in afterAll. Nothing else in the DB is touched.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

let adminToken = '';
let staffToken = '';
let unitId: number;
let tenantId: number;
let noContactTenantId: number;

const REMINDER_ACTIONS = ['SMS_REMINDER_QUEUED', 'REMINDER_EMAIL_QUEUED', 'REMINDER_WHATSAPP_COMPOSED'];

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function countRows(table: 'sms_notifications' | 'email_notifications', tenant: number): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenant]);
  return rows[0].n as number;
}

async function auditRow(action: string, tenant: number) {
  const { rows } = await pool.query(
    `SELECT user_id, new_value FROM audit_logs
     WHERE action = $1 AND entity = 'tenant' AND entity_id = $2
     ORDER BY id DESC LIMIT 1`,
    [action, tenant],
  );
  return rows[0];
}

async function cleanup(): Promise<void> {
  const ids = [tenantId, noContactTenantId].filter((id) => typeof id === 'number');
  await pool.query(
    `DELETE FROM audit_logs WHERE entity = 'tenant' AND entity_id = ANY($1::int[]) AND action = ANY($2::text[])`,
    [ids, REMINDER_ACTIONS],
  );
  // Notification rows cascade with the tenants.
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1::int[])`, [ids]);
  if (unitId) await pool.query(`DELETE FROM units WHERE id = $1`, [unitId]);
}

/** Removes fixture rows a crashed earlier run may have left behind. */
async function removeStaleFixtures(): Promise<void> {
  await pool.query(
    `DELETE FROM tenants WHERE full_name IN ('Reminder Channel Tenant', 'Reminder No-Contact Tenant')`,
  );
  await pool.query(`DELETE FROM units WHERE unit_number = 'ZREM1'`);
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  staffToken = await login('staff@rpms.local', 'Staff@2026!');
  await removeStaleFixtures();

  const unit = await pool.query(
    `INSERT INTO units (property_id, floor_id, unit_number, unit_type, monthly_rent, occupancy_status)
     SELECT p.id, f.id, 'ZREM1', 'Room', 5000, 'OCCUPIED'
     FROM properties p JOIN floors f ON f.property_id = p.id
     ORDER BY p.id, f.id LIMIT 1
     RETURNING id`,
  );
  expect(unit.rows).toHaveLength(1);
  unitId = unit.rows[0].id as number;

  const tenant = await pool.query(
    `INSERT INTO tenants (unit_id, full_name, phone_number, email, move_in_date, status)
     VALUES ($1, 'Reminder Channel Tenant', '254700000001', 'reminder.fixture@rpms.test', DATE '2026-01-01', 'ACTIVE')
     RETURNING id`,
    [unitId],
  );
  tenantId = tenant.rows[0].id as number;

  const bare = await pool.query(
    `INSERT INTO tenants (full_name, phone_number, email, move_in_date, status)
     VALUES ('Reminder No-Contact Tenant', NULL, NULL, DATE '2026-01-01', 'ACTIVE')
     RETURNING id`,
  );
  noContactTenantId = bare.rows[0].id as number;
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('Tenant reminders — auth', () => {
  it('401s without a session', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .send({ kind: 'BALANCE_DUE', channel: 'SMS' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('403s for STAFF — reminders are a manager/admin action', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(staffToken))
      .send({ kind: 'BALANCE_DUE', channel: 'SMS' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });
});

describe('Tenant reminders — SMS channel', () => {
  it('queues a PENDING sms row from the live ledger and audits it', async () => {
    const before = await countRows('sms_notifications', tenantId);
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'BALANCE_DUE', channel: 'SMS' });

    expect(res.status).toBe(202);
    expect(res.body.data.smsId).toBeGreaterThan(0);
    expect(res.body.data.emailId).toBeNull();
    expect(res.body.data.whatsappUrl).toBeNull();
    expect(res.body.data.autoSend).toBe(false); // the test env opts out of auto-send
    expect(res.body.data.message).toContain('ZREM1');

    const { rows } = await pool.query(
      `SELECT tenant_id, phone_number, status, message FROM sms_notifications WHERE id = $1`,
      [res.body.data.smsId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(tenantId);
    expect(rows[0].phone_number).toBe('254700000001');
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].message).toBe(res.body.data.message);
    expect(await countRows('sms_notifications', tenantId)).toBe(before + 1);

    const audit = await auditRow('SMS_REMINDER_QUEUED', tenantId);
    expect(audit).toBeDefined();
    expect(Number(audit.user_id)).toBeGreaterThan(0);
    expect(audit.new_value.kind).toBe('BALANCE_DUE');
    expect(Number(audit.new_value.smsId)).toBe(Number(res.body.data.smsId));
  });

  it('composes the OVERDUE kind with the overdue notice, not the balance-due copy', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'OVERDUE', channel: 'SMS' });
    expect(res.status).toBe(202);
    expect(res.body.data.smsId).toBeGreaterThan(0);
    expect(res.body.data.message).toContain('ZREM1');
  });
});

describe('Tenant reminders — EMAIL channel', () => {
  it('queues a PENDING statement email and audits it', async () => {
    const before = await countRows('email_notifications', tenantId);
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'OVERDUE', channel: 'EMAIL' });

    expect(res.status).toBe(202);
    expect(res.body.data.emailId).toBeGreaterThan(0);
    expect(res.body.data.smsId).toBeNull();
    expect(res.body.data.whatsappUrl).toBeNull();

    const { rows } = await pool.query(
      `SELECT tenant_id, email_address, subject, body_html, body_text, status
       FROM email_notifications WHERE id = $1`,
      [res.body.data.emailId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(tenantId);
    expect(rows[0].email_address).toBe('reminder.fixture@rpms.test');
    expect(rows[0].subject.length).toBeGreaterThan(0);
    expect(rows[0].body_html.length).toBeGreaterThan(0);
    expect(rows[0].body_text.length).toBeGreaterThan(0);
    expect(rows[0].status).toBe('PENDING');
    expect(await countRows('email_notifications', tenantId)).toBe(before + 1);

    const audit = await auditRow('REMINDER_EMAIL_QUEUED', tenantId);
    expect(audit).toBeDefined();
    expect(Number(audit.new_value.emailId)).toBe(Number(res.body.data.emailId));
  });

  it('queues no SMS row when the EMAIL channel is used', async () => {
    const before = await countRows('sms_notifications', tenantId);
    await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'BALANCE_DUE', channel: 'EMAIL' });
    expect(await countRows('sms_notifications', tenantId)).toBe(before);
  });
});

describe('Tenant reminders — WHATSAPP channel', () => {
  it('composes a click-to-chat link and queues nothing', async () => {
    const smsBefore = await countRows('sms_notifications', tenantId);
    const emailBefore = await countRows('email_notifications', tenantId);
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'OVERDUE', channel: 'WHATSAPP' });

    expect(res.status).toBe(202);
    expect(res.body.data.whatsappUrl).toMatch(/^https:\/\/wa\.me\/254700000001\?text=/);
    expect(res.body.data.smsId).toBeNull();
    expect(res.body.data.emailId).toBeNull();
    expect(decodeURIComponent(res.body.data.whatsappUrl)).toContain('ZREM1');

    expect(await countRows('sms_notifications', tenantId)).toBe(smsBefore);
    expect(await countRows('email_notifications', tenantId)).toBe(emailBefore);

    const audit = await auditRow('REMINDER_WHATSAPP_COMPOSED', tenantId);
    expect(audit).toBeDefined();
    expect(audit.new_value.kind).toBe('OVERDUE');
  });
});

describe('Tenant reminders — no contact point, unknown tenant, validation', () => {
  it('409s a tenant with no phone on the SMS channel', async () => {
    const res = await request(app)
      .post(`/api/tenants/${noContactTenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'BALANCE_DUE', channel: 'SMS' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TENANT_NO_CONTACT');
    expect(await countRows('sms_notifications', noContactTenantId)).toBe(0);
  });

  it('409s a tenant with no email on the EMAIL channel, naming the gap', async () => {
    const res = await request(app)
      .post(`/api/tenants/${noContactTenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'BALANCE_DUE', channel: 'EMAIL' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TENANT_NO_CONTACT');
    expect(res.body.message).toContain('email');
    expect(await countRows('email_notifications', noContactTenantId)).toBe(0);
  });

  it('409s a tenant with no phone on the WHATSAPP channel', async () => {
    const res = await request(app)
      .post(`/api/tenants/${noContactTenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'BALANCE_DUE', channel: 'WHATSAPP' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TENANT_NO_CONTACT');
  });

  it('404s an unknown tenant', async () => {
    const res = await request(app)
      .post(`/api/tenants/99999999/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'BALANCE_DUE', channel: 'SMS' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('400s a malformed body before touching tenant data', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ channel: 'SMS' }); // kind is required
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
  });
});
