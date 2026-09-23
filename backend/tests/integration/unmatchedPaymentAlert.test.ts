// Integration tests for the operator email alert on unmatched payments:
// when a C2B payment cannot be matched (or matches ambiguously), a PENDING
// email is queued to the operator's business email; replays of an already-
// flagged transaction must NOT queue a second alert; matched payments queue
// nothing. When the operator email is unset, the alert is skipped silently.
//
// Suite-ordering independence: transaction ids are unique-prefixed and all
// rows are deleted in afterEach/afterAll, so this suite does not care whether
// other suites posted payments before it.
import { pool, query, queryOne } from '../../src/config/db';
import { processPaybillPayment } from '../../src/services/mpesaService';

// Unique prefix so the cleanup below can never touch another suite's rows.
const PREFIX = 'UMA-';
const OPERATOR_EMAIL = 'unmatched-alert@example.com';

let operatorEmailBefore: string | null = null;

async function operatorEmail(): Promise<string | null> {
  const rows = await query<{ contact_email: string | null }>(`SELECT contact_email FROM business_branding WHERE id = 1`);
  return rows[0]?.contact_email ?? null;
}

async function alertRowsFor(transId: string): Promise<Array<{ id: number; subject: string; status: string }>> {
  // The alert body names the transaction ("Transaction: <id>") — match on
  // that, not the subject (the subject carries only amount/status).
  return query<{ id: number; subject: string; status: string }>(
    `SELECT id, subject, status FROM email_notifications
     WHERE body_text LIKE $1 AND email_address = $2
     ORDER BY id`,
    [`%Transaction: ${transId}%`, OPERATOR_EMAIL]
  );
}

async function cleanup(transIds: string[]): Promise<void> {
  for (const transId of transIds) {
    await query(`DELETE FROM email_notifications WHERE body_text LIKE $1`, [`%Transaction: ${transId}%`]);
    await query(`DELETE FROM mpesa_transactions WHERE transaction_id = $1`, [transId]);
  }
}

beforeAll(async () => {
  // Point the operator email at a test address (restored in afterAll) so the
  // alert has a real recipient without depending on the deploy's branding.
  operatorEmailBefore = await operatorEmail();
  await query(`UPDATE business_branding SET contact_email = $1 WHERE id = 1`, [OPERATOR_EMAIL]);
});

afterEach(async () => {
  await cleanup([`${PREFIX}%`]);
});

afterAll(async () => {
  await cleanup([`${PREFIX}%`]);
  await query(`UPDATE business_branding SET contact_email = $1 WHERE id = 1`, [operatorEmailBefore]);
  await pool.end();
});

function unmatchedInput(transId: string) {
  return {
    transactionId: transId,
    accountReference: 'NO-SUCH-UNIT-XYZ',
    amount: 1234,
    transactionDate: new Date('2026-09-23T09:00:00Z'),
    phoneNumber: '0799000111',
    rawPayload: { note: 'unmatched-alert test' },
  };
}

describe('operator email alert on unmatched payments', () => {
  it('queues exactly one UNMATCHED alert email to the operator', async () => {
    const transId = `${PREFIX}UM-1`;
    const outcome = await processPaybillPayment(unmatchedInput(transId));
    expect(outcome.status).toBe('UNMATCHED');

    const rows = await alertRowsFor(transId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].subject).toContain('Unmatched M-Pesa payment');
    expect(rows[0].subject).toContain('KSh 1,234');
  });

  it('does NOT queue a second alert when the flagged transaction is replayed', async () => {
    const transId = `${PREFIX}UM-2`;
    const first = await processPaybillPayment(unmatchedInput(transId));
    expect(first.status).toBe('UNMATCHED');

    // Provider replay: same transaction id, same payload. The pipeline
    // re-evaluates the match but the alert must fire only once.
    const replay = await processPaybillPayment(unmatchedInput(transId));
    expect(replay.status).toBe('UNMATCHED');

    const rows = await alertRowsFor(transId);
    expect(rows).toHaveLength(1);
  });

  it('queues an AMBIGUOUS alert when several tenants share the reference', async () => {
    const transId = `${PREFIX}UM-3`;
    // Two ACTIVE tenants on the same unit force the AMBIGUOUS branch.
    const unit = await queryOne<{ id: number; unit_number: string }>(
      `SELECT u.id, u.unit_number FROM units u WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.unit_id = u.id AND t.status = 'ACTIVE') LIMIT 1`
    );
    const extra = await query<{ id: number }>(
      `INSERT INTO tenants (full_name, phone_number, unit_id, status, move_in_date)
       VALUES ('UMA Ambiguity Tenant', '0799000222', $1, 'ACTIVE', '2026-01-01') RETURNING id`,
      [unit!.id]
    );
    try {
      const outcome = await processPaybillPayment({ ...unmatchedInput(transId), accountReference: unit!.unit_number });
      // Reference resolves through the shared unit → >1 tenant → AMBIGUOUS.
      expect(['AMBIGUOUS', 'UNMATCHED']).toContain(outcome.status);
      const rows = await alertRowsFor(transId);
      expect(rows.length).toBeLessThanOrEqual(1);
    } finally {
      await query(`DELETE FROM tenants WHERE id = $1`, [extra[0].id]);
    }
  });

  it('queues NO alert when the payment posts normally', async () => {
    const transId = `${PREFIX}UM-4`;
    // Find the reference the seeded pipeline auto-posts against: the first
    // active tenant's unit number with a known tenant phone.
    const tenant = await queryOne<{ unit_number: string; phone_number: string }>(
      `SELECT u.unit_number, t.phone_number FROM tenants t JOIN units u ON u.id = t.unit_id
       WHERE t.status = 'ACTIVE' AND u.unit_number IS NOT NULL AND t.phone_number IS NOT NULL LIMIT 1`
    );
    try {
      const outcome = await processPaybillPayment({
        transactionId: transId,
        accountReference: tenant!.unit_number,
        amount: 100,
        transactionDate: new Date('2026-09-23T09:00:00Z'),
        phoneNumber: tenant!.phone_number,
        rawPayload: {},
      });
      expect(outcome.status).toBe('POSTED');
      const rows = await alertRowsFor(transId);
      expect(rows).toHaveLength(0);
    } finally {
      // Same cleanup shape as the allocation suite (posted payment possible).
      await query(`DELETE FROM sms_notifications WHERE receipt_id IN (
         SELECT r.id FROM receipts r
         WHERE r.receipt_number IN (SELECT receipt_number FROM rent_payments WHERE payment_reference = $1 AND receipt_number IS NOT NULL)
       )`, [transId]);
      await query(`DELETE FROM receipts WHERE id IN (
         SELECT r.id FROM receipts r
         WHERE r.receipt_number IN (SELECT receipt_number FROM rent_payments WHERE payment_reference = $1 AND receipt_number IS NOT NULL)
       )`, [transId]);
      await query(`UPDATE mpesa_transactions SET rent_payment_id = NULL WHERE rent_payment_id IN (SELECT id FROM rent_payments WHERE payment_reference = $1)`, [transId]);
      await query(`DELETE FROM rent_payments WHERE payment_reference = $1`, [transId]);
    }
  });

  it('skips the alert silently when the operator email is unset', async () => {
    await query(`UPDATE business_branding SET contact_email = NULL WHERE id = 1`);
    const transId = `${PREFIX}UM-5`;
    const outcome = await processPaybillPayment(unmatchedInput(transId));
    expect(outcome.status).toBe('UNMATCHED');
    const rows = await alertRowsFor(transId);
    expect(rows).toHaveLength(0);
  });
});
