// Integration tests for the stale-unmatched escalation job: a payment that
// sits UNMATCHED/AMBIGUOUS for over STALE_THRESHOLD_MINUTES is escalated to
// the operator by email — exactly once per transaction, never after
// resolution, and only when the operator email is configured.
//
// The job exposes runStaleUnmatchedAlertPass (@public) so tests drive single
// passes instead of waiting on the 5-minute interval. Rows are created with
// backdated created_at and cleaned up completely, so suite ordering with the
// other mpesa suites cannot affect these tests.
import { pool, query, queryOne } from '../../src/config/db';
import { runStaleUnmatchedAlertPass, STALE_THRESHOLD_MINUTES } from '../../src/services/staleUnmatchedAlertJob';

const PREFIX = 'STALE-';
const OPERATOR_EMAIL = 'stale-alert@example.com';

let operatorEmailBefore: string | null = null;

async function insertStale(transId: string, status: 'UNMATCHED' | 'AMBIGUOUS', ageMinutes: number): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO mpesa_transactions
       (source, transaction_id, account_reference, amount, transaction_date, phone_number, payment_kind, raw_payload, status, error_message, created_at)
     VALUES ('C2B', $1, 'NO-SUCH-UNIT', 2200, NOW() - ($2 || ' minutes')::interval, '0799000333', 'RENT', '{}'::jsonb, $3, 'No active tenant matched unit reference NO-SUCH-UNIT.', NOW() - ($2 || ' minutes')::interval)
     RETURNING id`,
    [transId, String(ageMinutes), status]
  );
  return rows[0].id;
}

async function alertCount(transId: string): Promise<number> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM email_notifications
     WHERE body_text LIKE $1 AND email_address = $2`,
    [`%Transaction: ${transId}%`, OPERATOR_EMAIL]
  );
  return rows.length;
}

async function cleanup(transIds: string[]): Promise<void> {
  for (const transId of transIds) {
    await query(`DELETE FROM email_notifications WHERE body_text LIKE $1`, [`%Transaction: ${transId}%`]);
    await query(`DELETE FROM mpesa_transactions WHERE transaction_id = $1`, [transId]);
  }
}

beforeAll(async () => {
  const before = await queryOne<{ contact_email: string | null }>(`SELECT contact_email FROM business_branding WHERE id = 1`);
  operatorEmailBefore = before?.contact_email ?? null;
  await query(`UPDATE business_branding SET contact_email = $1 WHERE id = 1`, [OPERATOR_EMAIL]);
});

afterAll(async () => {
  await query(`UPDATE business_branding SET contact_email = $1 WHERE id = 1`, [operatorEmailBefore]);
  await pool.end();
});

describe('stale-unmatched escalation job', () => {
  it('uses a 60-minute threshold', () => {
    expect(STALE_THRESHOLD_MINUTES).toBe(60);
  });

  it('escalates a payment stale beyond the threshold exactly once across passes', async () => {
    const transId = `${PREFIX}S1`;
    try {
      await insertStale(transId, 'UNMATCHED', STALE_THRESHOLD_MINUTES + 15);

      const first = await runStaleUnmatchedAlertPass();
      expect(first.alerted).toBeGreaterThanOrEqual(1);
      expect(await alertCount(transId)).toBe(1);

      // Second pass — same stale row, already stamped: no duplicate email.
      const second = await runStaleUnmatchedAlertPass();
      expect(await alertCount(transId)).toBe(1);
      expect(second.alerted).toBeGreaterThanOrEqual(0);

      // The escalation email carries the still-waiting framing.
      const row = await queryOne<{ subject: string }>(
        `SELECT subject FROM email_notifications WHERE body_text LIKE $1 AND email_address = $2 LIMIT 1`,
        [`%Transaction: ${transId}%`, OPERATOR_EMAIL]
      );
      expect(row?.subject).toContain('STILL UNRESOLVED');
    } finally {
      await cleanup([transId]);
    }
  });

  it('does NOT escalate payments younger than the threshold', async () => {
    const transId = `${PREFIX}S2`;
    try {
      await insertStale(transId, 'UNMATCHED', STALE_THRESHOLD_MINUTES - 30);
      const result = await runStaleUnmatchedAlertPass();
      // This row must not be among the alerted ones (others may exist).
      expect(await alertCount(transId)).toBe(0);
      // And it must not have been claimed.
      const stamp = await queryOne<{ stale_alerted_at: Date | null }>(
        `SELECT stale_alerted_at FROM mpesa_transactions WHERE transaction_id = $1`,
        [transId]
      );
      expect(stamp?.stale_alerted_at).toBeNull();
      expect(result.alerted).toBeGreaterThanOrEqual(0);
    } finally {
      await cleanup([transId]);
    }
  });

  it('never escalates a resolved (POSTED) payment even if it sat stale first', async () => {
    const transId = `${PREFIX}S3`;
    try {
      const id = await insertStale(transId, 'UNMATCHED', STALE_THRESHOLD_MINUTES + 30);
      // Staff resolved it before the job's next pass.
      await query(
        `UPDATE mpesa_transactions SET status = 'POSTED', tenant_id = (SELECT id FROM tenants LIMIT 1) WHERE id = $1`,
        [id]
      );
      await runStaleUnmatchedAlertPass();
      expect(await alertCount(transId)).toBe(0);
    } finally {
      await cleanup([transId]);
    }
  });

  it('escalates AMBIGUOUS rows with the ambiguous wording', async () => {
    const transId = `${PREFIX}S4`;
    try {
      await insertStale(transId, 'AMBIGUOUS', STALE_THRESHOLD_MINUTES + 5);
      await runStaleUnmatchedAlertPass();
      const row = await queryOne<{ subject: string }>(
        `SELECT subject FROM email_notifications WHERE body_text LIKE $1 AND email_address = $2 LIMIT 1`,
        [`%Transaction: ${transId}%`, OPERATOR_EMAIL]
      );
      expect(row?.subject).toContain('ambiguous');
    } finally {
      await cleanup([transId]);
    }
  });

  it('alerts nothing when the operator email is unset', async () => {
    await query(`UPDATE business_branding SET contact_email = NULL WHERE id = 1`);
    const transId = `${PREFIX}S5`;
    try {
      await insertStale(transId, 'UNMATCHED', STALE_THRESHOLD_MINUTES + 10);
      const result = await runStaleUnmatchedAlertPass();
      expect(result.alerted).toBe(0);
      // No stamp written either — if the operator email is added later, the
      // still-stale row escalates on a future pass.
      const stamp = await queryOne<{ stale_alerted_at: Date | null }>(
        `SELECT stale_alerted_at FROM mpesa_transactions WHERE transaction_id = $1`,
        [transId]
      );
      expect(stamp?.stale_alerted_at).toBeNull();
      expect(await alertCount(transId)).toBe(0);
    } finally {
      await cleanup([transId]);
      // Restore within the test (afterAll restores too, but later tests in
      // this file may follow).
      await query(`UPDATE business_branding SET contact_email = $1 WHERE id = 1`, [OPERATOR_EMAIL]);
    }
  });
});
