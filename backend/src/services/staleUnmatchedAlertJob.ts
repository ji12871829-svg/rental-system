// Stale-unmatched-payment escalation job.
//
// The instant alert fires when a payment FIRST lands in the review queue; this
// job is the follow-up: a transaction still sitting in UNMATCHED/AMBIGUOUS
// after STALE_THRESHOLD_MINUTES means nobody has reviewed it, so the operator
// gets one reminder email. Guarantees:
//
//  - once per transaction: a `stale_alerted_at` stamp (migration 007) is set
//    in the same UPDATE that selects candidates-for-notification, so two job
//    passes can never double-alert, and a restart re-reads the stamp;
//  - resolved rows are invisible: the WHERE clause only matches live queue
//    states, so resolving a payment silences its escalation permanently;
//  - email failure must not lose the escalation: the stamp is only written
//    after the queue row exists (at-least-once semantics preferred over
//    at-most-once — a duplicate email beats a silently dropped reminder);
//  - never throws: the job logs and continues; the next pass retries.
//
// NODE_ENV=test opts out at start (tests drive runStaleUnmatchedAlertPass
// directly); disabled entirely when no operator email is configured.
import { query, queryOne } from '../config/db';
import { isTest } from '../config/env';
import { prepareForStaleUnmatchedPayment, sendEmailNotification } from './emailService';
import { getSettings } from './settingsService';

export const STALE_THRESHOLD_MINUTES = 60;

interface StaleRow {
  id: number;
  transaction_id: string | null;
  checkout_request_id: string | null;
  amount: string;
  account_reference: string;
  phone_number: string | null;
  status: 'UNMATCHED' | 'AMBIGUOUS';
  error_message: string | null;
  created_at: Date;
}

function nairobiTimeLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);
  const v = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${v.hour}:${v.minute}, ${v.day} ${v.month} ${v.year}`;
}

/**
 * One escalation pass. Returns counts (for logs/tests).
 *
 * The claim-then-send sequence: candidates are selected and stamped
 * (stale_alerted_at = NOW()) atomically per row via UPDATE … RETURNING, so
 * only the pass that wins the stamp sends the email. If sending then fails,
 * the stamp is reverted so the next pass retries.
 * @public
 */
export async function runStaleUnmatchedAlertPass(): Promise<{ alerted: number }> {
  const identity = await queryOne<{ contact_email: string | null }>(
    `SELECT contact_email FROM business_branding WHERE id = 1`
  );
  if (!identity?.contact_email?.trim()) return { alerted: 0 };

  // Claim candidates atomically: only rows still in a live queue state, older
  // than the threshold, never escalated before.
  const claimed = await query<StaleRow>(
    `UPDATE mpesa_transactions
     SET stale_alerted_at = NOW()
     WHERE status IN ('UNMATCHED', 'AMBIGUOUS')
       AND created_at < NOW() - ($1 || ' minutes')::interval
       AND stale_alerted_at IS NULL
     RETURNING id, transaction_id, checkout_request_id, amount, account_reference,
               phone_number, status, error_message, created_at`,
    [String(STALE_THRESHOLD_MINUTES)]
  );
  if (claimed.length === 0) return { alerted: 0 };

  const settings = await getSettings();
  const currency = settings.currency || 'KSh';
  let alerted = 0;

  for (const row of claimed) {
    const transactionId = row.transaction_id || `STK-${row.checkout_request_id ?? row.id}`;
    const ageMinutes = Math.max(1, Math.round((Date.now() - new Date(row.created_at).getTime()) / 60_000));
    try {
      const queued = await prepareForStaleUnmatchedPayment({
        status: row.status,
        transactionId,
        amount: Number(row.amount),
        accountReference: row.account_reference,
        senderPhone: row.phone_number,
        arrivedAtLabel: nairobiTimeLabel(new Date(row.created_at)),
        ageMinutes,
        currency,
        reason: row.error_message,
      });
      if (queued && !isTest) {
        setTimeout(() => {
          sendEmailNotification(queued.id).catch((err) =>
            // eslint-disable-next-line no-console
            console.error(`[mpesa] stale alert send failed (${transactionId}): ${(err as Error).message}`),
          );
        }, 0);
      }
      alerted += 1;
    } catch (err) {
      // Revert the stamp so the next pass retries this row.
      await query(`UPDATE mpesa_transactions SET stale_alerted_at = NULL WHERE id = $1`, [row.id]);
      // eslint-disable-next-line no-console
      console.error(`[mpesa] stale alert queue failed for ${transactionId}: ${(err as Error).message}`);
    }
  }
  return { alerted };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the escalation loop (every 5 minutes). No-op in tests. Idempotent. */
export function startStaleUnmatchedAlertJob(): void {
  if (isTest) return;
  if (timer) return;
  timer = setInterval(() => {
    if (running) return; // a slow pass must never stack
    running = true;
    runStaleUnmatchedAlertPass()
      .then((r) => {
        if (r.alerted > 0) {
          // eslint-disable-next-line no-console
          console.log(`[mpesa] stale-unmatched escalation: ${r.alerted} reminder(s) sent.`);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[mpesa] stale-unmatched pass failed:', (err as Error).message);
      })
      .finally(() => {
        running = false;
      });
  }, 5 * 60 * 1000);
  // eslint-disable-next-line no-console
  console.log('Stale-unmatched alert job: running every 5 minutes (escalates after 60 min in queue).');
}

export function stopStaleUnmatchedAlertJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
