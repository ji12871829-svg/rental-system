// PayHero ingestion poller.
//
// PayHero fronts the property's M-Pesa paybill/till; this job pulls the
// collections PayHero has received and feeds them into the EXISTING pipeline
// (processPaybillPayment: match → allocate across arrears → post → receipt →
// prepared auto-SMS). Design notes:
//
//  - Idempotent end to end: each PayHero record is inserted into
//    mpesa_transactions with the partial-unique transaction_id index, so a
//    record seen twice (PayHero pagination overlap, poller restart) is a
//    no-op — processPaybillPayment's POSTED/DUPLICATE path absorbs replays.
//  - The poller NEVER throws: one bad page or record is logged and skipped;
//    the next interval retries.
//  - NODE_ENV=test opts out at startPayheroPollJob (tests drive
//    processPaybillPayment directly).
//  - Disabled entirely when PAYHERO_API_USERNAME/PAYHERO_API_PASSWORD are
//    unset — the app behaves exactly as before PayHero existed.
import { pool } from '../config/db';
import { isTest } from '../config/env';
import { fetchRecentTransactions, getPayheroConfig } from './payheroProvider';
import { processPaybillPayment } from './mpesaService';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

interface IngestResult {
  seen: number;
  posted: number;
  unmatched: number;
  duplicates: number;
}

/**
 * One ingestion pass: pull recent PayHero collections and run each through
 * the paybill pipeline. Returns per-status counts (for logs/tests).
 *
 * Exported for the poller integration tests (drive one pass directly instead
 * of waiting on the interval).
 * @public
 */
export async function runPayheroIngest(): Promise<IngestResult> {
  const config = getPayheroConfig();
  if (!config.configured) return { seen: 0, posted: 0, unmatched: 0, duplicates: 0 };

  const transactions = await fetchRecentTransactions(1);
  const result: IngestResult = { seen: transactions.length, posted: 0, unmatched: 0, duplicates: 0 };

  for (const txn of transactions) {
    try {
      // Record the collection first (dedup by transaction id via the partial
      // unique index), then let the pipeline decide match/post/UNMATCHED.
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO mpesa_transactions
           (source, transaction_id, account_reference, amount, transaction_date, phone_number, payment_kind, raw_payload, status)
         VALUES ('C2B', $1, $2, $3, $4, $5, 'RENT', $6::jsonb, 'RECEIVED')
         ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          `PH-${txn.transactionId}`,
          txn.accountReference,
          txn.amount,
          txn.transactionDate,
          txn.phoneNumber,
          JSON.stringify(txn.raw),
        ]
      );

      if (inserted.rowCount === 0) {
        // Already ingested in a previous pass — but if it stalled before
        // posting (e.g. the process died mid-ingest), give the pipeline one
        // more shot at it; processPaybillPayment is idempotent.
        const existing = await pool.query<{ id: number; status: string }>(
          `SELECT id, status FROM mpesa_transactions WHERE transaction_id = $1`,
          [`PH-${txn.transactionId}`]
        );
        if (existing.rows[0] && (existing.rows[0].status === 'RECEIVED' || existing.rows[0].status === 'MATCHED')) {
          const outcome = await processPaybillPayment({
            transactionId: `PH-${txn.transactionId}`,
            accountReference: txn.accountReference,
            amount: txn.amount,
            transactionDate: txn.transactionDate,
            phoneNumber: txn.phoneNumber,
            rawPayload: txn.raw,
          });
          if (outcome.status === 'POSTED') result.posted += 1;
          else if (outcome.status === 'UNMATCHED') result.unmatched += 1;
          else result.duplicates += 1;
        } else {
          result.duplicates += 1;
        }
        continue;
      }

      const outcome = await processPaybillPayment({
        transactionId: `PH-${txn.transactionId}`,
        accountReference: txn.accountReference,
        amount: txn.amount,
        transactionDate: txn.transactionDate,
        phoneNumber: txn.phoneNumber,
        rawPayload: txn.raw,
      });
      if (outcome.status === 'POSTED') result.posted += 1;
      else if (outcome.status === 'UNMATCHED') result.unmatched += 1;
      else result.duplicates += 1;
    } catch (err) {
      // Never let one bad record kill the pass.
      // eslint-disable-next-line no-console
      console.error(`[payhero] ingest failed for ${txn.transactionId}: ${(err as Error).message}`);
    }
  }
  return result;
}

/** Start the poll loop (no-op in tests or when unconfigured). Idempotent. */
export function startPayheroPollJob(): void {
  if (isTest) return;
  if (timer) return;
  const config = getPayheroConfig();
  if (!config.configured) {
    // eslint-disable-next-line no-console
    console.log('PayHero poll job: disabled (PAYHERO_API_USERNAME / PAYHERO_API_PASSWORD not set).');
    return;
  }
  const intervalMs = config.pollSeconds * 1000;
  timer = setInterval(() => {
    if (running) return; // a slow pass must never stack
    running = true;
    runPayheroIngest()
      .then((r) => {
        if (r.seen > 0) {
          // eslint-disable-next-line no-console
          console.log(`[payhero] ingest: ${r.seen} seen, ${r.posted} posted, ${r.unmatched} unmatched, ${r.duplicates} duplicates.`);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[payhero] poll failed:', (err as Error).message);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  // eslint-disable-next-line no-console
  console.log(`PayHero poll job: running every ${config.pollSeconds}s.`);
}

export function stopPayheroPollJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
