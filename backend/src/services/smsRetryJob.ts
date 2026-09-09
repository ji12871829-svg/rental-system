// Automatic retry of FAILED SMS messages.
//
// Every SMS_MAX_SEND_ATTEMPTS seconds-worth of trying, each failure gets a
// next_retry_at deadline (exponential backoff, set by sendSmsNotification).
// This sweep re-sends due rows on an interval. Design notes:
//
//  - Rows are claimed with FOR UPDATE SKIP LOCKED inside a short transaction
//    that marks them PENDING again, so two server instances (or an overlap of
//    the sweep with a manual send) can never double-send the same message.
//  - A row that exhausts its attempts keeps status FAILED with next_retry_at
//    NULL — visibly "gave up" — and can still be sent manually forever.
//  - NODE_ENV=test opts out at startSmsRetryJob (integration tests drive the
//    flow explicitly); the sweep itself stays fully unit/integration-testable.
import { env } from '../config/env';
import { pool } from '../config/db';
import { sendSmsNotification } from './smsService';

const SWEEP_BATCH = 20;

/**
 * Re-send every FAILED message whose retry deadline is due.
 * Returns how many rows were re-sent (claimed) in this pass.
 *
 * If the process crashes after claiming (row flipped to PENDING) but before
 * the send completes, the row simply stays PENDING — visible in history and
 * still sendable manually; the next sweep only touches FAILED rows.
 */
export async function runRetrySweep(now = new Date()): Promise<number> {
  if (!env.smsRetryEnabled) return 0;

  const claimed = await pool.query<{ id: number }>(
    `WITH due AS (
       SELECT id FROM sms_notifications
       WHERE status = 'FAILED'
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= $1
       ORDER BY next_retry_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE sms_notifications s
     SET status = 'PENDING'
     FROM due
     WHERE s.id = due.id
     RETURNING s.id`,
    [now, SWEEP_BATCH]
  );

  let dispatched = 0;
  for (const { id } of claimed.rows) {
    try {
      // sendSmsNotification flips the row to SENT, or back to FAILED with a
      // fresh next_retry_at (unless attempts are exhausted).
      await sendSmsNotification(id);
      dispatched += 1;
    } catch (err) {
      // Never let one bad row kill the sweep — flip it back to FAILED so a
      // later pass (or a manual send) can still handle it.
      await pool.query(
        `UPDATE sms_notifications
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
export function startSmsRetryJob(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;
  if (!env.smsRetryEnabled) {
    // eslint-disable-next-line no-console
    console.log('SMS retry job: disabled (SMS_RETRY_ENABLED=false).');
    return;
  }
  const intervalMs = Math.max(10_000, Math.min(env.smsRetryBaseDelayMs, 60_000));
  timer = setInterval(() => {
    runRetrySweep().catch((err) =>
      // eslint-disable-next-line no-console
      console.error('[sms-retry] sweep failed:', (err as Error).message)
    );
  }, intervalMs);
  // eslint-disable-next-line no-console
  console.log(
    `SMS retry job: running every ${Math.round(intervalMs / 1000)}s — FAILED messages retry up to ${env.smsMaxSendAttempts} attempts (base delay ${Math.round(env.smsRetryBaseDelayMs / 1000)}s).`
  );
}

export function stopSmsRetryJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
