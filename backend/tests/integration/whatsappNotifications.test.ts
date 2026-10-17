// Direct WhatsApp Cloud API delivery — the reminder route's WHATSAPP channel
// in both modes, plus the /api/whatsapp history endpoints.
//
//   * compose (no deliver)          — 202 with a wa.me URL, nothing queued,
//     any provider state (this is also the route's fallback when the Meta
//     API is not connected)
//   * FINAL_NOTICE editing          — WhatsApp allowed for the escalation
//     letter, email still refused (formal legal warnings never email)
//   * deliver without credentials   — 400 up front, no row ever exists
//   * deliver through a mocked Meta — the row's full outcome comes back in
//     the response: SENT (wamid stored, audit written), FAILED (24-hour
//     window 131047 → retryable with a backoff deadline), ERRONEOUS (number
//     not on WhatsApp, no deadline)
//   * manual re-send                — POST /api/whatsapp/:id/send replays a
//     FAILED row to SENT
//   * template mode                 — with WHATSAPP_TEMPLATE_* set, sends are
//     Meta template messages (no 24-hour window): the payload's parameter
//     order matches the registration, the parameters persist on the row and
//     replays re-send them verbatim, and a template refusal (132xxx) is
//     ERRONEOUS
//   * no-phone tenant               — 409 TENANT_NO_CONTACT, nothing written
//
// Hermetic: fixtures mirror reminderChannels.test.ts, Meta calls are faked
// by spying global fetch, and credentials are injected per-describe through
// the call-time env reads in whatsappProvider.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

let adminToken = '';
let unitId: number;
let tenantId: number;
let noPhoneTenantId: number;

const AUDIT_ACTIONS = ['WHATSAPP_MESSAGE_QUEUED', 'REMINDER_WHATSAPP_COMPOSED'];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const REAL_FETCH = (globalThis as { fetch?: typeof fetch }).fetch;

