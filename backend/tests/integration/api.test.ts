import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';
import { runRetentionSweep } from '../../src/services/tenantRetentionJob';

const app = createApp();

let adminToken = '';
let staffToken = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Unit ids are NOT sequential with unit numbers (the seed join is unordered), so
// always resolve a unit's id from its number via the API.
async function unitIdFor(unitNumber: string): Promise<number> {
  const res = await request(app).get(`/api/units?q=${unitNumber}`).set(auth(staffToken));
  const unit = res.body.data.find((u: any) => u.unit_number === unitNumber);
  if (!unit) throw new Error(`unit ${unitNumber} not found`);
  return unit.id;
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  staffToken = await login('staff@rpms.local', 'Staff@2026!');
});

// Close the pool before globalTeardown drops the test DB, so no idle
// connections are terminated underneath us.
afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
// Security (spec §67)
// ---------------------------------------------------------------------------
describe('Security', () => {
  it('rejects unauthenticated API access', async () => {
    const res = await request(app).get('/api/units');
    expect(res.status).toBe(401);
  });

  it('rejects a bad password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@rpms.local', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('blocks STAFF from admin-only routes (audit logs)', async () => {
    const res = await request(app).get('/api/audit').set(auth(staffToken));
    expect(res.status).toBe(403);
  });

  it('allows ADMIN on admin-only routes', async () => {
    const res = await request(app).get('/api/audit').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('blocks STAFF from deleting payments', async () => {
    const res = await request(app).delete('/api/rent/payments/1').set(auth(staffToken));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Rent (spec §9–§10)
// ---------------------------------------------------------------------------
describe('Rent collection', () => {
  it('records a partial rent payment with PARTIAL status', async () => {
    const res = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 4, // Grace Njeri — unit 15, rent KSh 9,000
        paymentDate: '2026-06-05',
        billingMonth: 6,
        billingYear: 2026,
        amount: 5000,
        paymentMethod: 'M_PESA',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PARTIAL');
    expect(res.body.data.balance).toBe(4000);
    expect(res.body.data.receipt).toMatch(/^RC-2026-\d{4}$/);
  });

  it('supports multiple payments summing to a full payment → PAID', async () => {
    const res = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 4,
        paymentDate: '2026-06-20',
        billingMonth: 6,
        billingYear: 2026,
        amount: 4000,
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PAID');
    expect(res.body.data.totalPaidForMonth).toBe(9000);
    expect(res.body.data.balance).toBe(0);
  });

  it('leaves a PENDING receipt SMS for manual send (auto-send is test-disabled)', async () => {
    // In the test environment dispatchAutoSend opts out, so the notification
    // must be recorded and stay PENDING — the manual flow under test below.
    const res = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 5,
        paymentDate: '2026-07-02',
        billingMonth: 7,
        billingYear: 2026,
        amount: 3000,
        paymentMethod: 'M_PESA',
      });
    expect(res.status).toBe(201);
    const history = await request(app).get(`/api/sms/history?tenantId=5&status=PENDING`).set(auth(adminToken));
    expect(history.status).toBe(200);
    const row = history.body.data.find((r: any) => r.message.includes(res.body.data.receipt));
    expect(row).toBeDefined();
    expect(row.status).toBe('PENDING');
    expect(row.provider_cost).toBeNull();
  });

  it('marks OVERPAID when paid exceeds expected rent', async () => {
    const res = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 3, // John Mwangi — unit 12, rent KSh 4,000 (month 9 has no payments)
        paymentDate: '2026-09-01',
        billingMonth: 9,
        billingYear: 2026,
        amount: 4500,
        paymentMethod: 'M_PESA',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OVERPAID');
  });

  it('rejects a negative payment amount', async () => {
    const res = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 3,
        paymentDate: '2026-09-02',
        billingMonth: 9,
        billingYear: 2026,
        amount: -100,
        paymentMethod: 'M_PESA',
      });
    expect(res.status).toBe(400);
  });

  it('rejects rent for a moved-out tenant', async () => {
    // Move Grace out first.
    await request(app)
      .post('/api/tenants/4/move-out')
      .set(auth(adminToken))
      .send({ moveOutDate: '2026-09-10' });
    const res = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 4,
        paymentDate: '2026-09-11',
        billingMonth: 9,
        billingYear: 2026,
        amount: 1000,
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Water (spec §11–§17)
// ---------------------------------------------------------------------------
describe('Water metering', () => {
  it('rejects a reading for a unit without water billing (unit 5)', async () => {
    const res = await request(app)
      .post('/api/water/readings')
      .set(auth(staffToken))
      .send({
        unitId: await unitIdFor('5'),
        readingDate: '2026-09-01',
        billingMonth: 9,
        billingYear: 2026,
        currentReading: 10,
      });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/does not support water billing/);
  });

  it('records a FIRST READING (no previous reading) for unit 13', async () => {
    const unit13 = (await request(app).get('/api/units?q=13').set(auth(staffToken))).body.data.find(
      (u: any) => u.unit_number === '13'
    );
    const res = await request(app)
      .post('/api/water/readings')
      .set(auth(staffToken))
      .send({
        unitId: unit13.id,
        readingDate: '2026-09-05',
        billingMonth: 9,
        billingYear: 2026,
        currentReading: 150,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.firstReading).toBe(true);
    expect(res.body.data.reading.previous_reading).toBe('0.00');
    expect(res.body.data.reading.consumption).toBe('150.00');
    expect(res.body.data.reading.water_bill).toBe('30000.00'); // 150 × 200
  });

  it('auto-uses the previous reading for the next reading', async () => {
    const unit13 = (await request(app).get('/api/units?q=13').set(auth(staffToken))).body.data.find(
      (u: any) => u.unit_number === '13'
    );
    const res = await request(app)
      .post('/api/water/readings')
      .set(auth(staffToken))
      .send({
        unitId: unit13.id,
        readingDate: '2026-10-05',
        billingMonth: 10,
        billingYear: 2026,
        currentReading: 158,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.firstReading).toBe(false);
    expect(res.body.data.reading.previous_reading).toBe('150.00');
    expect(res.body.data.reading.consumption).toBe('8.00');
    expect(res.body.data.reading.water_bill).toBe('1600.00');
  });

  it('rejects a current reading lower than the previous reading', async () => {
    const unit13 = (await request(app).get('/api/units?q=13').set(auth(staffToken))).body.data.find(
      (u: any) => u.unit_number === '13'
    );
    const res = await request(app)
      .post('/api/water/readings')
      .set(auth(staffToken))
      .send({
        unitId: unit13.id,
        readingDate: '2026-11-05',
        billingMonth: 11,
        billingYear: 2026,
        currentReading: 100,
      });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Current meter reading cannot be lower than previous reading.');
  });

  it('rejects a duplicate reading for the same unit and month', async () => {
    const res = await request(app)
      .post('/api/water/readings')
      .set(auth(staffToken))
      .send({
        unitId: await unitIdFor('15'), // seed already has a Feb-2026 reading
        readingDate: '2026-02-20',
        billingMonth: 2,
        billingYear: 2026,
        currentReading: 128,
      });
    expect(res.status).toBe(409);
  });

  it('water payment statuses: PARTIAL then PAID (spec §17 / §48)', async () => {
    // Grace's March water bill is KSh 1,200; seed has KSh 500 paid.
    const partial = await request(app)
      .post('/api/water/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 4,
        paymentDate: '2026-09-02',
        billingMonth: 3,
        billingYear: 2026,
        amount: 200,
        paymentMethod: 'M_PESA',
      });
    expect(partial.status).toBe(201);
    expect(partial.body.data.status).toBe('PARTIAL');
    expect(partial.body.data.waterBalance).toBe(500);

    const paid = await request(app)
      .post('/api/water/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 4,
        paymentDate: '2026-09-03',
        billingMonth: 3,
        billingYear: 2026,
        amount: 500,
        paymentMethod: 'CASH',
      });
    expect(paid.status).toBe(201);
    expect(paid.body.data.status).toBe('PAID');
    expect(paid.body.data.waterBalance).toBe(0);
  });

  it('rejects a water payment for a non-water unit', async () => {
    const res = await request(app)
      .post('/api/water/payments')
      .set(auth(staffToken))
      .send({
        tenantId: 1, // Peter — unit 1 (no water billing)
        paymentDate: '2026-09-01',
        billingMonth: 9,
        billingYear: 2026,
        amount: 500,
        paymentMethod: 'CASH',
      });
    expect(res.status).toBe(422);
  });

  it('exports water payments as CSV, mirroring the rent export', async () => {
    const res = await request(app).get('/api/water/payments/export?year=2026').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('water-payments.csv');

    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(
      'payment_date,billing_month,billing_year,tenant,unit,amount,payment_method,bill,total_paid,balance,status,receipt_number'
    );
    expect(lines.length).toBeGreaterThan(1); // seed has water payments in 2026
    expect(res.text).toContain('Grace Njeri');
    // Bill context columns carry numbers (bill/total_paid/balance), not blanks.
    const dataRow = lines[1].split(',');
    expect(Number(dataRow[7])).not.toBeNaN();
    expect(['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID']).toContain(dataRow[10]);

    // Month filter narrows the export (no December 2026 water payments in seed).
    const empty = await request(app).get('/api/water/payments/export?year=2026&month=12').set(auth(staffToken));
    expect(empty.status).toBe(200);
    expect(empty.text.trim().split('\n').length).toBe(1); // header only
  });
});

// ---------------------------------------------------------------------------
// Receipts (spec §33)
// ---------------------------------------------------------------------------
describe('Receipts', () => {
  it('lists receipts and generates a combined RWC receipt', async () => {
    const list = await request(app).get('/api/receipts?limit=5').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);

    const combined = await request(app)
      .post('/api/receipts/generate')
      .set(auth(adminToken))
      .send({ tenantId: 3, billingMonth: 1, billingYear: 2026 }); // John — rent + water in January
    expect(combined.status).toBe(201);
    expect(combined.body.data.receipt_number).toMatch(/^RWC-2026-\d{4}$/);
    expect(combined.body.data.receipt_type).toBe('COMBINED');
  });
});

// ---------------------------------------------------------------------------
// Finance (spec §20–§22, §30–§31)
// ---------------------------------------------------------------------------
describe('Finance', () => {
  it('returns a full dashboard with property/water/combined summaries', async () => {
    const res = await request(app).get('/api/reports/dashboard').set(auth(adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.property.totalUnits).toBe(24);
    expect(d.property.occupiedUnits + d.property.vacantUnits).toBe(24);
    expect(typeof d.property.rentCollected).toBe('number');
    expect(typeof d.water.waterBilled).toBe('number');
    expect(d.water.waterOutstanding).toBeGreaterThanOrEqual(0);
    expect(d.combined.totalCollected).toBe(d.property.rentCollected + d.water.waterCollected);
    expect(Object.keys(d.charts)).toContain('monthlyRentCollected');
  });

  it('computes water surplus/deficit correctly (spec §49)', async () => {
    // Seed: collected 6,700 + the 700 added above = 7,400; supply cost 12,300.
    const res = await request(app).get('/api/reports/water').set(auth(adminToken));
    expect(res.status).toBe(200);
    const w = res.body.data;
    expect(w.surplusDeficit).toBe(w.waterCollected - w.waterSupplyCost);
  });

  it('reports arrears with separated rent and water balances', async () => {
    const res = await request(app).get('/api/reports/arrears').set(auth(adminToken));
    expect(res.status).toBe(200);
    const rows = res.body.data;
    expect(rows.length).toBeGreaterThan(0);
    // Grace (unit 15) was moved out in an earlier test — Peter (unit 1) is still active.
    const row = rows.find((r: any) => r.unitNumber === '1');
    expect(row).toBeDefined();
    expect(row.totalOutstanding).toBe(row.rentBalance + row.waterBalance);
    expect(['UNPAID', 'PARTIAL', 'OVERDUE', 'OVERPAID', 'CLEARED']).toContain(row.status);
  });

  it('produces a tenant ledger with rent and water columns', async () => {
    const res = await request(app).get('/api/reports/tenant/3').set(auth(adminToken));
    expect(res.status).toBe(200);
    const ledger = res.body.data;
    expect(ledger.months.length).toBe(12);
    const jan = ledger.months[0];
    expect(jan.expectedRent).toBe(4000);
    expect(jan.waterBill).toBe(1600);
    expect(jan.totalBalance).toBe(jan.rentBalance + jan.waterBalance);
  });

  it('downloads the monthly financial report as a one-page PDF', async () => {
    const res = await request(app).get('/api/reports/monthly.pdf?year=2026').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('financial-report-2026.pdf');
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(1000);
    // One landscape page — verified by parsing the document, not by grepping
    // (pdf-lib compresses object streams, so raw bytes hide /Page objects).
    const doc = await PDFDocument.load(res.body, { ignoreEncryption: true });
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height); // landscape
    expect(Math.round(width)).toBe(842); // A4 landscape
    expect(Math.round(height)).toBe(595);
    // No year given → the reporting year is used and named in the filename.
    const fallback = await request(app).get('/api/reports/monthly.pdf').set(auth(adminToken));
    expect(fallback.status).toBe(200);
    expect(fallback.headers['content-disposition']).toContain(`financial-report-${2026}.pdf`);
  });

  it('rejects the monthly report PDF for anonymous users and bad years', async () => {
    const anon = await request(app).get('/api/reports/monthly.pdf');
    expect(anon.status).toBe(401);

    const badYear = await request(app).get('/api/reports/monthly.pdf?year=12345').set(auth(adminToken));
    expect(badYear.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Settings (spec §6)
// ---------------------------------------------------------------------------
describe('Settings', () => {
  it('updates the water rate and uses it for new bills', async () => {
    const before = (await request(app).get('/api/settings').set(auth(adminToken))).body.data;
    expect(before.reporting_year).toBe(2026);
    expect(Number(before.water_rate)).toBe(200);

    const updated = await request(app)
      .put('/api/settings')
      .set(auth(adminToken))
      .send({ waterRate: 250 });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.data.water_rate)).toBe(250);

    // A new reading on unit 13 for December must use 250.
    const unit13 = (await request(app).get('/api/units?q=13').set(auth(staffToken))).body.data.find(
      (u: any) => u.unit_number === '13'
    );
    const res = await request(app)
      .post('/api/water/readings')
      .set(auth(staffToken))
      .send({
        unitId: unit13.id,
        readingDate: '2026-12-05',
        billingMonth: 12,
        billingYear: 2026,
        currentReading: 160, // prev 158 → 2 units
      });
    expect(res.status).toBe(201);
    expect(res.body.data.reading.water_rate).toBe('250.00');
    expect(res.body.data.reading.water_bill).toBe('500.00'); // 2 × 250

    // Restore for other tests.
    await request(app).put('/api/settings').set(auth(adminToken)).send({ waterRate: 200 });
  });

  it('prevents STAFF from changing settings', async () => {
    const res = await request(app).put('/api/settings').set(auth(staffToken)).send({ waterRate: 999 });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// SMS notifications (spec §42) — provider is mock-forced in the test env
// ---------------------------------------------------------------------------
describe('SMS notifications', () => {
  it('exposes the provider mode without secrets', async () => {
    const res = await request(app).get('/api/sms/config').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ provider: 'mock', live: false });
  });

  it('requires authentication for the config endpoint', async () => {
    const res = await request(app).get('/api/sms/config');
    expect(res.status).toBe(401);
  });

  it('reports the balance as unknown outside live Africa\'s Talking mode', async () => {
    // Test env forces the mock provider, so no balance can be queried.
    const res = await request(app).get('/api/sms/balance').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('unknown');
    expect(typeof res.body.data.reason).toBe('string');

    const anon = await request(app).get('/api/sms/balance');
    expect(anon.status).toBe(401);
  });

  it('records delivery reports without auth and never flips the send status', async () => {
    // Send a real message through the mock provider so we have a SENT row
    // with a provider reference to report against.
    const history = await request(app).get('/api/sms/history?status=PENDING').set(auth(adminToken));
    const pending = history.body.data[0];
    expect(pending).toBeTruthy();
    const sent = await request(app).post(`/api/sms/${pending.id}/send`).set(auth(adminToken));
    expect(sent.body.data.status).toBe('SENT');
    const ref = sent.body.data.provider_message_id as string;
    expect(ref).toBeTruthy();

    // Callback, unauthenticated (as the provider would), form-urlencoded
    // — the shape Africa's Talking delivers.
    const cb = await request(app)
      .post('/api/sms/delivery-reports')
      .type('form')
      .send({ messageId: ref, status: 'Success', statusCode: '101', networkCode: '63902' });
    expect(cb.status).toBe(200);

    const row = await pool.query('SELECT status, delivery_status, delivery_network, delivery_updated_at FROM sms_notifications WHERE id = $1', [pending.id]);
    expect(row.rows[0].status).toBe('SENT'); // send lifecycle untouched
    expect(row.rows[0].delivery_status).toBe('DELIVERED');
    expect(row.rows[0].delivery_network).toBe('63902');
    expect(row.rows[0].delivery_updated_at).toBeTruthy();

    // Idempotent: re-applying the same report changes nothing (first wins).
    await request(app).post('/api/sms/delivery-reports').type('form').send({ messageId: ref, status: 'Success', statusCode: '101' });
    const again = await pool.query('SELECT delivery_status, delivery_updated_at FROM sms_notifications WHERE id = $1', [pending.id]);
    expect(again.rows[0].delivery_status).toBe('DELIVERED');
  });

  it('records FAILED_ON_NETWORK from a delivery report without arming the retry job', async () => {
    const history = await request(app).get('/api/sms/history?status=PENDING').set(auth(adminToken));
    const pending = history.body.data[0];
    expect(pending).toBeTruthy();
    const sent = await request(app).post(`/api/sms/${pending.id}/send`).set(auth(adminToken));
    const ref = sent.body.data.provider_message_id as string;

    const cb = await request(app)
      .post('/api/sms/delivery-reports')
      .type('form')
      .send({ messageId: ref, status: 'OperatorRejected', statusCode: '402', networkCode: '63903' });
    expect(cb.status).toBe(200);

    const row = await pool.query('SELECT status, delivery_status, next_retry_at FROM sms_notifications WHERE id = $1', [pending.id]);
    // Send status stays SENT — the retry job only sweeps FAILED, so no
    // double-billing re-send can be armed by a delivery failure.
    expect(row.rows[0].status).toBe('SENT');
    expect(row.rows[0].delivery_status).toBe('FAILED_ON_NETWORK');
    expect(row.rows[0].next_retry_at).toBeNull();
  });

  it('ignores delivery reports for unknown references and transient states', async () => {
    // Unknown message id → 200 (the gateway must not retry), no crash.
    const unknown = await request(app)
      .post('/api/sms/delivery-reports')
      .type('form')
      .send({ messageId: 'AT-No-Such-Ref', status: 'Success', statusCode: '101' });
    expect(unknown.status).toBe(200);

    // A transient state (User In Buffer Mode) leaves delivery undecided.
    const history = await request(app).get('/api/sms/history?status=PENDING').set(auth(adminToken));
    const pending = history.body.data[0];
    if (pending) {
      const sent = await request(app).post(`/api/sms/${pending.id}/send`).set(auth(adminToken));
      const ref = sent.body.data.provider_message_id as string;
      await request(app).post('/api/sms/delivery-reports').type('form').send({ messageId: ref, status: 'User In Buffer Mode', statusCode: '100' });
      const row = await pool.query('SELECT delivery_status FROM sms_notifications WHERE id = $1', [pending.id]);
      expect(row.rows[0].delivery_status).toBeNull();
    }
  });

  it('sends a PENDING message via the mock provider and records the reference', async () => {
    const history = await request(app).get('/api/sms/history?status=PENDING').set(auth(adminToken));
    expect(history.status).toBe(200);
    const pending = history.body.data[0];
    expect(pending).toBeDefined(); // payments made in earlier tests create PENDING rows

    const res = await request(app).post(`/api/sms/${pending.id}/send`).set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SENT');
    expect(res.body.data.provider_message_id).toMatch(/^MOCK-\d+$/);
    expect(res.body.data.sent_at).toBeTruthy();

    // It is no longer pending in the history.
    const after = await request(app).get(`/api/sms/history?q=${encodeURIComponent(pending.message.slice(0, 12))}`).set(auth(adminToken));
    const row = after.body.data.find((r: any) => r.id === pending.id);
    expect(row.status).toBe('SENT');
  });

  it('404s when sending an unknown SMS id', async () => {
    const res = await request(app).post('/api/sms/999999/send').set(auth(staffToken));
    expect(res.status).toBe(404);
  });

  it('backfill: retry sweep re-sends a due FAILED row and skips exhausted ones', async () => {
    const { pool } = await import('../../src/config/db');
    const { runRetrySweep } = await import('../../src/services/smsRetryJob');
    const history = await request(app).get('/api/sms/history?status=SENT').set(auth(adminToken));
    const source = history.body.data[0];
    expect(source).toBeDefined();

    // A due FAILED row → the sweep claims it and the mock provider SENTs it.
    await pool.query(
      `INSERT INTO sms_notifications (receipt_id, tenant_id, phone_number, message, status, failure_reason, attempt_count, next_retry_at)
       VALUES (NULL, $1, '+254700111222', 'Retry sweep test message', 'FAILED', 'simulated timeout', 1, NOW() - INTERVAL '1 minute')`,
      [source.tenant_id]
    );
    // An exhausted FAILED row (attempts maxed, no deadline) → untouched.
    await pool.query(
      `INSERT INTO sms_notifications (receipt_id, tenant_id, phone_number, message, status, failure_reason, attempt_count, next_retry_at)
       VALUES (NULL, $1, '+254700111222', 'Exhausted retries message', 'FAILED', 'gave up', 99, NULL)`,
      [source.tenant_id]
    );

    const dispatched = await runRetrySweep();
    expect(dispatched).toBeGreaterThanOrEqual(1);

    const after = await request(app).get('/api/sms/history?q=Retry sweep test').set(auth(adminToken));
    const revived = after.body.data[0];
    expect(revived.status).toBe('SENT');
    expect(revived.attempt_count).toBe(2);
    expect(revived.next_retry_at).toBeNull();

    const exhaustedRes = await request(app).get('/api/sms/history?q=Exhausted retries').set(auth(adminToken));
    const exhausted = exhaustedRes.body.data[0];
    expect(exhausted.status).toBe('FAILED');
    expect(exhausted.attempt_count).toBe(99);

    // Cleanup so later suites see a pristine history.
    await pool.query("DELETE FROM sms_notifications WHERE message IN ('Retry sweep test message', 'Exhausted retries message')");
  });

  it('records no cost for simulated sends and reports zero spend', async () => {
    const history = await request(app).get('/api/sms/history?status=SENT').set(auth(adminToken));
    expect(history.status).toBe(200);
    // Mock sends are free — nothing was delivered, so no cost may appear.
    for (const row of history.body.data) {
      expect(row.provider_cost).toBeNull();
      expect(row.provider_currency).toBeNull();
    }
    expect(history.body.meta.spendByCurrency).toEqual([]);
  });

  it('sums provider costs per currency across the filtered set', async () => {
    // Send a few real PENDING messages so this test owns its SENT rows
    // (the seed only produces PENDING rows; costs are then simulated directly
    // since the mock provider never charges — parsing/persistence are covered
    // by the unit tests and the send flow above).
    const pending = await request(app).get('/api/sms/history?status=PENDING').set(auth(adminToken));
    const targets = pending.body.data.slice(0, 3);
    expect(targets.length).toBeGreaterThanOrEqual(2);
    for (const t of targets) {
      const sendRes = await request(app).post(`/api/sms/${t.id}/send`).set(auth(staffToken));
      expect(sendRes.status).toBe(200);
    }

    const { pool } = await import('../../src/config/db');
    const ids = targets.map((t: any) => t.id);
    await pool.query(
      "UPDATE sms_notifications SET provider_cost = '1.25', provider_currency = 'KES' WHERE id = ANY($1)",
      [ids]
    );
    await pool.query('UPDATE sms_notifications SET provider_cost = \'0.75\', provider_currency = \'USD\' WHERE id = $1', [ids[0]]);

    const history = await request(app).get('/api/sms/history').set(auth(adminToken));
    const spend = history.body.meta.spendByCurrency;
    expect(Array.isArray(spend)).toBe(true);
    const kes = spend.find((s: any) => s.currency === 'KES');
    const usd = spend.find((s: any) => s.currency === 'USD');
    expect(Number(kes.total)).toBeCloseTo(1.25 * (ids.length - 1), 2);
    expect(Number(usd.total)).toBeCloseTo(0.75, 2);
    // And the Cost column rides along on each row.
    const withCost = history.body.data.find((r: any) => r.provider_currency === 'USD');
    expect(Number(withCost.provider_cost)).toBeCloseTo(0.75, 2);

    // Filters apply to the spend too — restrict to one tenant.
    const tenantId = withCost.tenant_id;
    const filtered = await request(app).get(`/api/sms/history?tenantId=${tenantId}`).set(auth(adminToken));
    const filteredUsd = filtered.body.meta.spendByCurrency.find((s: any) => s.currency === 'USD');
    if (filteredUsd) expect(Number(filteredUsd.total)).toBeCloseTo(0.75, 2);

    // Cleanup: restore the costless mock-send state.
    await pool.query('UPDATE sms_notifications SET provider_cost = NULL, provider_currency = NULL');
  });
});

// ---------------------------------------------------------------------------
// Privacy: data-subject export & erasure (Kenya DPA 2019 / GDPR)
// ---------------------------------------------------------------------------
describe('Privacy: export & erasure', () => {
  const META = { requester: 'Peter Otieno (tenant)', reason: 'Written DSAR received — copy of data requested' };

  it('exports a tenant personal-data bundle for admins', async () => {
    const res = await request(app).get('/api/tenants/1/data-export').set(auth(adminToken)).query(META); // Peter — seeded with payments
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('tenant-1-personal-data.json');
    expect(res.body.subject).toMatchObject({ id: 1 });
    expect(res.body.data.rentPayments.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.auditTrail)).toBe(true); // seed-created tenants have no API audit entries yet
    expect(res.body.retentionNote).toContain('retained');
  });

  it('requires requester and reason for exports', async () => {
    const noMeta = await request(app).get('/api/tenants/1/data-export').set(auth(adminToken));
    expect(noMeta.status).toBe(400);

    const noReason = await request(app).get('/api/tenants/1/data-export').set(auth(adminToken)).query({ requester: 'Admin' });
    expect(noReason.status).toBe(400);
  });

  it('refuses export to non-admins', async () => {
    const res = await request(app).get('/api/tenants/1/data-export').set(auth(staffToken));
    expect(res.status).toBe(403);
  });

  it('exports the same data as a tidy CSV spreadsheet', async () => {
    const res = await request(app).get('/api/tenants/1/data-export.csv').set(auth(adminToken)).query(META);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('tenant-1-personal-data.csv');
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('category,record,field,value');
    expect(res.text).toContain('subject,tenant-1,full_name,');
    expect(res.text).toContain(',rentPayments-');
    // A value containing a comma must be quoted; CSV-formula-leading cells quoted too.
    expect(lines.every((l) => l.split(',').length >= 4 || l === '')).toBe(true);
    const staffRes = await request(app).get('/api/tenants/1/data-export.csv').set(auth(staffToken));
    expect(staffRes.status).toBe(403);
  });

  it('refuses to erase an ACTIVE tenant — and logs the refusal', async () => {
    const res = await request(app).post('/api/tenants/1/erase-personal-data').set(auth(adminToken)).send(META);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TENANT_ACTIVE');

    // The refusal itself is a register entry (compliance trail).
    const register = await request(app).get('/api/privacy-requests?outcome=REFUSED').set(auth(adminToken));
    const refusal = register.body.data.find((r: any) => r.tenant_id === 1 && r.request_type === 'ERASURE');
    expect(refusal).toBeTruthy();
    expect(refusal.outcome_note).toContain('active');
  });

  it('erases a moved-out tenant\'s personal data while keeping financial records', async () => {
    // Grace was moved out by an earlier test; resolve her BEFORE erasure
    // (her name disappears from search results afterwards).
    const found = await request(app).get('/api/tenants?status=MOVED_OUT&q=Grace').set(auth(adminToken));
    const grace = found.body.data[0];
    expect(grace).toBeDefined();

    const res = await request(app).post(`/api/tenants/${grace.id}/erase-personal-data`).set(auth(adminToken)).send(META);
    expect(res.status).toBe(200);
    expect(res.body.data.tenant.full_name).toBe(`Erased tenant #${grace.id}`);
    expect(res.body.data.tenant.phone_number).toBeNull();
    expect(res.body.data.tenant.email).toBeNull();
    expect(res.body.data.erased.smsMessagesRedacted).toBeGreaterThan(0);
    expect(res.body.data.kept.rentPayments + res.body.data.kept.waterPayments + res.body.data.kept.receipts).toBeGreaterThan(0);

    // The export now shows anonymised identity but the financial trail survives.
    const bundle = await request(app).get(`/api/tenants/${grace.id}/data-export`).set(auth(adminToken)).query(META);
    expect(bundle.body.subject.full_name).toBe(`Erased tenant #${grace.id}`);
    expect(bundle.body.data.receipts.length).toBeGreaterThan(0);
    for (const sms of bundle.body.data.smsNotifications) {
      expect(sms.message).toBe('[Erased on request — personal data removed]');
      expect(sms.phone_number).toBe('');
    }
    for (const entry of bundle.body.data.auditTrail) {
      if (entry.action === 'TENANT_DATA_ERASED') {
        expect(entry.new_value.erased).toBeTruthy(); // the erasure record itself is not redacted
      } else {
        expect(entry.new_value).toEqual({ erased: true });
      }
    }

    // She no longer matches a search for her old name.
    const search = await request(app).get('/api/tenants?q=Grace').set(auth(adminToken));
    expect(search.body.data.find((t: any) => t.id === grace.id)).toBeUndefined();
  });

  it('builds the formal response letter with the register reference and branding', async () => {
    const res = await request(app).post('/api/tenants/1/data-request-letter').set(auth(adminToken)).send(META);
    expect(res.status).toBe(200);
    const letter = res.body.data;

    // Register reference quoted in the letter, bundle attached as enclosure.
    expect(letter.registerRef).toMatch(/^DSAR-\d+$/);
    // response_days is null until the operator fills it in; the letter falls back to 30.
    expect(letter.responseDays === null || typeof letter.responseDays === 'string').toBe(true);
    expect(letter.branding.legal_name).toBeTruthy();
    expect(letter.bundle.subject).toMatchObject({ id: 1, full_name: 'Peter Otieno' });
    expect(letter.bundle.data.rentPayments.length).toBeGreaterThan(0);

    // Exactly one register entry for this action (the server logged it; the
    // UI must not log it again). Earlier tests also log tenant-1 exports, so
    // scope to the register id the letter itself references.
    const refId = Number(String(letter.registerRef).split('-')[1]);
    const register = await request(app).get('/api/privacy-requests?limit=100').set(auth(adminToken));
    const entries = register.body.data.filter((r: any) => r.id === refId);
    expect(entries.length).toBe(1);
    expect(entries[0].tenant_id).toBe(1);
    expect(entries[0].request_type).toBe('EXPORT_JSON');
    expect(entries[0].requester).toBe(META.requester);
    expect(entries[0].outcome).toBe('COMPLETED');
  });

  it('refuses the letter endpoint for non-admins and validates the metadata', async () => {
    const staff = await request(app).post('/api/tenants/1/data-request-letter').set(auth(staffToken)).send(META);
    expect(staff.status).toBe(403);

    const noMeta = await request(app).post('/api/tenants/1/data-request-letter').set(auth(adminToken)).send({ requester: 'Admin' });
    expect(noMeta.status).toBe(400);

    const missing = await request(app).post('/api/tenants/999999/data-request-letter').set(auth(adminToken)).send(META);
    expect(missing.status).toBe(404);
  });

  it('includes the export summary in the letter payload', async () => {
    const res = await request(app).post('/api/tenants/1/data-request-letter').set(auth(adminToken)).send(META);
    expect(res.status).toBe(200);
    const s = res.body.data.summary;
    expect(s.rentPayments.count).toBeGreaterThan(0);
    expect(s.rentPayments.total).toBeGreaterThan(0);
    expect(s.smsNotifications.count).toBeGreaterThanOrEqual(0);
    expect(typeof s.auditTrail.count).toBe('number');
    // Totals are rounded money numbers.
    expect(Number.isInteger(s.rentPayments.total)).toBe(true);
  });

  it('emails the response letter with the data file attached (mock provider)', async () => {
    // 1. Generate the letter (this writes the register entry).
    const gen = await request(app).post('/api/tenants/1/data-request-letter').set(auth(adminToken)).send(META);
    expect(gen.status).toBe(200);
    const registerRef = gen.body.data.registerRef as string;
    const registerId = Number(registerRef.split('-')[1]);

    // 2. Email it, reusing the register reference.
    const res = await request(app)
      .post('/api/tenants/1/data-request-letter/email')
      .set(auth(adminToken))
      .send({ registerRef });
    expect(res.status).toBe(201);
    expect(res.body.data.registerRef).toBe(registerRef);
    expect(res.body.data.emailStatus).toBe('SENT'); // mock provider always succeeds
    expect(res.body.data.sentTo).toContain('@');

    // 3. The email row carries the JSON data file as the attachment.
    const emailId = res.body.data.emailId as number;
    const email = await pool.query('SELECT attachment_name, attachment_content, body_html FROM email_notifications WHERE id = $1', [emailId]);
    expect(email.rows[0].attachment_name).toBe('tenant-1-personal-data.json');
    const attachmentJson = JSON.parse(email.rows[0].attachment_content);
    expect(attachmentJson.subject.id).toBe(1);
    expect(attachmentJson.data.rentPayments.length).toBeGreaterThan(0);
    // The email body is the letter (summary + reference included).
    expect(email.rows[0].body_html).toContain(registerRef);
    expect(email.rows[0].body_html).toContain('Summary of the data provided');

    // 4. No duplicate register entry — still exactly one for this letter.
    const register = await request(app).get('/api/privacy-requests?limit=100').set(auth(adminToken));
    const entries = register.body.data.filter((r: any) => r.id === registerId);
    expect(entries.length).toBe(1);
  });

  it('refuses the letter-email endpoint for tenants without an email address', async () => {
    // Create a tenant with no email, generate a letter, then try to email it.
    const unitsRes = await request(app).get('/api/units?limit=100').set(auth(staffToken));
    const vacant = unitsRes.body.data.find((u: any) => u.occupancy_status === 'VACANT');
    const created = await request(app)
      .post('/api/tenants')
      .set(auth(adminToken))
      .send({ fullName: 'No Email Tenant', unitId: vacant.id, securityDeposit: 0 });
    expect(created.status).toBe(201);
    const tenantId = created.body.data.id as number;

    const gen = await request(app).post(`/api/tenants/${tenantId}/data-request-letter`).set(auth(adminToken)).send(META);
    expect(gen.status).toBe(200);
    const registerRef = gen.body.data.registerRef as string;

    const res = await request(app)
      .post(`/api/tenants/${tenantId}/data-request-letter/email`)
      .set(auth(adminToken))
      .send({ registerRef });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('TENANT_NO_EMAIL');

    // Cleanup (no erasure semantics needed — the row has no financial history).
    await pool.query('DELETE FROM privacy_requests WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  });

  it('requires auth and admin role for the letter-email endpoint', async () => {
    const anon = await request(app).post('/api/tenants/1/data-request-letter/email').send({ registerRef: 'DSAR-1' });
    expect(anon.status).toBe(401);

    const staff = await request(app).post('/api/tenants/1/data-request-letter/email').set(auth(staffToken)).send({ registerRef: 'DSAR-1' });
    expect(staff.status).toBe(403);
  });

  it('refuses erasure to non-admins and unknown tenants', async () => {
    const staffRes = await request(app).post('/api/tenants/1/erase-personal-data').set(auth(staffToken)).send(META);
    expect(staffRes.status).toBe(403);

    const missing = await request(app).post('/api/tenants/999999/erase-personal-data').set(auth(adminToken)).send(META);
    expect(missing.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Privacy request register (who requested + why, every export/erasure)
// ---------------------------------------------------------------------------
describe('Privacy request register', () => {
  it('lists register entries with requester, reason and outcome (admin only)', async () => {
    const res = await request(app).get('/api/privacy-requests?limit=50').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    // The JSON export and erasure from the block above must both be registered.
    const json = res.body.data.find((r: any) => r.request_type === 'EXPORT_JSON' && r.tenant_id === 1);
    expect(json.requester).toContain('Peter');
    expect(json.reason).toContain('DSAR');
    expect(json.outcome).toBe('COMPLETED');
    expect(json.performed_by_name).toBeTruthy();

    const erasure = res.body.data.find((r: any) => r.request_type === 'ERASURE' && r.outcome === 'COMPLETED');
    expect(erasure).toBeTruthy();

    // Filters work.
    const filtered = await request(app).get('/api/privacy-requests?type=EXPORT_CSV').set(auth(adminToken));
    expect(filtered.body.data.every((r: any) => r.request_type === 'EXPORT_CSV')).toBe(true);
  });

  it('requires requester and reason (validated server-side, mirrored by the UI dialog)', async () => {
    const res = await request(app).post('/api/tenants/1/erase-personal-data').set(auth(adminToken)).send({ requester: 'A' });
    expect(res.status).toBe(400);
  });

  it('is admin-only and requires auth', async () => {
    const staff = await request(app).get('/api/privacy-requests').set(auth(staffToken));
    expect(staff.status).toBe(403);

    const anon = await request(app).get('/api/privacy-requests');
    expect(anon.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Email receipts (delivery mirrors the SMS lifecycle)
// ---------------------------------------------------------------------------
describe('Email receipts', () => {
  it('exposes the email provider config without secrets', async () => {
    const res = await request(app).get('/api/emails/config').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('provider');
    expect(res.body.data).toHaveProperty('live');
    expect(JSON.stringify(res.body)).not.toMatch(/pass|secret/i);
  });

  it('emails a receipt end-to-end in mock mode (body + recorded send)', async () => {
    // The seeded tenants have emails, so the first listed receipt works.
    const list = await request(app).get('/api/receipts?limit=1').set(auth(adminToken));
    const receipt = list.body.data[0];
    expect(receipt).toBeTruthy();

    const res = await request(app).post(`/api/receipts/${receipt.id}/email`).set(auth(adminToken)).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('SENT'); // mock provider always succeeds
    expect(res.body.data.email_address).toContain('@');
    expect(res.body.data.subject).toContain(receipt.receipt_number);
    expect(res.body.data.body_html).toContain(receipt.receipt_number);

    // The attachment is the real receipt PDF (base64), named <number>.pdf.
    const stored = await pool.query(
      'SELECT attachment_name, attachment_content, attachment_content_type FROM email_notifications WHERE receipt_id = $1 ORDER BY id DESC LIMIT 1',
      [receipt.id]
    );
    expect(stored.rows[0].attachment_name).toBe(`${receipt.receipt_number}.pdf`);
    expect(stored.rows[0].attachment_content_type).toBe('application/pdf');
    const pdf = Buffer.from(stored.rows[0].attachment_content, 'base64');
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);

    // History lists it with the tenant context.
    const history = await request(app).get(`/api/emails/history?q=${encodeURIComponent(receipt.receipt_number)}`).set(auth(adminToken));
    const row = history.body.data.find((e: any) => e.receipt_id === receipt.id);
    expect(row).toBeTruthy();
    expect(row.tenant_name).toBe(receipt.tenant_name);
    expect(row.status).toBe('SENT');
  });

  it('accepts an explicit recipient and validates the address', async () => {
    const list = await request(app).get('/api/receipts?limit=1').set(auth(adminToken));
    const receipt = list.body.data[0];

    const res = await request(app).post(`/api/receipts/${receipt.id}/email`).set(auth(adminToken)).send({ toEmail: 'landlord@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.data.email_address).toBe('landlord@example.com');

    const bad = await request(app).post(`/api/receipts/${receipt.id}/email`).set(auth(adminToken)).send({ toEmail: 'not-an-email' });
    expect(bad.status).toBe(400);
  });

  it('rejects unauthenticated sends and returns 404 for unknown receipts', async () => {
    const res = await request(app).post('/api/receipts/1/email').send({});
    expect(res.status).toBe(401);

    const missing = await request(app).post('/api/receipts/999999/email').set(auth(adminToken)).send({});
    expect(missing.status).toBe(404);
  });

  it('serves the receipt as a downloadable PDF', async () => {
    const list = await request(app).get('/api/receipts?limit=1').set(auth(adminToken));
    const receipt = list.body.data[0];

    const res = await request(app).get(`/api/receipts/${receipt.id}/pdf`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain(`${receipt.receipt_number}.pdf`);
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(500);
  });

  it('rejects unauthenticated PDF downloads and 404s unknown receipts', async () => {
    const res = await request(app).get('/api/receipts/1/pdf');
    expect(res.status).toBe(401);

    const missing = await request(app).get('/api/receipts/999999/pdf').set(auth(adminToken));
    expect(missing.status).toBe(404);
  });

  it('bulk-exports a month of receipts as one merged PDF', async () => {
    // Discover a month that actually has receipts (seed months vary).
    const anyReceipt = await request(app).get('/api/receipts?limit=1').set(auth(staffToken));
    expect(anyReceipt.body.data.length).toBeGreaterThan(0);
    const { billing_month: month, billing_year: year } = anyReceipt.body.data[0];

    const res = await request(app).get(`/api/receipts/export.pdf?month=${month}&year=${year}`).set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain(`receipts-${year}-`);
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(1000);

    // The count header matches how many receipts that month actually has.
    const list = await request(app).get(`/api/receipts?month=${month}&year=${year}&limit=100`).set(auth(staffToken));
    expect(Number(res.headers['x-receipt-count'])).toBe(list.body.pagination.total);
  });

  it('bulk PDF export: month with no receipts → 404, missing/invalid params → 400', async () => {
    const empty = await request(app).get('/api/receipts/export.pdf?month=1&year=2030').set(auth(staffToken));
    expect(empty.status).toBe(404);
    expect(empty.body.error).toBe('NO_RECEIPTS');

    const noMonth = await request(app).get('/api/receipts/export.pdf?year=2026').set(auth(staffToken));
    expect(noMonth.status).toBe(400);

    const badMonth = await request(app).get('/api/receipts/export.pdf?month=13&year=2026').set(auth(staffToken));
    expect(badMonth.status).toBe(400);

    const anon = await request(app).get('/api/receipts/export.pdf?month=9&year=2026');
    expect(anon.status).toBe(401);
  });
});
// ---------------------------------------------------------------------------
// Business branding: the admin-editable identity (business_branding table)
// ---------------------------------------------------------------------------
describe('Business branding API', () => {
  it('serves the identity publicly with filled/missing status', async () => {
    const res = await request(app).get('/api/branding');
    expect(res.status).toBe(200);
    const b = res.body.data;
    expect(b.legalName).toBeTruthy();
    expect(Array.isArray(b.fieldStatus)).toBe(true);
    expect(b.fieldStatus.length).toBe(12);
    expect(b).toHaveProperty('brandInitials');
    expect(typeof b.missingCount).toBe('number');
    // No secrets on the public surface.
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('password');
  });

  it('updates via PUT and reflects the change across views', async () => {
    const res = await request(app)
      .put('/api/branding')
      .set(auth(adminToken))
      .send({ legalName: 'Olbano Holdings Test Ltd', registrationNumber: 'BN-TEST-001' });
    expect(res.status).toBe(200);
    expect(res.body.data.legalName).toBe('Olbano Holdings Test Ltd');

    // Public read shows the new value + derived initials follow.
    const pub = await request(app).get('/api/branding');
    expect(pub.body.data.legalName).toBe('Olbano Holdings Test Ltd');
    expect(pub.body.data.brandInitials).toBe('OT'); // first two significant words
    expect(pub.body.data.registrationNumber).toBe('BN-TEST-001');

    // The change is audit-logged.
    const audit = await pool.query(
      `SELECT action FROM audit_logs WHERE entity = 'business_branding' ORDER BY id DESC LIMIT 1`
    );
    expect(audit.rows[0].action).toBe('BRANDING_UPDATED');

    // Restore.
    await request(app).put('/api/branding').set(auth(adminToken)).send({
      legalName: 'Olbano Property Management',
      registrationNumber: '',
    });
  });

  it('treats an empty string as clear and omitted keys as unchanged', async () => {
    await request(app).put('/api/branding').set(auth(adminToken)).send({ propertyScope: 'Test Scope Estates' });
    const afterSet = await request(app).get('/api/branding');
    expect(afterSet.body.data.propertyScope).toBe('Test Scope Estates');

    // A PUT touching only legalName must leave propertyScope intact...
    await request(app).put('/api/branding').set(auth(adminToken)).send({ legalName: 'Olbano Property Management' });
    const kept = await request(app).get('/api/branding');
    expect(kept.body.data.propertyScope).toBe('Test Scope Estates');

    // ...and an empty string clears it.
    await request(app).put('/api/branding').set(auth(adminToken)).send({ propertyScope: '' });
    const cleared = await request(app).get('/api/branding');
    expect(cleared.body.data.propertyScope).toBeNull();
  });

  it('validates the payload and rejects bad emails', async () => {
    const badEmail = await request(app)
      .put('/api/branding')
      .set(auth(adminToken))
      .send({ contactEmail: 'not-an-email' });
    expect(badEmail.status).toBe(400);
  });

  it('is admin/manager-only to edit, staff read-only, anon cannot write', async () => {
    const staff = await request(app).put('/api/branding').set(auth(staffToken)).send({ legalName: 'X' });
    expect(staff.status).toBe(403);

    const anon = await request(app).put('/api/branding').send({ legalName: 'X' });
    expect(anon.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Automated tenant retention sweep (DPA storage limitation: anonymise
// moved-out tenants N years after their last financial activity)
// ---------------------------------------------------------------------------
describe('Automated tenant retention sweep', () => {
  const yearsAgo = (n: number): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - n);
    return d.toISOString().slice(0, 10);
  };

  let ancientId = 0;   // moved out + last payment ~6y ago → eligible at 5y
  let recentId = 0;    // moved out 6y ago, but payment 1y ago → NOT eligible
  let noActivityId = 0; // moved out 6y ago, no financial rows → eligible

  beforeAll(async () => {
    // Two vacant units — the seeded units all have ACTIVE tenants.
    const unitsRes = await request(app).get('/api/units?limit=100').set(auth(staffToken));
    const vacant = unitsRes.body.data.filter((u: any) => u.occupancy_status === 'VACANT');
    expect(vacant.length).toBeGreaterThanOrEqual(2);
    const [oldUnit, settled] = vacant.slice(0, 2).map((u: any) => u.id as number);

    const createTenant = async (name: string, unitId: number): Promise<number> => {
      const res = await request(app)
        .post('/api/tenants')
        .set(auth(adminToken))
        .send({ fullName: name, unitId, moveInDate: yearsAgo(7), securityDeposit: 1000, phoneNumber: '+254700111222' });
      expect(res.status).toBe(201);
      return res.body.data.id as number;
    };
    const moveOut = async (id: number, date: string): Promise<void> => {
      const mo = await request(app)
        .post(`/api/tenants/${id}/move-out`)
        .set(auth(adminToken))
        .send({ moveOutDate: date });
      expect(mo.status).toBe(200);
    };

    // Has an OLD payment → judged by that payment, not move-out.
    ancientId = await createTenant('Retention Ancient', oldUnit);
    const pay = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId: ancientId,
        paymentDate: yearsAgo(6),
        billingMonth: 1,
        billingYear: Number(yearsAgo(6).slice(0, 4)),
        amount: 1000,
        paymentMethod: 'CASH',
      });
    expect(pay.status).toBe(201);
    await moveOut(ancientId, yearsAgo(6));

    // Recent move-out with no financial rows — protected by move_out_date.
    recentId = await createTenant('Retention Recent', settled);
    await moveOut(recentId, yearsAgo(1));

    noActivityId = await createTenant('Retention NoActivity', oldUnit);
    await moveOut(noActivityId, yearsAgo(6));
  });

  async function setRetentionYears(n: number): Promise<void> {
    const res = await request(app).put('/api/settings').set(auth(adminToken)).send({ retentionYears: n });
    expect(res.status).toBe(200);
  }

  it('anonymises eligible moved-out tenants and logs them in the register', async () => {
    await setRetentionYears(5);

    const result = await runRetentionSweep();
    expect(result.failures).toEqual([]);
    expect(result.checked).toBeGreaterThanOrEqual(2);

    const ancient = await request(app).get(`/api/tenants/${ancientId}`).set(auth(adminToken));
    expect(ancient.body.data.full_name).toBe(`Erased tenant #${ancientId}`);
    expect(ancient.body.data.phone_number).toBeNull();

    const noAct = await request(app).get(`/api/tenants/${noActivityId}`).set(auth(adminToken));
    expect(noAct.body.data.full_name).toBe(`Erased tenant #${noActivityId}`);

    // The register records the system requester.
    const register = await request(app).get('/api/privacy-requests?limit=100').set(auth(adminToken));
    const entry = register.body.data.find((r: any) => r.tenant_id === ancientId);
    expect(entry.requester).toBe('Automated retention policy');
    expect(entry.outcome).toBe('COMPLETED');

    // Audit trail: performed_by NULL marks a system-triggered erasure.
    const audit = await pool.query(
      `SELECT user_id FROM audit_logs WHERE action = 'TENANT_DATA_ERASED' AND entity_id = $1`,
      [ancientId]
    );
    expect(audit.rows[0].user_id).toBeNull();
  });

  it('never touches tenants whose last financial activity is inside the window', async () => {
    const res = await request(app).get(`/api/tenants/${recentId}`).set(auth(adminToken));
    expect(res.body.data.full_name).toBe('Retention Recent');
    expect(res.body.data.phone_number).not.toBeNull();
  });

  it('respects retention_years = 0 as disabled', async () => {
    await setRetentionYears(0);
    const result = await runRetentionSweep();
    expect(result.checked).toBe(0);
    expect(result.anonymized).toBe(0);
  });

  it('exposes retentionYears through the settings API', async () => {
    await setRetentionYears(7);
    const res = await request(app).get('/api/settings').set(auth(staffToken));
    expect(res.body.data.retention_years).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Reporting year drives the reports endpoints (spec §27/§44: every report
// follows the reporting_year setting when no explicit ?year= is passed)
// ---------------------------------------------------------------------------
describe('Reporting year drives reports endpoints', () => {
  const ENDPOINTS = [
    '/api/reports/dashboard',
    '/api/reports/arrears',
    '/api/reports/monthly',
    '/api/reports/monthly/rent',
    '/api/reports/monthly/water',
    '/api/reports/water',
  ];

  const setReportingYear = async (year: number): Promise<void> => {
    const res = await request(app).put('/api/settings').set(auth(adminToken)).send({ reportingYear: year });
    expect(res.status).toBe(200);
  };

  const fetchDefault = async (endpoint: string): Promise<unknown> => {
    const res = await request(app).get(endpoint).set(auth(staffToken));
    expect(res.status).toBe(200);
    return res.body;
  };

  const fetchWithYear = async (endpoint: string, year: number): Promise<unknown> => {
    const res = await request(app).get(`${endpoint}?year=${year}`).set(auth(staffToken));
    expect(res.status).toBe(200);
    return res.body;
  };

  it('defaults to the reporting_year setting on every reports endpoint', async () => {
    // The seed contains 2026 financial data, so 2026 and 2025 produce
    // observably different payloads.
    await setReportingYear(2026);
    for (const endpoint of ENDPOINTS) {
      const defaulted = await fetchDefault(endpoint);
      const explicit = await fetchWithYear(endpoint, 2026);
      expect(defaulted).toEqual(explicit);
    }
  });

  it('returns different data once the reporting year changes (2026 → 2025)', async () => {
    await setReportingYear(2025);
    for (const endpoint of ENDPOINTS) {
      const defaulted = await fetchDefault(endpoint);
      const as2026 = await fetchWithYear(endpoint, 2026);
      expect(defaulted).not.toEqual(as2026);
      const as2025 = await fetchWithYear(endpoint, 2025);
      expect(defaulted).toEqual(as2025);
    }
    // The tenant ledger follows the same rule.
    const ledgerDefault = await fetchDefault('/api/reports/tenant/4');
    const ledger2025 = await fetchWithYear('/api/reports/tenant/4', 2025);
    expect(ledgerDefault).toEqual(ledger2025);
    const ledger2026 = await fetchWithYear('/api/reports/tenant/4', 2026);
    expect(ledgerDefault).not.toEqual(ledger2026);
  });

  it('restores the reporting year and reflects it in /api/settings', async () => {
    await setReportingYear(2026);
    const res = await request(app).get('/api/settings').set(auth(staffToken));
    expect(res.body.data.reporting_year).toBe(2026);
  });
});
