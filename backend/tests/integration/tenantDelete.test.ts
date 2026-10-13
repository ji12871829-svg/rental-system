// DELETE /api/tenants/:id — the hard delete has two obligations beyond
// dropping the row:
//
//   1. REFUSE a tenant that has payment history (TENANT_HAS_HISTORY) —
//      money rows must outlive the tenant record.
//   2. FREE the unit the tenant held. The delete path only issued
//      `DELETE FROM tenants`, while every other path that ends a tenancy
//      (updateTenant re-assignment, moveOutTenant) also stamped
//      units.occupancy_status = 'VACANT'. Skipping it left a ghost:
//      OCCUPIED with tenant_id NULL, which blocks re-letting the room.
//
// Obligation 2 has a trap: a MOVED_OUT tenant keeps its unit_id after the
// room has been re-let to somebody new. Deleting that stale row must NOT
// vacate the unit the current tenant is living in — so the free only happens
// when no other ACTIVE tenant still holds the unit.
//
// Sequential within the file (jest --runInBand): test 2 depends on the
// payment test 1 created, test 3 reuses the unit test 2 freed.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

let adminToken = '';
let staffToken = '';
let unitId = 0;

// Test 1+2: created with payment history, then deleted for real.
let guardedTenantId = 0;
let guardedPaymentId = 0;
// Test 3: the stale MOVED_OUT row and the tenant who re-let the room.
let staleTenantId = 0;
let sittingTenantId = 0;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

async function occupancy(): Promise<string> {
  const res = await request(app).get(`/api/units/${unitId}`).set(auth(adminToken));
  expect(res.status).toBe(200);
  return res.body.data.occupancy_status;
}

// Any genuinely vacant unit works — nothing under test depends on which one,
// only that it starts free and that we hand it back.
async function findVacantUnit(): Promise<{ id: number }> {
  const res = await request(app)
    .get('/api/units?limit=100&occupancyStatus=VACANT')
    .set(auth(adminToken));
  expect(res.status).toBe(200);
  const unit = res.body.data[0];
  if (!unit) throw new Error('no vacant unit available');
  return unit;
}

async function createTenant(fullName: string): Promise<number> {
  const res = await request(app)
    .post('/api/tenants')
    .set(auth(adminToken))
    .send({ fullName, unitId, moveInDate: '2026-10-01', securityDeposit: 0 });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

// FK-safe order, run even on failure so one broken assertion cannot poison
// the rest of the suite (payment → receipts minted by it → tenants → unit).
async function cleanup(): Promise<void> {
  if (guardedPaymentId) {
    await pool.query('DELETE FROM rent_payments WHERE id = $1', [guardedPaymentId]).catch(() => {});
  }
  await pool.query(
    `DELETE FROM tenants WHERE id = ANY($1::int[])`,
    [[guardedTenantId, staleTenantId, sittingTenantId].filter(Boolean)]
  ).catch(() => {});
  if (unitId) {
    await pool.query(`UPDATE units SET occupancy_status = 'VACANT' WHERE id = $1`, [unitId]).catch(() => {});
  }
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
  staffToken = await login('staff@rpms.local', 'Staff@2026!');

  const unit = await findVacantUnit();
  unitId = unit.id;
  guardedTenantId = await createTenant('Delete Guard Tenant');
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('DELETE /api/tenants/:id', () => {
  it('refuses a tenant that has payment history, leaving tenant and unit intact', async () => {
    const pay = await request(app)
      .post('/api/rent/payments')
      .set(auth(staffToken))
      .send({
        tenantId: guardedTenantId,
        paymentDate: '2026-10-02',
        billingMonth: 10,
        billingYear: 2026,
        amount: 3000,
        paymentMethod: 'CASH',
      });
    expect(pay.status).toBe(201);
    // POST /api/rent/payments returns the ledger row at data.payment
    // (receipt/expectedRent/sms/email ride alongside it).
    guardedPaymentId = pay.body.data.payment.id;
    expect(guardedPaymentId).toBeGreaterThan(0);

    const del = await request(app).delete(`/api/tenants/${guardedTenantId}`).set(auth(adminToken));
    expect(del.status).toBe(409);
    expect(del.body.error).toBe('TENANT_HAS_HISTORY');

    const still = await request(app).get(`/api/tenants/${guardedTenantId}`).set(auth(adminToken));
    expect(still.status).toBe(200);
    expect(await occupancy()).toBe('OCCUPIED');
  });

  it('frees the unit once the payment-free tenant is deleted', async () => {
    // Clear the history test 1 made — the guard must be the only reason the
    // earlier delete was refused, not a permanent lock.
    const pay = await request(app)
      .delete(`/api/rent/payments/${guardedPaymentId}`)
      .set(auth(adminToken));
    expect(pay.status).toBe(204);

    const del = await request(app).delete(`/api/tenants/${guardedTenantId}`).set(auth(adminToken));
    expect(del.status).toBe(204);

    const gone = await request(app).get(`/api/tenants/${guardedTenantId}`).set(auth(adminToken));
    expect(gone.status).toBe(404);

    // The regression: the row was deleted but units.occupancy_status stayed
    // OCCUPIED with no tenant holding it — a ghost room nobody can let.
    const unit = await request(app).get(`/api/units/${unitId}`).set(auth(adminToken));
    expect(unit.status).toBe(200);
    expect(unit.body.data.occupancy_status).toBe('VACANT');
    expect(unit.body.data.tenant_id).toBeNull();
    expect(unit.body.data.tenant_name).toBeNull();
  });

  it('does not vacate a re-let unit when the stale moved-out tenant is deleted', async () => {
    // Move-out frees the room, a new tenant takes it (unit OCCUPIED again),
    // then the old MOVED_OUT row — which still carries unit_id — is deleted.
    staleTenantId = await createTenant('Delete Stale Tenant');
    const out = await request(app)
      .post(`/api/tenants/${staleTenantId}/move-out`)
      .set(auth(adminToken))
      .send({ moveOutDate: '2026-10-05' });
    expect(out.status).toBe(200);
    expect(await occupancy()).toBe('VACANT');

    sittingTenantId = await createTenant('Delete Sitting Tenant');
    expect(await occupancy()).toBe('OCCUPIED');

    const del = await request(app).delete(`/api/tenants/${staleTenantId}`).set(auth(adminToken));
    expect(del.status).toBe(204);

    // Naive "always VACANT" would evict the sitting tenant's occupancy here.
    expect(await occupancy()).toBe('OCCUPIED');
    const unit = await request(app).get(`/api/units/${unitId}`).set(auth(adminToken));
    expect(unit.body.data.tenant_id).toBe(sittingTenantId);

    const sitting = await request(app).get(`/api/tenants/${sittingTenantId}`).set(auth(adminToken));
    expect(sitting.status).toBe(200);
    expect(sitting.body.data.status).toBe('ACTIVE');
  });
});
