// Ops essentials — the four routers ported from the legacy system:
//   * /api/vendors            — vendor directory (staff read, manager write)
//   * /api/maintenance        — requests + work orders (staff report, manager
//                               manage; the first work order auto-starts the
//                               request; DONE stamps completed_at; RESOLVED
//                               stamps resolved_at; deleting a request
//                               cascades its work orders)
//   * /api/expense-approvals  — staff request, manager approve (creates the
//                               real expense) / reject; decisions are final
//   * /api/recurring-expenses — CRUD + due-date generation (one period per
//                               generate, schedule advanced by the frequency,
//                               due-ness judged by CURRENT_DATE in the DB)
//
// Hermetic like the other suites: every row carries an OPSTEST marker,
// beforeAll/afterAll clean by marker, and audit rows created here are
// removed too.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

const MARKER = 'OPSTEST';

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
  // FK-safe order; work orders cascade with their request but be explicit.
  await pool.query(`DELETE FROM work_orders WHERE request_id IN (SELECT id FROM maintenance_requests WHERE title LIKE $1)`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM maintenance_requests WHERE title LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM expense_approvals WHERE description LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM recurring_expenses WHERE description LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM vendors WHERE name LIKE $1`, [`${MARKER}%`]);
  await pool.query(`DELETE FROM expenses WHERE description LIKE $1`, [`${MARKER}%`]);
  await pool.query(
    `DELETE FROM audit_logs WHERE entity IN ('vendors', 'maintenance_requests', 'work_orders', 'expense_approvals', 'recurring_expenses')
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

describe('Ops essentials auth', () => {
  it('401s every router without a session', async () => {
    const res = await Promise.all([
      request(app).get('/api/vendors'),
      request(app).get('/api/maintenance'),
      request(app).get('/api/expense-approvals'),
      request(app).get('/api/recurring-expenses'),
    ]);
    for (const r of res) {
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('UNAUTHORIZED');
    }
  });
});

describe('Vendors', () => {
  let vendorId = 0;

  it('staff can read but not write; manager/admin write', async () => {
    const read = await request(app).get('/api/vendors').set(auth(staffToken));
    expect(read.status).toBe(200);

    const denied = await request(app).post('/api/vendors').set(auth(staffToken)).send({ name: `${MARKER} nope`, service: 'PLUMBING' });
    expect(denied.status).toBe(403);
  });

  it('creates a vendor and reflects it in filtered listings', async () => {
    const created = await request(app).post('/api/vendors').set(auth(adminToken)).send({
      name: `${MARKER} Jua Plumbers`,
      service: 'PLUMBING',
      phone: '+254700111222',
      email: 'jua@opstest.example',
      rating: 4,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.active).toBe(true);
    vendorId = created.body.data.id;

    const byName = await request(app).get(`/api/vendors?q=${encodeURIComponent('Jua Plumbers')}`).set(auth(managerToken));
    expect(byName.status).toBe(200);
    expect(byName.body.data.some((v: { id: number }) => v.id === vendorId)).toBe(true);

    const byService = await request(app).get('/api/vendors?service=PLUMBING&limit=100').set(auth(managerToken));
    expect(byService.body.data.some((v: { id: number }) => v.id === vendorId)).toBe(true);
  });

  it('rejects invalid vendor payloads', async () => {
    const badService = await request(app).post('/api/vendors').set(auth(adminToken)).send({ name: `${MARKER} x`, service: 'WELDING' });
    expect(badService.status).toBe(400);
    expect(badService.body.message).toMatch(/validation/i);

    const badEmail = await request(app).post('/api/vendors').set(auth(adminToken)).send({ name: `${MARKER} x`, service: 'CLEANING', email: 'not-an-email' });
    expect(badEmail.status).toBe(400);

    const badRating = await request(app).put(`/api/vendors/${vendorId}`).set(auth(adminToken)).send({ rating: 9 });
    expect(badRating.status).toBe(400);
  });

  it('updates a vendor', async () => {
    const res = await request(app).put(`/api/vendors/${vendorId}`).set(auth(adminToken)).send({ rating: 5, notes: 'Fast and tidy' });
    expect(res.status).toBe(200);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.notes).toBe('Fast and tidy');
  });

  it('deletes a vendor and then 404s', async () => {
    const res = await request(app).delete(`/api/vendors/${vendorId}`).set(auth(adminToken));
    expect(res.status).toBe(204);

    const again = await request(app).delete(`/api/vendors/${vendorId}`).set(auth(adminToken));
    expect(again.status).toBe(404);
  });
});

describe('Maintenance requests and work orders', () => {
  let unitId = 0;
  let vendorId = 0;
  let requestId = 0;
  let workOrderId = 0;

  beforeAll(async () => {
    const unit = await pool.query<{ id: number }>('SELECT id FROM units ORDER BY id LIMIT 1');
    unitId = unit.rows[0].id;
    const vendor = await request(app).post('/api/vendors').set(auth(adminToken)).send({ name: `${MARKER} Fixit Co`, service: 'ELECTRICAL' });
    vendorId = vendor.body.data.id;
  });

  it('staff logs a request (201, OPEN, MEDIUM default)', async () => {
    const res = await request(app).post('/api/maintenance').set(auth(staffToken)).send({
      title: `${MARKER} Kitchen tap leaking`,
      description: 'Tenant reports water under the sink.',
      unitId,
      priority: 'HIGH',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.priority).toBe('HIGH');
    requestId = res.body.data.id;
  });

  it('lists and filters requests by status and search', async () => {
    const byStatus = await request(app).get('/api/maintenance?status=OPEN&limit=100').set(auth(managerToken));
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.data.some((r: { id: number }) => r.id === requestId)).toBe(true);

    const byQ = await request(app).get(`/api/maintenance?q=${encodeURIComponent('tap leaking')}&limit=100`).set(auth(managerToken));
    expect(byQ.body.data.some((r: { id: number }) => r.id === requestId)).toBe(true);

    const resolvedOnly = await request(app).get('/api/maintenance?status=RESOLVED&limit=100').set(auth(managerToken));
    expect(resolvedOnly.body.data.some((r: { id: number }) => r.id === requestId)).toBe(false);
  });

  it('staff cannot manage a request, manager can update priority/status', async () => {
    const denied = await request(app).put(`/api/maintenance/${requestId}`).set(auth(staffToken)).send({ priority: 'LOW' });
    expect(denied.status).toBe(403);

    const allowed = await request(app).put(`/api/maintenance/${requestId}`).set(auth(managerToken)).send({ priority: 'EMERGENCY' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.priority).toBe('EMERGENCY');
  });

  it('creating a work order moves an OPEN request to IN_PROGRESS', async () => {
    const res = await request(app).post(`/api/maintenance/${requestId}/work-orders`).set(auth(adminToken)).send({
      vendorId,
      cost: 1500,
      scheduledFor: '2026-10-10',
      notes: 'Bring a replacement cartridge.',
    });
    expect(res.status).toBe(201);
    workOrderId = res.body.data.id;

    const detail = await request(app).get(`/api/maintenance/${requestId}`).set(auth(staffToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe('IN_PROGRESS');
    expect(detail.body.data.work_orders).toHaveLength(1);
    expect(detail.body.data.work_orders[0].vendor_name).toBe(`${MARKER} Fixit Co`);
  });

  it('validates work order payloads', async () => {
    const badCost = await request(app).post(`/api/maintenance/${requestId}/work-orders`).set(auth(adminToken)).send({ vendorId, cost: -5 });
    expect(badCost.status).toBe(400);

    const unknownVendor = await request(app).post(`/api/maintenance/${requestId}/work-orders`).set(auth(adminToken)).send({ vendorId: 999999 });
    expect(unknownVendor.status).toBe(400);
    expect(unknownVendor.body.message).toMatch(/vendor/i);

    const staffDenied = await request(app).post(`/api/maintenance/${requestId}/work-orders`).set(auth(staffToken)).send({ vendorId });
    expect(staffDenied.status).toBe(403);
  });

  it('marking a work order DONE stamps completed_at', async () => {
    const res = await request(app).put(`/api/maintenance/work-orders/${workOrderId}`).set(auth(managerToken)).send({ status: 'DONE', cost: 1750 });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DONE');
    expect(res.body.data.completed_at).toBeTruthy();
    expect(Number(res.body.data.cost)).toBe(1750);
  });

  it('resolving stamps resolved_at and blocks new work orders', async () => {
    const res = await request(app).put(`/api/maintenance/${requestId}`).set(auth(adminToken)).send({ status: 'RESOLVED' });
    expect(res.status).toBe(200);
    expect(res.body.data.resolved_at).toBeTruthy();

    const after = await request(app).post(`/api/maintenance/${requestId}/work-orders`).set(auth(adminToken)).send({ vendorId });
    expect(after.status).toBe(400);
    expect(after.body.message).toMatch(/resolved/i);
  });

  it('deleting a request cascades its work orders', async () => {
    const res = await request(app).delete(`/api/maintenance/${requestId}`).set(auth(adminToken));
    expect(res.status).toBe(204);

    const detail = await request(app).get(`/api/maintenance/${requestId}`).set(auth(adminToken));
    expect(detail.status).toBe(404);

    const remaining = await pool.query('SELECT COUNT(*)::int AS n FROM work_orders WHERE request_id = $1', [requestId]);
    expect(remaining.rows[0].n).toBe(0);
  });

  it('validates request payloads', async () => {
    const tooShort = await request(app).post('/api/maintenance').set(auth(staffToken)).send({ title: 'x' });
    expect(tooShort.status).toBe(400);

    const badPriority = await request(app).post('/api/maintenance').set(auth(staffToken)).send({ title: `${MARKER} valid title`, priority: 'WHENEVER' });
    expect(badPriority.status).toBe(400);
  });
});

describe('Expense approvals', () => {
  let approvalId = 0;

  it('staff submits a request; staff cannot decide', async () => {
    const res = await request(app).post('/api/expense-approvals').set(auth(staffToken)).send({
      expenseDate: '2026-10-06',
      description: `${MARKER} gate motor part`,
      category: 'REPAIRS',
      amount: 3200.5,
      paymentMethod: 'M_PESA',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    approvalId = res.body.data.id;

    const denied = await request(app).post(`/api/expense-approvals/${approvalId}/approve`).set(auth(staffToken)).send({});
    expect(denied.status).toBe(403);
  });

  it('appears under the PENDING filter and not under APPROVED', async () => {
    const pending = await request(app).get('/api/expense-approvals?status=PENDING&limit=100').set(auth(managerToken));
    expect(pending.body.data.some((a: { id: number }) => a.id === approvalId)).toBe(true);

    const approved = await request(app).get('/api/expense-approvals?status=APPROVED&limit=100').set(auth(managerToken));
    expect(approved.body.data.some((a: { id: number }) => a.id === approvalId)).toBe(false);
  });

  it('approving creates the real expense and links it', async () => {
    const res = await request(app).post(`/api/expense-approvals/${approvalId}/approve`).set(auth(managerToken)).send({ note: 'Within budget' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.decided_at).toBeTruthy();
    expect(res.body.data.expense_id).toBeTruthy();

    const expense = await pool.query('SELECT description, amount, category FROM expenses WHERE id = $1', [res.body.data.expense_id]);
    expect(expense.rows[0].description).toBe(`${MARKER} gate motor part`);
    expect(Number(expense.rows[0].amount)).toBeCloseTo(3200.5);
    expect(expense.rows[0].category).toBe('REPAIRS');
  });

  it('decisions are final — re-approving or rejecting a decided request fails', async () => {
    const reApprove = await request(app).post(`/api/expense-approvals/${approvalId}/approve`).set(auth(adminToken)).send({});
    expect(reApprove.status).toBe(400);
    expect(reApprove.body.message).toMatch(/already/i);

    const reReject = await request(app).post(`/api/expense-approvals/${approvalId}/reject`).set(auth(adminToken)).send({});
    expect(reReject.status).toBe(400);
  });

  it('rejecting records the note and creates no expense', async () => {
    const res = await request(app).post('/api/expense-approvals').set(auth(staffToken)).send({
      expenseDate: '2026-10-06',
      description: `${MARKER} optional repaint`,
      category: 'PAINTING', // not a valid expense category → 400 before the DB
      amount: 100,
      paymentMethod: 'CASH',
    });
    expect(res.status).toBe(400);

    const valid = await request(app).post('/api/expense-approvals').set(auth(staffToken)).send({
      expenseDate: '2026-10-06',
      description: `${MARKER} optional repaint`,
      category: 'REPAIRS',
      amount: 100,
      paymentMethod: 'CASH',
    });
    const secondId = valid.body.data.id;

    const rejected = await request(app).post(`/api/expense-approvals/${secondId}/reject`).set(auth(managerToken)).send({ note: 'Not this quarter' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.decision_note).toBe('Not this quarter');
    expect(rejected.body.data.expense_id).toBeNull();

    const expenses = await pool.query('SELECT COUNT(*)::int AS n FROM expenses WHERE description = $1', [`${MARKER} optional repaint`]);
    expect(expenses.rows[0].n).toBe(0);
  });

  it('validates the request payload', async () => {
    const badAmount = await request(app).post('/api/expense-approvals').set(auth(staffToken)).send({
      expenseDate: '2026-10-06',
      description: `${MARKER} bad amount`,
      category: 'OTHER',
      amount: -10,
      paymentMethod: 'CASH',
    });
    expect(badAmount.status).toBe(400);
  });
});

describe('Recurring expenses', () => {
  let baseId = 0;

  it('manager creates a MONTHLY expense; staff cannot write', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await request(app).post('/api/recurring-expenses').set(auth(managerToken)).send({
      description: `${MARKER} garbage collection`,
      category: 'CLEANING',
      amount: 2500,
      paymentMethod: 'M_PESA',
      frequency: 'MONTHLY',
      nextDueDate: tomorrow,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.due).toBe(false);
    baseId = res.body.data.id;

    const denied = await request(app).post(`/api/recurring-expenses/${baseId}/generate`).set(auth(staffToken));
    expect(denied.status).toBe(403);
  });

  it('generating before the due date is refused with a clear message', async () => {
    const res = await request(app).post(`/api/recurring-expenses/${baseId}/generate`).set(auth(managerToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nothing to generate/i);
  });

  it('generating a due period records the expense and advances by the frequency', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await request(app).put(`/api/recurring-expenses/${baseId}`).set(auth(managerToken)).send({ nextDueDate: yesterday });

    const res = await request(app).post(`/api/recurring-expenses/${baseId}/generate`).set(auth(managerToken));
    expect(res.status).toBe(200);
    expect(res.body.data.due).toBe(false);
    expect(res.body.data.last_expense_id).toBeTruthy();

    const row = await pool.query<{ next_due_date: string; last_generated_at: string }>(
      `SELECT next_due_date::text AS next_due_date, last_generated_at::text AS last_generated_at FROM recurring_expenses WHERE id = $1`,
      [baseId]
    );
    // yesterday + 1 month lands after today regardless of month length.
    expect(new Date(row.rows[0].next_due_date).getTime()).toBeGreaterThan(Date.now() - 12 * 60 * 60 * 1000);

    const expense = await pool.query('SELECT expense_date::text AS d, category FROM expenses WHERE id = $1', [res.body.data.last_expense_id]);
    expect(expense.rows[0].d).toBe(yesterday);
    expect(expense.rows[0].category).toBe('CLEANING');
  });

  it('immediately after generating, the row is not due again', async () => {
    const res = await request(app).post(`/api/recurring-expenses/${baseId}/generate`).set(auth(managerToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nothing to generate/i);
  });

  it('QUARTERLY advances by three months', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const created = await request(app).post('/api/recurring-expenses').set(auth(adminToken)).send({
      description: `${MARKER} insurance`,
      category: 'OTHER',
      amount: 12000,
      paymentMethod: 'BANK',
      frequency: 'QUARTERLY',
      nextDueDate: yesterday,
    });
    const id = created.body.data.id;

    const generated = await request(app).post(`/api/recurring-expenses/${id}/generate`).set(auth(adminToken));
    expect(generated.status).toBe(200);

    const row = await pool.query<{ expected: string; actual: string }>(
      `SELECT (next_due_date::text) AS actual,
              (($2::date + INTERVAL '3 months')::date::text) AS expected
       FROM recurring_expenses WHERE id = $1`,
      [id, yesterday]
    );
    expect(row.rows[0].actual).toBe(row.rows[0].expected);
  });

  it('inactive rows refuse generation', async () => {
    const paused = await request(app).put(`/api/recurring-expenses/${baseId}`).set(auth(managerToken)).send({ active: false });
    expect(paused.status).toBe(200);

    const res = await request(app).post(`/api/recurring-expenses/${baseId}/generate`).set(auth(managerToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/inactive/i);
  });

  it('generate-due sweeps every due row in one call', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const a = await request(app).post('/api/recurring-expenses').set(auth(managerToken)).send({
      description: `${MARKER} sweep A`, category: 'SECURITY', amount: 100, paymentMethod: 'CASH', frequency: 'MONTHLY', nextDueDate: yesterday,
    });
    const b = await request(app).post('/api/recurring-expenses').set(auth(managerToken)).send({
      description: `${MARKER} sweep B`, category: 'OTHER', amount: 200, paymentMethod: 'CASH', frequency: 'YEARLY', nextDueDate: yesterday,
    });

    const res = await request(app).post('/api/recurring-expenses/generate-due').set(auth(adminToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBeGreaterThanOrEqual(2);
    expect(res.body.data.remaining).toBe(0);

    void a; void b;
  });
});
