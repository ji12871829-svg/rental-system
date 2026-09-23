// Integration tests for the M-Pesa smart-allocation flow: a payment that
// "just arrives" (via PayHero poll or C2B callback) must be identified and
// booked onto the tenant's OLDEST rent arrears automatically, with a receipt
// and prepared receipt SMS per allocated month.
//
// Suite-ordering independence (the occupancy suite's rule): the expected
// arrears are READ at runtime via rentArrearsForYear (the same function the
// pipeline uses) instead of hardcoding fixture months — other suites (e.g.
// mpesaCallbackGate) legitimately post payments without cleanup, and this
// suite must not care whether it runs first or last. Tests only assert
// RELATIVE facts: oldest month first, full months cleared in order, surplus
// riding as credit.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query } from '../../src/config/db';
import { rentArrearsForYear } from '../../src/services/mpesaService';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

async function tenantIdForUnit(unitNumber: string): Promise<number> {
  const rows = await query<{ tenant_id: number }>(
    `SELECT t.id AS tenant_id FROM tenants t JOIN units u ON u.id = t.unit_id
     WHERE UPPER(TRIM(u.unit_number)) = $1 AND t.status = 'ACTIVE' LIMIT 1`,
    [unitNumber]
  );
  if (!rows[0]) throw new Error(`no active tenant for unit ${unitNumber}`);
  return rows[0].tenant_id;
}

/** Rent payments created by a C2B confirmation, keyed off its TransID note. */
async function paymentsFromTrans(transId: string): Promise<Array<{ id: number; billing_month: number; billing_year: number; amount: string; notes: string | null; receipt_number: string | null }>> {
  const rows = await query<{ id: number; billing_month: number; billing_year: number; amount: string; notes: string | null; receipt_number: string | null }>(
    `SELECT rp.id, rp.billing_month, rp.billing_year, rp.amount::text AS amount, rp.notes, rp.receipt_number
     FROM rent_payments rp
     WHERE rp.payment_reference = $1
     ORDER BY rp.billing_month, rp.id`,
    [transId]
  );
  return rows;
}

async function smsRowsForPayments(paymentIds: number[]): Promise<Array<{ id: number; status: string; receipt_id: number | null }>> {
  if (paymentIds.length === 0) return [];
  const rows = await query<{ id: number; status: string; receipt_id: number | null }>(
    `SELECT s.id, s.status, s.receipt_id FROM sms_notifications s
     WHERE s.receipt_id IN (
       SELECT r.id FROM receipts r
       WHERE r.receipt_number IN (SELECT receipt_number FROM rent_payments WHERE id = ANY($1::int[]) AND receipt_number IS NOT NULL)
     )`,
    [paymentIds]
  );
  return rows;
}

async function cleanup(transIds: string[]): Promise<void> {
  for (const transId of transIds) {
    await query(
      `DELETE FROM sms_notifications WHERE receipt_id IN (
         SELECT r.id FROM receipts r
         WHERE r.receipt_number IN (SELECT receipt_number FROM rent_payments WHERE payment_reference = $1 AND receipt_number IS NOT NULL)
       )`,
      [transId]
    );
    await query(
      `DELETE FROM receipts WHERE id IN (
         SELECT r.id FROM receipts r
         WHERE r.receipt_number IN (SELECT receipt_number FROM rent_payments WHERE payment_reference = $1 AND receipt_number IS NOT NULL)
       )`,
      [transId]
    );
    await query(`UPDATE mpesa_transactions SET rent_payment_id = NULL WHERE rent_payment_id IN (SELECT id FROM rent_payments WHERE payment_reference = $1)`, [transId]);
    await query(`DELETE FROM rent_payments WHERE payment_reference = $1`, [transId]);
    await query(`DELETE FROM mpesa_transactions WHERE transaction_id = $1`, [transId]);
  }
}

