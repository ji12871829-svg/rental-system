// Nightly sweep that turns due recurring expenses (garbage collection,
// security contracts, insurance…) into real expense ledger rows. Shares the
// retention job's shape: interval loop, no-op under NODE_ENV=test, idempotent
// per period because generateRecurringExpense advances next_due_date.
import { generateDueRecurringExpenses } from './recurringExpenseService';

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the daily recurring-expense loop (no-op in the test environment). Idempotent. */
export function startRecurringExpenseJob(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;
  const intervalMs = 24 * 60 * 60 * 1000;
  timer = setInterval(() => {
    generateDueRecurringExpenses(null)
      .then((r) => {
        if (r.generated > 0 || r.failures.length > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[recurring-expenses] sweep: ${r.generated} generated, ${r.failures.length} failures, ${r.remaining} still due.`
          );
        }
      })
      .catch((err) =>
        // eslint-disable-next-line no-console
        console.error('[recurring-expenses] sweep failed:', (err as Error).message)
      );
  }, intervalMs);
  // eslint-disable-next-line no-console
  console.log('Recurring expense job: running daily — due recurring expenses are recorded into the expense ledger.');
}

export function stopRecurringExpenseJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
