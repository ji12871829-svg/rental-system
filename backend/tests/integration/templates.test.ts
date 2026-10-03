// Message Templates routes — the /api/templates router.
//
// Covers the whole interface through HTTP, the way the frontend calls it:
//   * auth        — every route 401s without a session (router.use(requireAuth))
//   * roles       — STAFF may read but not write; MANAGER/ADMIN write
//                   (managerOrAdmin guards PUT and DELETE)
//   * validation  — body required (1..4000), subject optional ≤200; unknown
//                   kind → 404 before the DB is touched
//   * upsert      — PUT stores/updates the customized row, marks is_custom,
//                   and the next GET reflects the customization
//   * revert      — DELETE removes the row (reverted: true/false) and the
//                   hardcoded default takes over again
//   * audit       — MESSAGE_TEMPLATE_UPDATED / MESSAGE_TEMPLATE_RESET rows
//
// The suite is hermetic: it targets two kinds no other suite touches
// (SMS_OVERDUE, EMAIL_CAMPAIGN), and beforeEach/afterAll delete any rows it
// may have created so the live DB starts and ends with zero customized
// templates. Audit rows created here are removed too.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

// Kinds this suite owns — cleanup only ever touches these.
const KINDS_USED = ['SMS_OVERDUE', 'EMAIL_CAMPAIGN'];