// Restore precisely: restore the real fetch when the sandbox had one, delete
// the slot when it did not — later suites share this process.
function restoreFetch(): void {
  if (REAL_FETCH) {
    (globalThis as { fetch: typeof fetch }).fetch = REAL_FETCH;
  } else {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
}

function stubMeta(metaResponse: () => Response): void {
  // Direct global assignment (not spyOn): the sandbox global may not carry
  // `fetch` after a previous restore, and the send path resolves its
  // transport at call time from the same slot.
  (globalThis as { fetch: typeof fetch }).fetch = (async () => metaResponse()) as unknown as typeof fetch;
}

afterEach(restoreFetch);

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function whatsappRowsFor(tenant: number) {
  const { rows } = await pool.query(
    `SELECT * FROM whatsapp_notifications WHERE tenant_id = $1 ORDER BY id`,
    [tenant],
  );
  return rows;
}

async function cleanup(): Promise<void> {
  const ids = [tenantId, noPhoneTenantId].filter((id) => typeof id === 'number');
  await pool.query(
    `DELETE FROM audit_logs WHERE entity = 'tenant' AND entity_id = ANY($1::int[]) AND action = ANY($2::text[])`,
    [ids, AUDIT_ACTIONS],
  );
  // Notification rows cascade with the tenants.
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1::int[])`, [ids]);
  if (unitId) await pool.query(`DELETE FROM units WHERE id = $1`, [unitId]);
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_TEMPLATE_REMINDER;
  delete process.env.WHATSAPP_TEMPLATE_FINAL_NOTICE;
  delete process.env.WHATSAPP_TEMPLATE_LANG;
}

/** Removes fixture rows a crashed earlier run may have left behind. */
async function removeStaleFixtures(): Promise<void> {
  await pool.query(`DELETE FROM tenants WHERE full_name IN ('WhatsApp Fixture Tenant', 'WhatsApp No-Phone Tenant')`);
  await pool.query(`DELETE FROM units WHERE unit_number = 'ZWHA1'`);
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  await removeStaleFixtures();

  const unit = await pool.query(
    `INSERT INTO units (property_id, floor_id, unit_number, unit_type, monthly_rent, occupancy_status)
     SELECT p.id, f.id, 'ZWHA1', 'Room', 5000, 'OCCUPIED'
     FROM properties p JOIN floors f ON f.property_id = p.id
     ORDER BY p.id, f.id LIMIT 1
     RETURNING id`,
  );
  expect(unit.rows).toHaveLength(1);
  unitId = unit.rows[0].id as number;

  const tenant = await pool.query(
    `INSERT INTO tenants (unit_id, full_name, phone_number, email, move_in_date, status)
     VALUES ($1, 'WhatsApp Fixture Tenant', '254700000001', NULL, DATE '2026-01-01', 'ACTIVE')
     RETURNING id`,
    [unitId],
  );
  tenantId = tenant.rows[0].id as number;

  const bare = await pool.query(
    `INSERT INTO tenants (full_name, phone_number, email, move_in_date, status)
     VALUES ('WhatsApp No-Phone Tenant', NULL, NULL, DATE '2026-01-01', 'ACTIVE')
     RETURNING id`,
  );
  noPhoneTenantId = bare.rows[0].id as number;
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('WHATSAPP compose — click-to-chat (any provider state)', () => {
  beforeAll(() => {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  it('returns a wa.me URL and queues nothing', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'OVERDUE', channel: 'WHATSAPP' });
    expect(res.status).toBe(202);
    expect(res.body.data.whatsappUrl).toContain('https://wa.me/254700000001?text=');
    expect(res.body.data.whatsappId).toBeNull();
    expect(res.body.data.whatsappLive).toBe(false);
    expect(await whatsappRowsFor(tenantId)).toHaveLength(0);
  });

  it('composes the Final Notice for WhatsApp when a deliver flag is untouched', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'FINAL_NOTICE', channel: 'WHATSAPP' });
    expect(res.status).toBe(202);
    expect(res.body.data.whatsappUrl).toContain('https://wa.me/');
    expect(res.body.data.message).toMatch(/FINAL NOTICE/i);
    expect(await whatsappRowsFor(tenantId)).toHaveLength(0);
  });

  it('refuses Final Notice by email', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'FINAL_NOTICE', channel: 'EMAIL' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
  });

  it('409s for a tenant without a phone — nothing queued', async () => {
    const res = await request(app)
      .post(`/api/tenants/${noPhoneTenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'OVERDUE', channel: 'WHATSAPP' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TENANT_NO_CONTACT');
  });
});

