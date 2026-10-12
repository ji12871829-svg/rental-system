// Round-2 legacy parity — penalty engine, document vault, vacancy listings.
//
// Covers the interfaces end-to-end over HTTP:
//   * /api/penalties           — rules CRUD, dry-run preview, idempotent apply
//                                (negative rent ledger rows), the log
//   * /api/documents           — upload (base64→bytea), list without blobs,
//                                download with the original filename, delete
//   * /api/vacancies           — staff CRUD + publish toggle
//   * /api/public/vacancies    — published-only board, view + inquiry counters
//
// Hermetic: rows carry an R2TEST marker; audit rows are cleaned too.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

const MARKER = 'R2TEST';

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

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM penalty_log WHERE description LIKE $1`, [`%${MARKER}%`]);
  await pool.query(`DELETE FROM rent_payments WHERE notes LIKE $1`, [`%${MARKER}%`]);
  await pool.query(`DELETE FROM penalty_rules WHERE name LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM documents WHERE title LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM vacancy_listings WHERE title LIKE $1`, [`${MARKER}%`]);
  await pool.query(
    `DELETE FROM audit_logs WHERE entity IN ('penalty_rules', 'documents', 'vacancy_listings')
     AND (new_value::text LIKE $1 OR old_value::text LIKE $1)`,
    [`%${MARKER}%`]
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

describe('Penalty engine', () => {
  let ruleId = 0;
  let tenantId = 0;

  beforeAll(async () => {
    // An ACTIVE tenant with a unit and an unpaid month (no payments at all).
    const t = await pool.query<{ id: number }>(
      `SELECT id FROM tenants WHERE status = 'ACTIVE' AND unit_id IS NOT NULL ORDER BY id LIMIT 1`
    );
    tenantId = t.rows[0].id;
    // Ensure the tenant has no payments for the reporting year's current month,
    // so the preview/apply match is deterministic.
    await pool.query('DELETE FROM rent_payments WHERE tenant_id = $1', [tenantId]);
  });

  it('staff can read rules and log but not write', async () => {
    const read = await request(app).get('/api/penalties/rules').set(auth(staffToken));
    expect(read.status).toBe(200);

    const denied = await request(app).post('/api/penalties/rules').set(auth(staffToken)).send({ name: 'x', ruleType: 'FIXED', amount: 10 });
    expect(denied.status).toBe(403);
  });

  it('creates a FIXED rule with validation', async () => {
    const bad = await request(app).post('/api/penalties/rules').set(auth(adminToken)).send({ name: `${MARKER} fixed`, ruleType: 'FIXED' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/positive amount/i);

    const res = await request(app).post('/api/penalties/rules').set(auth(adminToken)).send({
      name: `${MARKER} 500 flat`,
      ruleType: 'FIXED',
      amount: 500,
      graceDays: 0,
      maxPenalty: 1000,
    });
    expect(res.status).toBe(201);
    ruleId = res.body.data.id;
  });

  it('preview lists the unpaid tenant with the rule fee', async () => {
    const res = await request(app).get(`/api/penalties/rules/${ruleId}/preview`).set(auth(managerToken));
    expect(res.status).toBe(200);
    const mine = res.body.data.find((r: { tenantId: number }) => r.tenantId === tenantId);
    expect(mine).toBeTruthy();
    expect(Number(mine.penalty)).toBe(500); // capped at 1000, fixed 500
  });

  it('apply charges once; re-apply skips instead of double-charging', async () => {
    const first = await request(app).post(`/api/penalties/rules/${ruleId}/apply`).set(auth(managerToken)).send({});
    expect(first.status).toBe(200);
    expect(first.body.data.applied).toBeGreaterThanOrEqual(1);
    expect(first.body.data.totalCharged).toBeGreaterThanOrEqual(500);

    // The ledger now carries the negative row for the overdue month.
    const ledger = await pool.query(
      `SELECT billing_month, billing_year, amount FROM rent_payments WHERE tenant_id = $1 AND amount < 0`,
      [tenantId]
    );
    expect(ledger.rows.length).toBeGreaterThanOrEqual(1);
    expect(Number(ledger.rows[0].amount)).toBe(-500);

    const second = await request(app).post(`/api/penalties/rules/${ruleId}/apply`).set(auth(managerToken)).send({});
    expect(second.status).toBe(200);
    expect(second.body.data.applied).toBe(0);
    expect(second.body.data.skippedAlreadyCharged).toBeGreaterThanOrEqual(1);
  });

  it('the log records rule, tenant, period and amount', async () => {
    const res = await request(app).get('/api/penalties/log?limit=50').set(auth(staffToken));
    expect(res.status).toBe(200);
    const mine = res.body.data.find((l: { tenant_id: number; amount: string }) => l.tenant_id === tenantId && Number(l.amount) === 500);
    expect(mine).toBeTruthy();
    expect(mine.rule_name).toBe(`${MARKER} 500 flat`);
  });

  it('updates and deletes rules', async () => {
    const updated = await request(app).put(`/api/penalties/rules/${ruleId}`).set(auth(adminToken)).send({ active: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.active).toBe(false);

    // Inactive rules refuse to apply.
    const applyInactive = await request(app).post(`/api/penalties/rules/${ruleId}/apply`).set(auth(managerToken)).send({});
    expect(applyInactive.status).toBe(400);
    expect(applyInactive.body.message).toMatch(/inactive/i);

    const del = await request(app).delete(`/api/penalties/rules/${ruleId}`).set(auth(adminToken));
    expect(del.status).toBe(204);
  });
});

describe('Document vault', () => {
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let docId = 0;

  it('uploads a document linked to a tenant', async () => {
    const t = await pool.query<{ id: number }>('SELECT id FROM tenants ORDER BY id LIMIT 1');
    const res = await request(app).post('/api/documents').set(auth(staffToken)).send({
      title: `${MARKER} signed lease`,
      docType: 'LEASE_AGREEMENT',
      tenantId: t.rows[0].id,
      fileName: 'lease.png',
      mimeType: 'image/png',
      contentBase64: PNG_BASE64,
    });
    expect(res.status).toBe(201);
    docId = res.body.data.id;
  });

  it('refuses documents without a tenant or unit link', async () => {
    const res = await request(app).post('/api/documents').set(auth(staffToken)).send({
      title: `${MARKER} floating`,
      docType: 'OTHER',
      fileName: 'x.txt',
      mimeType: 'text/plain',
      contentBase64: PNG_BASE64,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tenant or a unit/i);
  });

  it('lists without the blob and reports size', async () => {
    const res = await request(app).get(`/api/documents?q=${encodeURIComponent(MARKER)}`).set(auth(staffToken));
    expect(res.status).toBe(200);
    const mine = res.body.data.find((d: { id: number }) => d.id === docId);
    expect(mine).toBeTruthy();
    expect(mine.file_size).toBeGreaterThan(0);
    expect(mine).not.toHaveProperty('file_data');
  });

  it('downloads with the stored filename and mime type', async () => {
    const res = await request(app).get(`/api/documents/${docId}/download`).set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['content-disposition']).toContain('lease.png');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('deletes (manager only) and then 404s', async () => {
    const staffDenied = await request(app).delete(`/api/documents/${docId}`).set(auth(staffToken));
    expect(staffDenied.status).toBe(403);

    const res = await request(app).delete(`/api/documents/${docId}`).set(auth(managerToken));
    expect(res.status).toBe(204);
    const again = await request(app).get(`/api/documents/${docId}/download`).set(auth(staffToken));
    expect(again.status).toBe(404);
  });
});

describe('Vacancy listings', () => {
  let listingId = 0;

  it('manager creates and publishes a listing for a vacant unit', async () => {
    const u = await pool.query<{ id: number; monthly_rent: string }>(
      `SELECT id, monthly_rent FROM units WHERE occupancy_status = 'VACANT' ORDER BY id LIMIT 1`
    );
    expect(u.rows.length).toBeGreaterThan(0);
    const res = await request(app).post('/api/vacancies').set(auth(managerToken)).send({
      unitId: u.rows[0].id,
      title: `${MARKER} bright bedsitter`,
      rentAmount: Number(u.rows[0].monthly_rent),
      amenities: ['Water included', 'CCTV'],
      isPublished: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.is_published).toBe(true);
    listingId = res.body.data.id;
  });

  it('staff cannot create or delete listings but can read', async () => {
    const read = await request(app).get('/api/vacancies').set(auth(staffToken));
    expect(read.status).toBe(200);

    const denied = await request(app).post('/api/vacancies').set(auth(staffToken)).send({
      unitId: 1, title: `${MARKER} nope`, rentAmount: 1,
    });
    expect(denied.status).toBe(403);
  });

  it('the public board lists only published listings with marketing fields', async () => {
    const res = await request(app).get('/api/public/vacancies');
    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBeTruthy();
    const mine = res.body.data.listings.find((l: { id: number }) => l.id === listingId);
    expect(mine).toBeTruthy();
    expect(mine.rentAmount).toBeGreaterThan(0);
    expect(mine.photos).toEqual([]);
    // No internal identity leaks on the public surface.
    expect(JSON.stringify(mine)).not.toContain('tenant');
  });

  it('unpublishing removes the listing from the public board', async () => {
    await request(app).put(`/api/vacancies/${listingId}`).set(auth(managerToken)).send({ isPublished: false });
    const res = await request(app).get('/api/public/vacancies');
    expect(res.body.data.listings.some((l: { id: number }) => l.id === listingId)).toBe(false);
    await request(app).put(`/api/vacancies/${listingId}`).set(auth(managerToken)).send({ isPublished: true });
  });

  it('view and inquiry counters tick; inquiries are audited', async () => {
    await request(app).post(`/api/public/vacancies/${listingId}/view`);
    const inquiry = await request(app).post(`/api/public/vacancies/${listingId}/inquiries`).set('Content-Type', 'application/json').send({
      name: 'Jane Prospect',
      contact: '+254700999888',
      message: 'Moving in next month',
    });
    expect(inquiry.status).toBe(201);

    const row = await pool.query<{ views: number; inquiries: number }>(
      'SELECT views, inquiries FROM vacancy_listings WHERE id = $1',
      [listingId]
    );
    expect(row.rows[0].views).toBeGreaterThanOrEqual(1);
    expect(row.rows[0].inquiries).toBeGreaterThanOrEqual(1);

    const audit = await pool.query(
      `SELECT 1 FROM audit_logs WHERE entity = 'vacancy_listings' AND action = 'VACANCY_INQUIRY' AND entity_id = $1`,
      [listingId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid inquiry payloads and unknown listings', async () => {
    const bad = await request(app).post(`/api/public/vacancies/${listingId}/inquiries`).send({ name: 'x', contact: 'y' });
    expect(bad.status).toBe(400);

    const unknown = await request(app).post('/api/public/vacancies/999999/inquiries').send({ name: 'Jane Prospect', contact: '+254700999888' });
    expect(unknown.status).toBe(404);
  });

  it('deleting the listing also removes it from the board', async () => {
    const res = await request(app).delete(`/api/vacancies/${listingId}`).set(auth(adminToken));
    expect(res.status).toBe(204);
    const board = await request(app).get('/api/public/vacancies');
    expect(board.body.data.listings.some((l: { id: number }) => l.id === listingId)).toBe(false);
  });
});
