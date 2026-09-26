// Oldest-arrears rent allocation engine.
//
// "The tenant just sends money" path: money that arrives without the operator
// touching anything should land on what the tenant actually owes, oldest
// month first, exactly the way the ledger page says they owe it. The
// expected-rent SQL below is the tenant ledger's move-in-aware query verbatim
// (financeService.tenantLedger), so allocation can never disagree with what
// the ledger shows.
//
// The manual review path (mpesaReviewService.resolveMpesaReviewTransaction)
// deliberately books through the same engine, so a payment resolved by hand
// lands on the same arrears view as one the pipeline posted automatically.
//
// Consumers:
//   * mpesaService        (automatic C2B + STK posting)
//   * mpesaReviewService  (manual resolve with allocate=true)
//   * tests/integration   (assert the arrears view against pipeline fixtures)
import { query } from '../config/db';
import { createRentPayment } from './rentService';
import { toNumber, round2 } from '../utils/money';
import { MONTH_NAMES } from '../types';

export interface RentArrearsMonth {
  month: number;
  monthName: string;
  year: number;
  expectedRent: number;
  rentPaid: number;
  balance: number;
}

/**
 * The tenant's unpaid rent months for a calendar year, oldest first, computed
 * with the same move-in-aware expected-rent math as the tenant ledger.
 * Months before move-in (or after move-out) are excluded by the SQL itself —
 * their expected rent is NULL, not 0, so a new tenant's money is never
 * silently booked onto pre-move-in months.
 *
 * Exported for the allocation integration tests, which assert the arrears
 * view directly against the same fixtures the pipeline consumes.
 * @public
 */
export async function rentArrearsForYear(tenantId: number, year: number): Promise<RentArrearsMonth[]> {
  const rows = await query<{
    month: number; monthly_rent: string | null; paid: string;
  }>(
    `WITH months AS (SELECT generate_series(1, 12) AS m),
     tn AS (SELECT unit_id, move_in_date, move_out_date FROM tenants WHERE id = $1),
     rent AS (
       SELECT billing_month AS m, SUM(amount) AS paid
       FROM rent_payments WHERE tenant_id = $1 AND billing_year = $2::int
       GROUP BY billing_month
     )
     SELECT ms.m AS month,
            CASE WHEN tn.unit_id IS NULL THEN NULL
                 WHEN tn.move_in_date IS NOT NULL
                      AND tn.move_in_date <= (DATE ($2::text || '-01-01') + ms.m * INTERVAL '1 month' - INTERVAL '1 day')
                      AND (tn.move_out_date IS NULL OR tn.move_out_date >= (DATE ($2::text || '-01-01') + (ms.m - 1) * INTERVAL '1 month'))
                 THEN u.monthly_rent
                 ELSE NULL END AS monthly_rent,
            COALESCE(rp.paid, 0) AS paid
     FROM months ms
     LEFT JOIN rent rp ON rp.m = ms.m
     CROSS JOIN tn
     LEFT JOIN units u ON u.id = tn.unit_id
     ORDER BY ms.m`,
    [tenantId, year]
  );

  return rows
    .map((row) => {
      const expectedRent = row.monthly_rent === null ? 0 : toNumber(row.monthly_rent);
      const rentPaid = toNumber(row.paid);
      return {
        month: row.month,
        monthName: MONTH_NAMES[row.month - 1],
        year,
        expectedRent,
        rentPaid,
        balance: round2(expectedRent - rentPaid),
      };
    })
    .filter((m) => m.expectedRent > 0 && m.balance > 0);
}

/**
 * Split an incoming amount across arrears months, oldest first.
 * Anything left after every arrears month is cleared rides as one final
 * "credit" slice on the transaction's own month (the ledger shows it as an
 * overpayment there — visible, honest, and refundable at the office).
 *
 * Exported for the allocation unit tests (pure function, no I/O).
 * @public
 */
export function allocateAcrossArrears(
  arrears: RentArrearsMonth[],
  amount: number,
  fallbackMonth: number,
  fallbackYear: number
): Array<{ month: number; year: number; monthName: string; amount: number; part: number; parts: number }> {
  let remaining = round2(amount);
  const slices: Array<{ month: number; year: number; monthName: string; amount: number; part: number; parts: number }> = [];
  for (const m of arrears) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, m.balance);
    if (slice <= 0) continue;
    slices.push({ month: m.month, year: m.year, monthName: m.monthName, amount: round2(slice), part: 0, parts: 0 });
    remaining = round2(remaining - slice);
  }
  if (remaining > 0) {
    slices.push({
      month: fallbackMonth, year: fallbackYear,
      monthName: MONTH_NAMES[fallbackMonth - 1],
      amount: remaining, part: 0, parts: 0,
    });
  }
  const parts = slices.length;
  for (let i = 0; i < slices.length; i++) {
    slices[i].part = i + 1;
    slices[i].parts = parts;
  }
  return slices;
}

/**
 * Post a rent amount as one or more rent_payments (one per allocated month),
 * each through createRentPayment so every slice gets its own receipt number
 * and prepared receipt SMS. The mpesa_transactions row is flipped to POSTED
 * with the last slice's payment id. Returns the slice payment ids.
 *
 * Exported for the staff review flow — a manually resolved UNMATCHED payment
 * must allocate exactly like the automatic path so both routes book money
 * onto the same arrears view.
 * @public
 */
export async function postRentWithAllocation(
  storedId: number,
  tenantId: number,
  amount: number,
  paymentDate: string,
  fallbackMonth: number,
  fallbackYear: number,
  paymentReference: string | undefined,
  source: 'C2B' | 'STK',
  provenance: string
): Promise<number[]> {
  const year = fallbackYear;
  const arrears = await rentArrearsForYear(tenantId, year);
  const slices = allocateAcrossArrears(arrears, amount, fallbackMonth, fallbackYear);

  const paymentIds: number[] = [];
  let lastError: unknown = null;
  for (const slice of slices) {
    const partNote = slices.length > 1 ? ` (part ${slice.part}/${slice.parts} of ${round2(amount)})` : '';
    try {
      const result = await createRentPayment({
        tenantId,
        paymentDate,
        billingMonth: slice.month,
        billingYear: slice.year,
        amount: slice.amount,
        paymentMethod: 'M_PESA',
        paymentReference,
        notes: `Automatically posted from M-Pesa ${source} confirmation.${partNote} Allocated to ${slice.monthName} ${slice.year}.${provenance}`,
      }, null) as { payment: { id: number } };
      paymentIds.push(result.payment.id);
    } catch (error) {
      lastError = error;
      break;
    }
  }

  if (paymentIds.length === 0) {
    throw lastError ?? new Error('M-Pesa rent allocation posted no payments.');
  }
  await query(
    `UPDATE mpesa_transactions
     SET status = 'POSTED', rent_payment_id = $2, error_message = NULL
     WHERE id = $1`,
    [storedId, paymentIds[paymentIds.length - 1]]
  );
  return paymentIds;
}
