// One-click bulk arrears reminders — POST /api/sms/reminders/bulk-arrears.
//
// The operator's single button: one POST queues a personalised SMS for EVERY
// ACTIVE tenant with money owing on EITHER side of the ledger (rent OR
// water — the gate is per-side, never the net, so a credit on one side can
// never mask a debt on the other). Each message states what is actually
// unpaid — rent-only, water-only, or the itemized Rent + Water = Total split.
// Guards under test:
//   1. Rent-only debtor with a phone -> PENDING row naming the unpaid rent.
//   2. Water-only debtor (rent clear, water billed) -> PENDING row naming the unpaid water.
//   3. Owes-both debtor -> PENDING row with the itemized Rent + Water = Total split.
//   4. Fully paid tenant (rent overpaid, nothing else) -> NEVER queued.
//   5. Owing tenant without a phone -> counted, never queued.
//   6. 401 without a session, 403 for STAFF (managerOrAdmin); 400 on a bad audience.
//   7. Audience RENT reaches rent debtors (incl. owes-both) but not water-only;
//      audience WATER the mirror image; paid tenants hear nothing either way.
//   8. Response counts queueing, not delivery (auto-send is off under test).
//
// Hermetic: the suite creates its own units/tenants/payments/readings and
// removes them in afterAll (payments and readings are ON DELETE RESTRICT, so
// they go before their tenants). Absolute response counts are NOT asserted —
// the shared test DB may hold other active tenants — only this suite's own
// rows and the response shape.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

let adminToken = '';
let staffToken = '';
let reportingYear = 2026;
let rentUnitId = 0;
let paidUnitId = 0;
let waterUnitId = 0;
let phonelessUnitId = 0;
let bothUnitId = 0;
let rentTenantId = 0;
let paidTenantId = 0;
let waterTenantId = 0;
let phonelessTenantId = 0;
let bothTenantId = 0;

const FIXTURE_TENANTS = [
  'Bulk Arrears Phone Tenant',
  'Bulk Arrears Paid Tenant',
  'Bulk Arrears Water Tenant',
  'Bulk Arrears Phoneless Tenant',
  'Bulk Arrears Both Tenant',
];
const FIXTURE_UNITS = ['ZBULK1', 'ZBULK2', 'ZBULK3', 'ZBULK4', 'ZBULK5'];

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

async function removeStaleFixtures(): Promise<void> {
  await pool.query(`DELETE FROM tenants WHERE full_name = ANY($1::text[])`, [FIXTURE_TENANTS]);
  await pool.query(`DELETE FROM units WHERE unit_number = ANY($1::text[])`, [FIXTURE_UNITS]);
}