describe('WHATSAPP deliver — Meta Cloud API behind the button press', () => {
  beforeAll(() => {
    process.env.WHATSAPP_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
  });

  it('refuses up front with no credentials — no row ever exists', async () => {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    try {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/sms-reminder`)
        .set(auth(adminToken))
        .send({ kind: 'OVERDUE', channel: 'WHATSAPP', deliver: true });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('WHATSAPP_TOKEN');
      expect(await whatsappRowsFor(tenantId)).toHaveLength(0);
    } finally {
      process.env.WHATSAPP_TOKEN = token;
      process.env.WHATSAPP_PHONE_NUMBER_ID = phoneId;
    }
  });

  it('sends directly and reports the real outcome — SENT with the wamid stored', async () => {
    stubMeta(() => jsonResponse(200, {
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.HBgLFixture', message_status: 'accepted' }],
    }));
    try {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/sms-reminder`)
        .set(auth(adminToken))
        .send({ kind: 'OVERDUE', channel: 'WHATSAPP', deliver: true });
      expect(res.status).toBe(202);
      expect(res.body.data.whatsappId).toBeGreaterThan(0);
      expect(res.body.data.whatsappStatus).toBe('SENT');
      expect(res.body.data.whatsappFailure).toBeNull();
      expect(res.body.data.whatsappUrl).toContain('https://wa.me/'); // manual fallback stays attached

      const rows = await whatsappRowsFor(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('SENT');
      expect(rows[0].provider_message_id).toBe('wamid.HBgLFixture');
      expect(rows[0].attempt_count).toBe(1);
      expect(rows[0].sent_at).not.toBeNull();

      const audit = await pool.query(
        `SELECT new_value FROM audit_logs WHERE action = 'WHATSAPP_MESSAGE_QUEUED' AND entity = 'tenant' AND entity_id = $1`,
        [tenantId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(Number(audit.rows[0].new_value.whatsappId)).toBe(rows[0].id);
    } finally {
      restoreFetch();
    }
  });

  it('lands a closed 24-hour window (131047) as FAILED with a retry deadline', async () => {
    stubMeta(() => jsonResponse(400, {
      error: {
        message: 'Re-engagement message',
        code: 131047,
        error_data: { details: 'More than 24 hours have passed since the customer last replied' },
      },
    }));
    try {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/sms-reminder`)
        .set(auth(adminToken))
        .send({ kind: 'OVERDUE', channel: 'WHATSAPP', deliver: true });
      expect(res.status).toBe(202);
      expect(res.body.data.whatsappStatus).toBe('FAILED');
      expect(res.body.data.whatsappFailure).toContain('24-hour');
      // The manual fallback ride-along is what saves a closed window in the
      // operator's hands right now.
      expect(res.body.data.whatsappUrl).toContain('https://wa.me/');

      const rows = await whatsappRowsFor(tenantId);
      const failed = rows[rows.length - 1];
      expect(failed.status).toBe('FAILED');
      expect(failed.failure_reason).toContain('24-hour');
      expect(failed.next_retry_at).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it('lands a refused number (131026) as ERRONEOUS without a deadline', async () => {
    stubMeta(() => jsonResponse(404, {
      error: { message: 'Recipient phone number not in whatsapp', code: 131026 },
    }));
    try {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/sms-reminder`)
        .set(auth(adminToken))
        .send({ kind: 'OVERDUE', channel: 'WHATSAPP', deliver: true });
      expect(res.body.data.whatsappStatus).toBe('ERRONEOUS');
      expect(res.body.data.whatsappFailure).toContain('does not use WhatsApp');

      const rows = await whatsappRowsFor(tenantId);
      const terminal = rows[rows.length - 1];
      expect(terminal.status).toBe('ERRONEOUS');
      expect(terminal.next_retry_at).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it('re-sends a FAILED row from the history endpoint and reaches SENT', async () => {
    // A failed row exists from the window test; find its id fresh (kept
    // unordered on purpose — the row is whatever the earlier test left).
    const failed = await pool.query(
      `SELECT id FROM whatsapp_notifications WHERE tenant_id = $1 AND status = 'FAILED' ORDER BY id DESC LIMIT 1`,
      [tenantId],
    );
    expect(failed.rows).toHaveLength(1);
    const rowId = failed.rows[0].id as number;

    stubMeta(() => jsonResponse(200, {
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.HBgLRetry', message_status: 'accepted' }],
    }));
    try {
      const res = await request(app)
        .post(`/api/whatsapp/${rowId}/send`)
        .set(auth(adminToken))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SENT');
      expect(res.body.data.provider_message_id).toBe('wamid.HBgLRetry');
      expect(res.body.data.attempt_count).toBe(2);
    } finally {
      restoreFetch();
    }
  });

  it('lists the delivery history for the page', async () => {
    const res = await request(app)
      .get(`/api/whatsapp/history?tenantId=${tenantId}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('tenant_name', 'WhatsApp Fixture Tenant');

    const config = await request(app).get('/api/whatsapp/config').set(auth(adminToken));
    expect(config.status).toBe(200);
    expect(config.body.data.provider).toBe('cloud');
    expect(config.body.data.live).toBe(true);
  });
});

// Template mode — when the operator registers an approved template
// (WHATSAPP_TEMPLATE_*), sends of that kind go out as Meta template messages:
// no 24-hour window, and the parameters persist on the row so a retry sweep
// replays exactly the figures the operator approved.
describe('WHATSAPP template mode — approved Meta templates', () => {
  const REMINDER_TEMPLATE = 'rent_reminder_fixture';
  const NOTICE_TEMPLATE = 'final_notice_fixture';

  beforeAll(() => {
    process.env.WHATSAPP_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
    process.env.WHATSAPP_TEMPLATE_REMINDER = REMINDER_TEMPLATE;
    process.env.WHATSAPP_TEMPLATE_FINAL_NOTICE = NOTICE_TEMPLATE;
    process.env.WHATSAPP_TEMPLATE_LANG = 'en';
  });

  it('reports the template in the config endpoint', async () => {
    const config = await request(app).get('/api/whatsapp/config').set(auth(adminToken));
    expect(config.status).toBe(200);
    expect(config.body.data.templates.reminder).toBe(REMINDER_TEMPLATE);
    expect(config.body.data.templates.finalNotice).toBe(NOTICE_TEMPLATE);
    expect(config.body.data.templates.language).toBe('en');
  });

  it('composes with the template name attached and queues nothing', async () => {
    // Rows from the direct-delivery describe are still (legitimately) in the
    // table — the proof a compose queues nothing is that the row count does
    // not move.
    const before = await whatsappRowsFor(tenantId);
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/sms-reminder`)
      .set(auth(adminToken))
      .send({ kind: 'OVERDUE', channel: 'WHATSAPP' });
    expect(res.status).toBe(202);
    expect(res.body.data.whatsappTemplate).toBe(REMINDER_TEMPLATE);
    expect(res.body.data.whatsappId).toBeNull();
    expect(await whatsappRowsFor(tenantId)).toHaveLength(before.length);
  });

  function expectTemplatePayload(raw: string, templateName: string): {
    to: string;
    template: { name: string; language: { code: string }; components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> };
  } {
    const payload = JSON.parse(raw) as {
      type: string;
      to: string;
      text?: { body: string };
      template: { name: string; language: { code: string }; components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> };
    };
    expect(payload.type).toBe('template');
    expect(payload.to).toBe('254700000001');
    expect(payload.text).toBeUndefined(); // template sends carry no free-form body
    expect(payload.template.name).toBe(templateName);
    expect(payload.template.language.code).toBe('en');
    const [bodyComp] = payload.template.components;
    expect(bodyComp.type).toBe('body');
    expect(bodyComp.parameters).toHaveLength(6);
    // Canonical registration order {{1}}..{{6}}: name, unit, dues, deadline,
    // payment method, contact.
    const [p1, p2, p3, p4, p5, p6] = bodyComp.parameters.map((p) => p.text);
    expect(p1).toBe('WhatsApp Fixture Tenant');
    expect(p2).toBe('Unit ZWHA1');
    expect(p3).toMatch(/^Rent for .+: KSh \d+( \+ Water for .+: KSh \d+)? — total KSh \d+$/);
    expect(p4).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    expect(p5.length).toBeGreaterThan(0);
    expect(p6.length).toBeGreaterThan(0);
    return payload;
  }

  it('sends the template payload directly and persists the parameters on the row', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = (async (url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return jsonResponse(200, { messages: [{ id: 'wamid.HBgLTemplate' }] });
    }) as unknown as typeof fetch;
    try {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/sms-reminder`)
        .set(auth(adminToken))
        .send({ kind: 'OVERDUE', channel: 'WHATSAPP', deliver: true });
      expect(res.status).toBe(202);
      expect(res.body.data.whatsappStatus).toBe('SENT');
      expect(res.body.data.whatsappTemplate).toBe(REMINDER_TEMPLATE);
      expect(seen).toHaveLength(1);
      expectTemplatePayload(String(seen[0].init?.body), REMINDER_TEMPLATE);

      const rows = await whatsappRowsFor(tenantId);
      const row = rows[rows.length - 1];
      expect(row.status).toBe('SENT');
      expect(row.template_kind).toBe(REMINDER_TEMPLATE);
      expect(row.template_params).toHaveLength(6);
      // The row keeps the full free-form letter as the correspondence record;
      // the template name + parameters are what Meta actually received.
      expect(row.message).toContain('WhatsApp Fixture Tenant');
    } finally {
      restoreFetch();
    }
  });

  it('replays the SAME template parameters when a failed row is re-sent', async () => {
    // Queue + fail a template row (closed window), then re-send it through
    // the history endpoint — the retry must use the queued parameters, not
    // recompute from a ledger that may have moved on.
    stubMeta(() => jsonResponse(400, {
      error: { message: 'Re-engagement message', code: 131047, error_data: { details: 'window closed' } },
    }));
    let failedId: number;
    try {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/sms-reminder`)
        .set(auth(adminToken))
        .send({ kind: 'OVERDUE', channel: 'WHATSAPP', deliver: true });
      expect(res.body.data.whatsappStatus).toBe('FAILED');
      const rows = await whatsappRowsFor(tenantId);
      const failed = rows[rows.length - 1];
      failedId = failed.id as number;
      expect(failed.template_kind).toBe(REMINDER_TEMPLATE);
      expect(failed.template_params).toHaveLength(6);
    } finally {
      restoreFetch();
    }

    const seen: Array<{ url: string; init?: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = (async (url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return jsonResponse(200, { messages: [{ id: 'wamid.HBgLTemplateRetry' }] });
    }) as unknown as typeof fetch;
    try {
      const res = await request(app)
        .post(`/api/whatsapp/${failedId}/send`)
        .set(auth(adminToken))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SENT');
      expect(res.body.data.template_kind).toBe(REMINDER_TEMPLATE);
      expect(seen).toHaveLength(1);
      const payload = expectTemplatePayload(String(seen[0].init?.body), REMINDER_TEMPLATE);
      // Parameter values replay exactly — a sweep hours later must not send
      // different amounts than the operator approved.
      const queued = await pool.query(`SELECT template_params FROM whatsapp_notifications WHERE id = $1`, [failedId]);
      expect(payload.template.components[0].parameters.map((p) => p.text)).toEqual(queued.rows[0].template_params);
    } finally {
      restoreFetch();
    }
  });

  it('sends the Final Notice through its own registered template', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    (globalThis as { fetch: typeof fetch }).fetch = (async (url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return jsonResponse(200, { messages: [{ id: 'wamid.HBgLFinalNotice' }] });
    }) as unknown as typeof fetch;
    try {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/sms-reminder`)
        .set(auth(adminToken))
        .send({ kind: 'FINAL_NOTICE', channel: 'WHATSAPP', deliver: true });
      expect(res.status).toBe(202);
      expect(res.body.data.whatsappStatus).toBe('SENT');
      expect(res.body.data.whatsappTemplate).toBe(NOTICE_TEMPLATE);
      expect(seen).toHaveLength(1);
      expectTemplatePayload(String(seen[0].init?.body), NOTICE_TEMPLATE);
    } finally {
      restoreFetch();
    }
  });

  it('lands a template refusal (132000) as ERRONEOUS with registration copy', async () => {
    stubMeta(() => jsonResponse(400, {
      error: { message: 'Invalid parameter', code: 132000, error_data: { details: 'parameters size differ from template body' } },
    }));
    try {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/sms-reminder`)
        .set(auth(adminToken))
        .send({ kind: 'OVERDUE', channel: 'WHATSAPP', deliver: true });
      expect(res.body.data.whatsappStatus).toBe('ERRONEOUS');
      expect(res.body.data.whatsappFailure).toContain('template');
      expect(res.body.data.whatsappFailure).toContain('{{1}}..{{6}}');

      const rows = await whatsappRowsFor(tenantId);
      const terminal = rows[rows.length - 1];
      expect(terminal.status).toBe('ERRONEOUS');
      expect(terminal.next_retry_at).toBeNull();
      // Even the refused attempt keeps its template identity for the operator.
      expect(terminal.template_kind).toBe(REMINDER_TEMPLATE);
    } finally {
      restoreFetch();
    }
  });
});