let adminToken = '';
let managerToken = '';
let staffToken = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Remove this suite's template rows + audit rows (FK-safe, idempotent). */
async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM message_templates WHERE kind = ANY($1::text[])`, [KINDS_USED]);
  await pool.query(
    `DELETE FROM audit_logs WHERE entity = 'message_templates'
     AND new_value->>'kind' = ANY($1::text[])`,
    [KINDS_USED],
  );
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  managerToken = await login('manager@rpms.local', 'Manager@2026!');
  staffToken = await login('staff@rpms.local', 'Staff@2026!');
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('Message Templates auth', () => {
  it('401s every route without a session', async () => {
    const reads = await Promise.all([
      request(app).get('/api/templates'),
      request(app).get('/api/templates/SMS_OVERDUE'),
    ]);
    for (const res of reads) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    }
    const writes = await Promise.all([
      request(app).put('/api/templates/SMS_OVERDUE').send({ body: 'x' }),
      request(app).delete('/api/templates/SMS_OVERDUE'),
    ]);
    for (const res of writes) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    }
  });

  it('rejects a malformed bearer token', async () => {
    const res = await request(app).get('/api/templates').set({ Authorization: 'Bearer not-a-jwt' });
    expect(res.status).toBe(401);
  });
});

describe('Message Templates role gating', () => {
  it('staff can read the list', async () => {
    const res = await request(app).get('/api/templates').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('staff cannot save a template', async () => {
    const res = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(staffToken))
      .send({ body: 'staff should not write' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
    const { rowCount } = await pool.query(`SELECT 1 FROM message_templates WHERE kind = 'SMS_OVERDUE'`);
    expect(rowCount).toBe(0);
  });

  it('staff cannot revert a template', async () => {
    const res = await request(app).delete('/api/templates/SMS_OVERDUE').set(auth(staffToken));
    expect(res.status).toBe(403);
  });

  it('manager can save and revert', async () => {
    const saved = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(managerToken))
      .send({ body: 'Manager-authored overdue notice for {{name}} ({{unit}}).' });
    expect(saved.status).toBe(201);
    expect(saved.body.data.is_custom).toBe(true);

    const reverted = await request(app).delete('/api/templates/SMS_OVERDUE').set(auth(managerToken));
    expect(reverted.status).toBe(200);
    expect(reverted.body.data.reverted).toBe(true);
  });
});

describe('Message Templates validation', () => {
  it('rejects an empty body with a field-level message', async () => {
    const res = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(adminToken))
      .send({ body: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.body.details)).toContain('Template body is required');
  });

  it('rejects a body over 4000 characters', async () => {
    const res = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(adminToken))
      .send({ body: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
  });

  it('accepts a body at the 4000-character limit', async () => {
    const res = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(adminToken))
      .send({ body: 'x'.repeat(4000) });
    expect(res.status).toBe(201);
  });

  it('rejects a subject over 200 characters', async () => {
    const res = await request(app)
      .put('/api/templates/EMAIL_CAMPAIGN')
      .set(auth(adminToken))
      .send({ subject: 's'.repeat(201), body: 'valid body' });
    expect(res.status).toBe(400);
  });

  it('404s an unknown kind before any write', async () => {
    const res = await request(app)
      .put('/api/templates/NO_SUCH_KIND')
      .set(auth(adminToken))
      .send({ body: 'valid body' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(res.body.message).toContain('Unknown template kind');
  });

  it('404s an unknown kind on read', async () => {
    const res = await request(app).get('/api/templates/NO_SUCH_KIND').set(auth(adminToken));
    expect(res.status).toBe(404);
  });
});

describe('Message Templates upsert + revert lifecycle', () => {
  it('PUT then GET reflects the customization; DELETE restores the default', async () => {
    const save = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(adminToken))
      .send({ body: 'Final notice for {{name}}: unit {{unit}} owes {{currency}} {{amount_due}}.' });
    expect(save.status).toBe(201);
    expect(save.body.data.kind).toBe('SMS_OVERDUE');
    expect(save.body.data.is_custom).toBe(true);

    const one = await request(app).get('/api/templates/SMS_OVERDUE').set(auth(adminToken));
    expect(one.status).toBe(200);
    expect(one.body.data.customized).toBe(true);
    expect(one.body.data.body).toBe('Final notice for {{name}}: unit {{unit}} owes {{currency}} {{amount_due}}.');
    expect(one.body.data.defaultBody).not.toBe(one.body.data.body);
    expect(one.body.data.fields).toEqual(expect.arrayContaining(['name', 'unit', 'amount_due']));

    // List shows the same customization alongside the untouched defaults.
    const list = await request(app).get('/api/templates').set(auth(staffToken));
    expect(list.status).toBe(200);
    const kinds = list.body.data.map((t: { kind: string }) => t.kind);
    expect(kinds).toEqual(expect.arrayContaining(KINDS_USED));
    expect(kinds).toContain('EMAIL_CAMPAIGN');
    const inList = list.body.data.find((t: { kind: string }) => t.kind === 'SMS_OVERDUE');
    expect(inList.customized).toBe(true);
    const untouched = list.body.data.find((t: { kind: string }) => t.kind === 'EMAIL_CAMPAIGN');
    expect(untouched.customized).toBe(false);

    const revert = await request(app).delete('/api/templates/SMS_OVERDUE').set(auth(adminToken));
    expect(revert.status).toBe(200);
    expect(revert.body.data.reverted).toBe(true);

    const after = await request(app).get('/api/templates/SMS_OVERDUE').set(auth(adminToken));
    expect(after.status).toBe(200);
    expect(after.body.data.customized).toBe(false);
    expect(after.body.data.body).toBe(after.body.data.defaultBody);
  });

  it('PUT the same kind twice updates one row, not two', async () => {
    const first = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(adminToken))
      .send({ body: 'first version' });
    expect(first.status).toBe(201);
    const second = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(adminToken))
      .send({ body: 'second version' });
    expect(second.status).toBe(201);
    expect(Number(second.body.data.id)).toBe(Number(first.body.data.id));
    expect(second.body.data.body).toBe('second version');
  });

  it('revert of an already-default template reports reverted: false', async () => {
    await cleanup();
    const res = await request(app).delete('/api/templates/EMAIL_CAMPAIGN').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.reverted).toBe(false);
  });

  it('EMAIL_CAMPAIGN keeps its optional subject; SMS kinds keep subject null', async () => {
    const emailSave = await request(app)
      .put('/api/templates/EMAIL_CAMPAIGN')
      .set(auth(adminToken))
      .send({ subject: 'A note from {{business}}', body: 'Hello {{name}} at {{unit}}.' });
    expect(emailSave.status).toBe(201);
    expect(emailSave.body.data.subject).toBe('A note from {{business}}');

    const smsSave = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(adminToken))
      .send({ subject: 'should be ignored for SMS', body: 'SMS body only.' });
    expect(smsSave.status).toBe(201);
    expect(smsSave.body.data.subject).toBeNull();
  });
});

describe('Message Templates audit trail', () => {
  it('logs MESSAGE_TEMPLATE_UPDATED on save and MESSAGE_TEMPLATE_RESET on revert', async () => {
    const save = await request(app)
      .put('/api/templates/SMS_OVERDUE')
      .set(auth(adminToken))
      .send({ body: 'audited overdue text' });
    expect(save.status).toBe(201);
    const savedId = Number(save.body.data.id);

    const updated = await pool.query(
      `SELECT user_id FROM audit_logs WHERE action = 'MESSAGE_TEMPLATE_UPDATED' AND entity = 'message_templates' AND (new_value->>'kind') = 'SMS_OVERDUE' ORDER BY id DESC LIMIT 1`,
    );
    expect(updated.rowCount).toBe(1);
    expect(Number(updated.rows[0].user_id)).toBeGreaterThan(0);

    await request(app).delete('/api/templates/SMS_OVERDUE').set(auth(adminToken));
    const reset = await pool.query(
      `SELECT user_id FROM audit_logs WHERE action = 'MESSAGE_TEMPLATE_RESET' AND entity = 'message_templates' AND (new_value->>'kind') = 'SMS_OVERDUE' ORDER BY id DESC LIMIT 1`,
    );
    expect(reset.rowCount).toBe(1);
    expect(savedId).toBeGreaterThan(0);
  });
});