async function cleanup(): Promise<void> {
  const tenantIds = [rentTenantId, paidTenantId, waterTenantId, phonelessTenantId, bothTenantId].filter(Boolean);
  const unitIds = [rentUnitId, paidUnitId, waterUnitId, phonelessUnitId, bothUnitId].filter(Boolean);
  if (tenantIds.length) {
    await pool.query(`DELETE FROM water_meter_readings WHERE tenant_id = ANY($1::int[])`, [tenantIds]).catch(() => {});
    await pool.query(`DELETE FROM water_payments WHERE tenant_id = ANY($1::int[])`, [tenantIds]).catch(() => {});
    await pool.query(`DELETE FROM rent_payments WHERE tenant_id = ANY($1::int[])`, [tenantIds]).catch(() => {});
    await pool.query(
      `DELETE FROM audit_logs WHERE action = 'BULK_ARREARS_REMINDERS' AND entity = 'tenants'`,
    ).catch(() => {});
    // sms_notifications rows cascade with their tenants.
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::int[])`, [tenantIds]).catch(() => {});
  }
  if (unitIds.length) {
    await pool.query(`DELETE FROM units WHERE id = ANY($1::int[])`, [unitIds]).catch(() => {});
  }
}

async function smsRowsFor(tenantId: number) {
  return (
    await pool.query(
      `SELECT message, status, template_kind FROM sms_notifications
       WHERE tenant_id = $1 AND template_kind = 'MANUAL_BULK_ARREARS'
       ORDER BY id DESC`,
      [tenantId],
    )
  ).rows as { message: string; status: string; template_kind: string }[];
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  staffToken = await login('staff@rpms.local', 'Staff@2026!');
  await removeStaleFixtures();

  const settings = await pool.query(`SELECT reporting_year FROM settings WHERE id = 1`);
  reportingYear = (settings.rows[0]?.reporting_year as number) ?? 2026;

  async function makeUnit(unitNumber: string, waterEnabled: boolean): Promise<number> {
    const unit = await pool.query(
      `INSERT INTO units (property_id, floor_id, unit_number, unit_type, monthly_rent, occupancy_status, water_enabled)
       SELECT p.id, f.id, $1, 'Room', 5000, 'OCCUPIED', $2
       FROM properties p JOIN floors f ON f.property_id = p.id
       ORDER BY p.id, f.id LIMIT 1
       RETURNING id`,
      [unitNumber, waterEnabled],
    );
    expect(unit.rows).toHaveLength(1);
    return unit.rows[0].id as number;
  }

  async function makeTenant(name: string, phone: string | null, unitId: number | null): Promise<number> {
    const tenant = await pool.query(
      `INSERT INTO tenants (unit_id, full_name, phone_number, email, move_in_date, status)
       VALUES ($1, $2, $3, $4, make_date($5, 1, 1), 'ACTIVE')
       RETURNING id`,
      [unitId, name, phone, `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@rpms.test`, reportingYear],
    );
    return tenant.rows[0].id as number;
  }

  async function payRent(tenantId: number, unitId: number, amount: number): Promise<void> {
    await pool.query(
      `INSERT INTO rent_payments (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method)
       VALUES ($1, $2, make_date($4, 6, 15), 6, $4, $3, 'M_PESA')`,
      [tenantId, unitId, amount, reportingYear],
    );
  }

  rentUnitId = await makeUnit('ZBULK1', false);
  paidUnitId = await makeUnit('ZBULK2', false);
  waterUnitId = await makeUnit('ZBULK3', true);
  phonelessUnitId = await makeUnit('ZBULK4', false);
  bothUnitId = await makeUnit('ZBULK5', true);

  // Rent owing: moved in at the year's start, nothing paid — the ledger shows
  // a full YTD rent balance (the "has not paid rent" case).
  rentTenantId = await makeTenant('Bulk Arrears Phone Tenant', '254711000001', rentUnitId);

  // Fully paid: a payment larger than any possible YTD expectation
  // (12 months x 5000). Both ledger sides clear — must NEVER be reminded.
  paidTenantId = await makeTenant('Bulk Arrears Paid Tenant', '254711000002', paidUnitId);
  await payRent(paidTenantId, paidUnitId, 70000);

  // Water-only debtor: rent fully paid, but a metered water bill sits unpaid
  // (the "or even water" case — rent credit must not mask it, and here there
  // is not even a credit, just clear rent + open water).
  waterTenantId = await makeTenant('Bulk Arrears Water Tenant', '254711000003', waterUnitId);
  await payRent(waterTenantId, waterUnitId, 70000);
  await pool.query(
    `INSERT INTO water_meter_readings
       (unit_id, tenant_id, reading_date, billing_month, billing_year,
        previous_reading, current_reading, consumption, water_rate, water_bill)
     VALUES ($1, $2, make_date($3, 3, 15), 3, $3, 0, 10, 10, 100, 1000)`,
    [waterUnitId, waterTenantId, reportingYear],
  );

  // Unreachable debtor: a full-year rent tenancy with no payments (genuinely
  // owing on the rent side) but no phone — counted, never queued.
  phonelessTenantId = await makeTenant('Bulk Arrears Phoneless Tenant', null, phonelessUnitId);

  // Owes both: rent unpaid AND a metered water bill unpaid — the audience
  // every blast includes, receiving the itemized Rent + Water = Total wording.
  bothTenantId = await makeTenant('Bulk Arrears Both Tenant', '254711000004', bothUnitId);
  await pool.query(
    `INSERT INTO water_meter_readings
       (unit_id, tenant_id, reading_date, billing_month, billing_year,
        previous_reading, current_reading, consumption, water_rate, water_bill)
     VALUES ($1, $2, make_date($3, 2, 15), 2, $3, 0, 10, 10, 100, 1000)`,
    [bothUnitId, bothTenantId, reportingYear],
  );
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('POST /api/sms/reminders/bulk-arrears', () => {
  it('401s without a session', async () => {
    const res = await request(app).post('/api/sms/reminders/bulk-arrears').send({});
    expect(res.status).toBe(401);
  });

  it('403s for STAFF — bulk reminders are a manager/admin action', async () => {
    const res = await request(app).post('/api/sms/reminders/bulk-arrears').set(auth(staffToken)).send({});
    expect(res.status).toBe(403);
  });

  it('reminds the rent and water debtors, and never the paid-up tenant', async () => {
    const res = await request(app).post('/api/sms/reminders/bulk-arrears').set(auth(adminToken)).send({});
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ autoSend: false });
    expect(res.body.data.queued).toBeGreaterThanOrEqual(2);
    expect(res.body.data.owing).toBeGreaterThanOrEqual(2);
    expect(res.body.data.skippedPaid).toBeGreaterThanOrEqual(1);
    // The phoneless debtor genuinely owes rent, so the no-phone path fires.
    expect(res.body.data.skippedNoPhone).toBeGreaterThanOrEqual(1);

    // Rent-only debtor: the shorter single-figure wording naming the unpaid rent.
    const rentRows = await smsRowsFor(rentTenantId);
    expect(rentRows).toHaveLength(1);
    expect(rentRows[0].status).toBe('PENDING');
    expect(rentRows[0].message).toContain('Bulk Arrears Phone Tenant');
    expect(rentRows[0].message).toMatch(/rent for Unit .* \(.*\) is unpaid/);
    expect(rentRows[0].message).not.toContain('{{');

    // Water-only debtor: reminded about the water charge (KSh 1000 of it),
    // even though their rent side is fully clear.
    const waterRows = await smsRowsFor(waterTenantId);
    expect(waterRows).toHaveLength(1);
    expect(waterRows[0].status).toBe('PENDING');
    expect(waterRows[0].message).toMatch(/water for Unit .* is unpaid/);
    expect(waterRows[0].message).toContain('1000');

    // Owes-both debtor: the itemized Rent + Water = Total wording.
    const bothRows = await smsRowsFor(bothTenantId);
    expect(bothRows).toHaveLength(1);
    expect(bothRows[0].status).toBe('PENDING');
    expect(bothRows[0].message).toContain('Bulk Arrears Both Tenant');
    expect(bothRows[0].message).toMatch(/arrears .+: Rent KSh \d+ \+ Water KSh 1000 = Total KSh \d+/);

    // Paid-up tenant: nothing queued, ever — no row from this batch.
    expect(await smsRowsFor(paidTenantId)).toHaveLength(0);

    // Phoneless owing tenant: counted, never queued.
    expect(await smsRowsFor(phonelessTenantId)).toHaveLength(0);

    // The response names every skip: the paid tenant as PAID, the phoneless
    // debtor as NO_PHONE — and none of the reminded tenants appear in it.
    const skipped = res.body.data.skipped as Array<{ tenantId: number; tenantName: string; reason: string }>;
    expect(skipped.find((s) => s.tenantId === paidTenantId)?.reason).toBe('PAID');
    expect(skipped.find((s) => s.tenantId === phonelessTenantId)?.reason).toBe('NO_PHONE');
    for (const id of [rentTenantId, waterTenantId, bothTenantId]) {
      expect(skipped.some((s) => s.tenantId === id)).toBe(false);
    }
  });

  it('rejects an unknown audience without queueing anything', async () => {
    const before = {
      rent: (await smsRowsFor(rentTenantId)).length,
      water: (await smsRowsFor(waterTenantId)).length,
    };
    const res = await request(app)
      .post('/api/sms/reminders/bulk-arrears')
      .set(auth(adminToken))
      .send({ audience: 'EVERYONE' });
    expect(res.status).toBe(400);
    expect((await smsRowsFor(rentTenantId)).length).toBe(before.rent);
    expect((await smsRowsFor(waterTenantId)).length).toBe(before.water);
  });

  describe('audience targeting', () => {
    it("audience RENT reminds rent debtors only — the water-only debtor hears nothing new", async () => {
      const before = {
        rent: (await smsRowsFor(rentTenantId)).length,
        water: (await smsRowsFor(waterTenantId)).length,
        both: (await smsRowsFor(bothTenantId)).length,
        paid: (await smsRowsFor(paidTenantId)).length,
        phoneless: (await smsRowsFor(phonelessTenantId)).length,
      };
      const res = await request(app)
        .post('/api/sms/reminders/bulk-arrears')
        .set(auth(adminToken))
        .send({ audience: 'RENT' });
      expect(res.status).toBe(201);
      expect(res.body.data.audience).toBe('RENT');
      expect(res.body.data.skippedOtherBill).toBeGreaterThanOrEqual(1);
      const skipped = res.body.data.skipped as Array<{ tenantId: number; reason: string; bill: string | null }>;
      expect(skipped.find((s) => s.tenantId === waterTenantId)).toMatchObject({ reason: 'OTHER_BILL', bill: 'WATER' });
      expect((await smsRowsFor(rentTenantId)).length).toBe(before.rent + 1);
      expect((await smsRowsFor(bothTenantId)).length).toBe(before.both + 1);
      expect((await smsRowsFor(waterTenantId)).length).toBe(before.water);
      expect((await smsRowsFor(paidTenantId)).length).toBe(before.paid);
      expect((await smsRowsFor(phonelessTenantId)).length).toBe(before.phoneless);
    });

    it("audience WATER reminds water debtors only — the rent-only debtor hears nothing new", async () => {      const before = {
        rent: (await smsRowsFor(rentTenantId)).length,
        water: (await smsRowsFor(waterTenantId)).length,
        both: (await smsRowsFor(bothTenantId)).length,
        paid: (await smsRowsFor(paidTenantId)).length,
      };
      const res = await request(app)
        .post('/api/sms/reminders/bulk-arrears')
        .set(auth(adminToken))
        .send({ audience: 'WATER' });
      expect(res.status).toBe(201);
      expect(res.body.data.audience).toBe('WATER');
      expect(res.body.data.skippedOtherBill).toBeGreaterThanOrEqual(1);
      expect((await smsRowsFor(waterTenantId)).length).toBe(before.water + 1);
      expect((await smsRowsFor(bothTenantId)).length).toBe(before.both + 1);
      expect((await smsRowsFor(rentTenantId)).length).toBe(before.rent);
      expect((await smsRowsFor(paidTenantId)).length).toBe(before.paid);
    });

    it('send-money mode points at the dedicated money line with no account reference', async () => {
      // The operator collects by Send Money on a dedicated line while the
      // contact phone stays a different number: reminders must name the
      // money line and never mention an account.
      const setRes = await request(app)
        .put('/api/branding')
        .set(auth(adminToken))
        .send({ sendMoneyPhone: '0712000001', contactPhone: '0712000002', paybillEnabled: false });
      expect(setRes.status).toBe(200);
      try {
        const before = (await smsRowsFor(rentTenantId)).length;
        const res = await request(app)
          .post('/api/sms/reminders/bulk-arrears')
          .set(auth(adminToken))
          .send({ audience: 'RENT' });
        expect(res.status).toBe(201);
        const rows = await smsRowsFor(rentTenantId);
        expect(rows.length).toBe(before + 1);
        expect(rows[0].message).toContain('M-Pesa to 0712000001');
        expect(rows[0].message).not.toContain('0712000002');
        expect(rows[0].message).not.toContain('PayBill');
        expect(rows[0].message).not.toContain('account');
      } finally {
        await request(app).put('/api/branding').set(auth(adminToken)).send({ sendMoneyPhone: null, contactPhone: null });
      }
    });

    it('send-money mode falls back to the contact phone when no money line is set', async () => {
      const setRes = await request(app)
        .put('/api/branding')
        .set(auth(adminToken))
        .send({ sendMoneyPhone: null, contactPhone: '0712000003', paybillEnabled: false });
      expect(setRes.status).toBe(200);
      try {
        const before = (await smsRowsFor(rentTenantId)).length;
        const res = await request(app)
          .post('/api/sms/reminders/bulk-arrears')
          .set(auth(adminToken))
          .send({ audience: 'RENT' });
        expect(res.status).toBe(201);
        const rows = await smsRowsFor(rentTenantId);
        expect(rows.length).toBe(before + 1);
        expect(rows[0].message).toContain('M-Pesa to 0712000003');
        expect(rows[0].message).not.toContain('account');
      } finally {
        await request(app).put('/api/branding').set(auth(adminToken)).send({ contactPhone: null });
      }
    });
  });
});
