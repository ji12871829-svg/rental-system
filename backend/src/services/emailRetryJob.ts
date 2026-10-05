// Automatic retry of FAILED and ERRONEOUS emails.
//
// The EMAIL twin of smsRetryJob. Every send attempt that fails with a
// transient error gets a next_retry_at deadline (exponential backoff, set by
// sendEmailNotification); this sweep re-sends due rows on an interval. Design
// notes mirror the SMS job, with one deliberate difference:
//
//  - The claim covers BOTH non-final statuses. FAILED is the transient case
//    (a deadline is normally present). ERRONEOUS is the terminal case — the
//    provider rejected the address itself — and is written WITHOUT a deadline,
//    so in practice only an operator-supplied deadline ever makes one a
//    sweep candidate. Claiming both keeps the sweep honest about "anything not
//    SENT is replayable" and means a single query covers every replayable row
//    regardless of how it failed.
//  - Rows are claimed with FOR UPDATE SKIP LOCKED inside a short statement that
//    marks them PENDING again, so two server instances (or an overlap of the
//    sweep with a manual send) can never double-send the same message.
//  - A row that exhausts its attempts keeps status FAILED with next_retry_at
//    NULL — visibly "gave up" — and can still be sent manually forever.
//  - NODE_ENV=test opts out at startEmailRetryJob (integration tests drive the
//    flow explicitly); the sweep itself stays fully unit/integration-testable.
import { env } from '../config/env';
import { pool } from '../config/db';
import { sendEmailNotification } from './emailService';

const SWEEP_BATCH = 20;

/**
 * Re-send every FAILED / ERRONEOUS email whose retry deadline is due.
 * Returns how many rows were re-sent (claimed) in this pass.
 *
 * If the process crashes after claiming (row flipped to PENDING) but before
 * the send completes, the row simply stays PENDING — visible in history and
 * still sendable manually; the next sweep only touches rows with a deadline,
 * and a PENDING row has none.
 */
export async function runEmailRetrySweep(now = new Date()): Promise<number> {
  if (!env.smsRetryEnabled) return 0;

  const claimed = await pool.query<{ id: number }>(
    `WITH due AS (
       SELECT id FROM email_notifications
       WHERE status IN ('FAILED', 'ERRONEOUS')
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= $1
       ORDER BY next_retry_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE email_notifications e
     SET status = 'PENDING'
     FROM due
     WHERE e.id = due.id
     RETURNING e.id`,
    [now, SWEEP_BATCH]
  );

  let dispatched = 0;
  for (const { id } of claimed.rows) {
    try {
      // sendEmailNotification flips the row to SENT, or records FAILED with a
      // fresh next_retry_at (or ERRONEOUS with none, if the address itself is
      // the problem).
      await sendEmailNotification(id);
      dispatched += 1;
    } catch (err) {
      // Never let one bad row kill the sweep — flip it back to FAILED with a
      // deadline so a later pass (or a manual send) can still handle it.
      await pool.query(
        `UPDATE email_notifications
         SET status = 'FAILED',
             failure_reason = COALESCE(failure_reason, '') || ' | retry error: ' || $2
         WHERE id = $1`,
        [id, (err as Error).message]
      );
    }
  }
  return dispatched;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the retry loop (no-op in the test environment). Idempotent. */
export function startEmailRetryJob(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;
  if (!env.smsRetryEnabled) {
    // eslint-disable-next-line no-console
    console.log('Email retry job: disabled (SMS_RETRY_ENABLED=false).');
    return;
  }
  const intervalMs = Math.max(10_000, Math.min(env.smsRetryBaseDelayMs, 60_000));
  timer = setInterval(() => {
    runEmailRetrySweep().catch((err) =>
      // eslint-disable-next-line no-console
      console.error('[email-retry] sweep failed:', (err as Error).message)
    );
  }, intervalMs);
  // eslint-disable-next-line no-console
  console.log(
    `Email retry job: running every ${Math.round(intervalMs / 1000)}s — FAILED emails retry up to ${env.smsMaxSendAttempts} attempts (base delay ${Math.round(env.smsRetryBaseDelayMs / 1000)}s).`
  );
}

export function stopEmailRetryJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
