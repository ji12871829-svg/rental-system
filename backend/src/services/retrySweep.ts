// The shared retry sweep behind smsRetryJob and emailRetryJob.
//
// Both channels share one mechanic: claim rows whose retry deadline is due
// (FOR UPDATE SKIP LOCKED inside a short statement that marks them PENDING
// again, so two server instances — or an overlap of the sweep with a manual
// send — can never double-send the same row), re-send through the channel's
// own sendNotification, and contain per-row errors by flipping the row back
// to FAILED with the reason appended. Only three things differ per channel:
// the table, which non-terminal statuses are claimable, and the sender (each
// channel's lifecycle module keeps its own transition rules — SMS writes
// provider cost and delivery reports; email classifies permanent vs transient
// via isTerminalEmailFailure and may write ERRONEOUS).
//
// The retry knobs are deliberately shared (env.smsRetryEnabled /
// smsMaxSendAttempts / smsRetryBaseDelayMs — historically named SMS_*), and
// NODE_ENV=test opts out at start: the integration tests drive the flow
// explicitly, while the sweep itself stays fully unit/integration-testable.
import { env } from '../config/env';
import { pool } from '../config/db';

const SWEEP_BATCH = 20;

const revertSql = (table: string) => `
     UPDATE ${table}
     SET status = 'FAILED',
         failure_reason = COALESCE(failure_reason, '') || ' | retry error: ' || $2
     WHERE id = $1`;

interface RetrySweepConfig {
  /** Table swept, e.g. 'sms_notifications'. */
  table: string;
  /** Non-final statuses the sweep may claim (everything but PENDING/SENT). */
  claimStatuses: readonly string[];
  /** The channel's single send entry point (sendSmsNotification / sendEmailNotification). */
  sender: (id: number) => Promise<unknown>;
  /** console.error prefix when a whole pass dies, e.g. '[sms-retry]'. */
  logPrefix: string;
  /** Human label for the start logs, e.g. 'SMS retry job'. */
  label: string;
  /** Subject phrase for the start log, e.g. 'FAILED messages'. */
  runningSubject: string;
}

export function createRetrySweep(config: RetrySweepConfig) {
  const { table, claimStatuses, sender, logPrefix, label, runningSubject } = config;
  const statusList = claimStatuses.map((s) => `'${s}'`).join(', ');
  const statusFilter =
    claimStatuses.length === 1 ? `status = ${statusList}` : `status IN (${statusList})`;

  /**
   * Re-send every claimable row whose retry deadline is due.
   * Returns how many rows were re-sent (claimed) in this pass.
   *
   * If the process crashes after claiming (row flipped to PENDING) but before
   * the send completes, the row simply stays PENDING — visible in history and
   * still sendable manually; the next sweep only touches rows that carry a
   * deadline, and a PENDING row has none.
   */
  async function run(now = new Date()): Promise<number> {
    if (!env.smsRetryEnabled) return 0;

    const claimed = await pool.query<{ id: number }>(
      `WITH due AS (
         SELECT id FROM ${table}
         WHERE ${statusFilter}
           AND next_retry_at IS NOT NULL
           AND next_retry_at <= $1
         ORDER BY next_retry_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${table} t
       SET status = 'PENDING'
       FROM due
       WHERE t.id = due.id
       RETURNING t.id`,
      [now, SWEEP_BATCH]
    );

    let dispatched = 0;
    for (const { id } of claimed.rows) {
      try {
        await sender(id);
        dispatched += 1;
      } catch (err) {
        // Never let one bad row kill the sweep — flip it back to FAILED with
        // the reason appended so a later pass (or a manual send) can retry it.
        await pool.query(revertSql(table), [id, (err as Error).message]);
      }
    }
    return dispatched;
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  /** Start the retry loop (no-op in the test environment). Idempotent. */
  function start(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (timer) return;
    if (!env.smsRetryEnabled) {
      // eslint-disable-next-line no-console
      console.log(`${label}: disabled (SMS_RETRY_ENABLED=false).`);
      return;
    }
    const intervalMs = Math.max(10_000, Math.min(env.smsRetryBaseDelayMs, 60_000));
    timer = setInterval(() => {
      run().catch((err) =>
        // eslint-disable-next-line no-console
        console.error(`${logPrefix} sweep failed:`, (err as Error).message)
      );
    }, intervalMs);
    // eslint-disable-next-line no-console
    console.log(
      `${label}: running every ${Math.round(intervalMs / 1000)}s — ${runningSubject} retry up to ${env.smsMaxSendAttempts} attempts (base delay ${Math.round(env.smsRetryBaseDelayMs / 1000)}s).`
    );
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { run, start, stop };
}
