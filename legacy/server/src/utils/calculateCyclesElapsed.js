// calculateCyclesElapsed.js — see docs/HARD-QUESTIONS.md Q3. Unit-tested in
// tests/unit/calculateCyclesElapsed.test.js.
//
// Balance-due formula (ARCHITECTURE-ESSENTIALS.md rule 3):
//   balanceDue = (cyclesElapsed × monthlyRent) − SUM(payments.amount)
// where cyclesElapsed counts whole CALENDAR MONTHS from start_date through
// min(today, end_date), INCLUSIVE of the starting month.
//
// WHY calendar months and not day-counting: rent is billed on a monthly cycle
// (no day proration in v1), so each calendar month is one billing cycle and
// the move-in month is billed in full. The day-of-month within a month is
// irrelevant: a lease that started Jan 15 owes Jan, Feb, Mar by Mar 1.
//
// Formula: cycles = (endYear − startYear) × 12 + (endMonth − startMonth) + 1.
// Date-only math on UTC components; start/end are DATE values (no time part),
// so there is no timezone drift. Returns 0 before the lease starts or for
// invalid input. Callers pass min(today, end_date) as the second argument —
// this function does not clamp itself (see payments.js, reports.js).
function calculateCyclesElapsed(startDate, endDateOrToday) {
  if (!startDate || !endDateOrToday) return 0;

  // Accept 'YYYY-MM-DD' strings or real Dates (pg returns DATE as Date).
  const toDate = (v) =>
    v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  const start = toDate(startDate);
  const end = toDate(endDateOrToday);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;

  // One-based months (Jan = 1 … Dec = 12) keep the arithmetic readable.
  const startMonth = start.getUTCMonth() + 1;
  const endMonth = end.getUTCMonth() + 1;
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (endMonth - startMonth);

  // +1 bills the starting (move-in) month in full.
  return months + 1;
}

module.exports = { calculateCyclesElapsed };