function confirmBody(transId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    TransID: transId,
    TransAmount: '4000',
    BusinessShortCode: '174379', // matches MPESA_SHORTCODE in backend/.env (test env loads it)
    BillRefNumber: '1',
    TransTime: '20260920120000',
    MSISDN: '254700000999',
    ...overrides,
  };
}

describe('M-Pesa auto-allocation (rent sent without the portal)', () => {
  const created: string[] = [];

  afterEach(async () => {
    await cleanup([...created]);
    created.length = 0;
  });

  it('books an exact-reference payment onto the OLDEST arrears month with receipt + SMS row', async () => {
    const tenantId = await tenantIdForUnit('1');
    const arrears = await rentArrearsForYear(tenantId, 2026);
    expect(arrears.length).toBeGreaterThan(0); // fixture tenant carries arrears
    const oldest = arrears[0];
    const transId = `ALLOC${Date.now()}`;
    created.push(transId);

    const res = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send(confirmBody(transId, { TransAmount: String(oldest.balance) }));
    expect(res.status).toBe(200);
    expect(res.body.ResultCode).toBe(0);

    const payments = await paymentsFromTrans(transId);
    expect(payments).toHaveLength(1);
    expect(payments[0].billing_month).toBe(oldest.month);
    expect(payments[0].billing_year).toBe(2026);
    expect(Number(payments[0].amount)).toBe(oldest.balance);
    expect(payments[0].receipt_number).not.toBeNull();
    expect(payments[0].notes ?? '').toContain(`Allocated to ${oldest.monthName} 2026`);

    const stored = await query<{ status: string }>(`SELECT status FROM mpesa_transactions WHERE transaction_id = $1`, [transId]);
    expect(stored[0]?.status).toBe('POSTED');

    // A prepared receipt SMS exists for the slice (status PENDING — the test
    // env never auto-sends; prod dispatches via dispatchAutoSend).
    const sms = await smsRowsForPayments([payments[0].id]);
    expect(sms.length).toBe(1);
    expect(sms[0].status).toBe('PENDING');
  });

  it('identifies the tenant by SENDER PHONE when the reference names no unit', async () => {
    // Peter's phone is +254711000001 in the fixture; send from 254711000001.
    const tenantId = await tenantIdForUnit('1');
    const arrears = await rentArrearsForYear(tenantId, 2026);
    const oldest = arrears[0];
    const transId = `PHON${Date.now()}`;
    created.push(transId);

    const res = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send(confirmBody(transId, {
        TransAmount: String(oldest.balance),
        BillRefNumber: 'WRONGREF',
        MSISDN: '254711000001',
      }));
    expect(res.status).toBe(200);

    const payments = await paymentsFromTrans(transId);
    expect(payments).toHaveLength(1);
    expect(payments[0].billing_month).toBe(oldest.month);
    expect(payments[0].notes ?? '').toContain('matched by sender phone number');

    const stored = await query<{ status: string }>(`SELECT status FROM mpesa_transactions WHERE transaction_id = $1`, [transId]);
    expect(stored[0]?.status).toBe('POSTED');
  });

  it('splits a payment larger than one month across months, oldest first, one receipt+SMS each', async () => {
    const tenantId = await tenantIdForUnit('1');
    const arrears = await rentArrearsForYear(tenantId, 2026);
    expect(arrears.length).toBeGreaterThanOrEqual(2); // need two months to split across
    const [first, second] = arrears;
    const total = first.balance + second.balance;
    const transId = `SPLIT${Date.now()}`;
    created.push(transId);

    const res = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send(confirmBody(transId, { TransAmount: String(total) }));
    expect(res.status).toBe(200);

    const payments = await paymentsFromTrans(transId);
    expect(payments).toHaveLength(2);
    expect(payments[0].billing_month).toBe(first.month);
    expect(Number(payments[0].amount)).toBe(first.balance);
    expect(payments[1].billing_month).toBe(second.month);
    expect(Number(payments[1].amount)).toBe(second.balance);
    expect(payments[0].receipt_number).not.toBeNull();
    expect(payments[1].receipt_number).not.toBeNull();
    expect(payments[0].receipt_number).not.toBe(payments[1].receipt_number);

    const sms = await smsRowsForPayments(payments.map((p) => p.id));
    expect(sms.length).toBe(2);
  });

  it('rides the surplus as a credit on the transaction month when all arrears are cleared', async () => {
    // Amina (unit 24, rent 11,000): pay every arrears month plus 1,500 —
    // the surplus must ride as a credit slice on the transaction month.
    const tenantId = await tenantIdForUnit('24');
    const arrears = await rentArrearsForYear(tenantId, 2026);
    expect(arrears.length).toBeGreaterThan(0);
    const arrearsTotal = arrears.reduce((s, m) => s + m.balance, 0);
    const surplus = 1500;
    const transMonth = 9; // TransTime 202609…
    const transId = `CRDT${Date.now()}`;
    created.push(transId);

    const res = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send(confirmBody(transId, {
        TransAmount: String(arrearsTotal + surplus),
        BillRefNumber: '24',
        TransTime: `20260920120000`,
      }));
    expect(res.status).toBe(200);

    const payments = await paymentsFromTrans(transId);
    expect(payments.length).toBe(arrears.length + 1); // one slice per arrears month + credit
    const total = payments.reduce((s, p) => s + Number(p.amount), 0);
    expect(total).toBe(arrearsTotal + surplus);
    // The credit slice shares the transaction's month; find it by amount and
    // verify the arrears slices cover exactly the pre-read arrears months.
    const credit = payments.find((p) => Number(p.amount) === surplus);
    expect(credit).toBeDefined();
    expect(credit!.billing_month).toBe(transMonth);
    expect(credit!.notes ?? '').toContain('Allocated to September 2026.');
    const arrearsSlices = payments.filter((p) => p.id !== credit!.id);
    expect(arrearsSlices.map((p) => p.billing_month).sort((a, b) => a - b))
      .toEqual(arrears.map((m) => m.month).sort((a, b) => a - b));
    for (const slice of arrearsSlices) {
      const expected = arrears.find((m) => m.month === slice.billing_month);
      expect(Number(slice.amount)).toBe(expected!.balance);
    }
  });

  it('leaves payments UNMATCHED (manual review) when nothing identifies the sender', async () => {
    const transId = `UNKN${Date.now()}`;
    created.push(transId);

    const res = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send(confirmBody(transId, { BillRefNumber: 'WHOAMI', MSISDN: '254700000999' }));
    expect(res.status).toBe(200);
    expect(res.body.ResultDesc).toContain('manual review');

    const payments = await paymentsFromTrans(transId);
    expect(payments).toHaveLength(0);
    const stored = await query<{ status: string; error_message: string | null }>(
      `SELECT status, error_message FROM mpesa_transactions WHERE transaction_id = $1`,
      [transId]
    );
    expect(stored[0]?.status).toBe('UNMATCHED');
    expect(stored[0]?.error_message ?? '').toContain('WHOAMI');
  });

  it('never phone-matches WATER payments — wrong unit reference stays UNMATCHED', async () => {
    // Grace Njeri (unit 15) has a known phone; a water payment with a garbage
    // reference from her phone must NOT post against her.
    const transId = `WTRU${Date.now()}`;
    created.push(transId);

    const res = await request(app)
      .post('/api/mpesa/c2b/confirm')
      .send(confirmBody(transId, {
        BillRefNumber: 'NOWHERE-WATER',
        MSISDN: '254711000004',
        TransAmount: '1000',
      }));
    expect(res.status).toBe(200);

    const waterRows = await query<{ id: number }>(
      `SELECT wp.id FROM water_payments wp JOIN mpesa_transactions mt ON mt.water_payment_id = wp.id WHERE mt.transaction_id = $1`,
      [transId]
    );
    expect(waterRows).toHaveLength(0);
    const stored = await query<{ status: string }>(`SELECT status FROM mpesa_transactions WHERE transaction_id = $1`, [transId]);
    expect(stored[0]?.status).toBe('UNMATCHED');
  });
});
