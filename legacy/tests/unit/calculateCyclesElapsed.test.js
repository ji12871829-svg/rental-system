// Unit tests for utils/calculateCyclesElapsed.js — the billing-cycle counter
// behind balance-due (HARD-QUESTIONS.md Q3). Rent is billed per CALENDAR
// month (no day proration): cycles = months-between + 1, where the move-in
// month counts in full.
const { calculateCyclesElapsed } = require('../../server/src/utils/calculateCyclesElapsed');

describe('calculateCyclesElapsed', () => {
  it('counts the starting month even if only 1 day has elapsed', () => {
    expect(calculateCyclesElapsed('2026-01-01', '2026-01-01')).toBe(1);
    expect(calculateCyclesElapsed('2026-01-31', '2026-02-01')).toBe(2); // Jan + Feb
  });

  it('counts whole calendar months, ignoring days within the month', () => {
    // Jan 1 → Mar 14: Jan, Feb, Mar = 3 (March is a billed cycle by Mar 1).
    expect(calculateCyclesElapsed('2026-01-01', '2026-03-14')).toBe(3);
    expect(calculateCyclesElapsed('2026-01-01', '2026-03-31')).toBe(3);
    // Mid-month start: Apr 15 → May 14 is Apr + May = 2.
    expect(calculateCyclesElapsed('2026-04-15', '2026-05-14')).toBe(2);
    expect(calculateCyclesElapsed('2026-04-15', '2026-05-15')).toBe(2);
  });

  it('stops accruing once the lease end_date month is reached', () => {
    // Callers pass min(today, end_date); through Dec 31 the lease bills 12 cycles.
    expect(calculateCyclesElapsed('2026-01-01', '2026-12-31')).toBe(12);
    expect(calculateCyclesElapsed('2026-06-15', '2026-09-10')).toBe(4); // Jun..Sep
  });

  it('counts months across year boundaries', () => {
    expect(calculateCyclesElapsed('2025-11-15', '2026-03-16')).toBe(5); // Nov,Dec,Jan,Feb,Mar
    expect(calculateCyclesElapsed('2025-12-01', '2026-10-01')).toBe(11);
  });

  it('returns 0 for invalid or reversed input', () => {
    expect(calculateCyclesElapsed('2026-06-01', '2026-01-01')).toBe(0); // end before start
    expect(calculateCyclesElapsed(null, '2026-01-01')).toBe(0);
    expect(calculateCyclesElapsed('not-a-date', '2026-01-01')).toBe(0);
    expect(calculateCyclesElapsed('2026-01-01', 'not-a-date')).toBe(0);
  });

  it('accepts Date objects (pg parses DATE columns into JS Date)', () => {
    expect(calculateCyclesElapsed(new Date('2026-01-01T00:00:00Z'), new Date('2026-09-05T00:00:00Z'))).toBe(9);
  });

  it('matches the seeded lease math (spot check used by reports)', () => {
    // Seed lease 1: 2026-01-01 → 2026-12-31, today 2026-09-05 → Jan..Sep = 9 cycles.
    expect(calculateCyclesElapsed('2026-01-01', '2026-09-05')).toBe(9);
    // Seed lease 2: 2026-02-01 → 2027-01-31, today 2026-09-05 → Feb..Sep = 8 cycles.
    expect(calculateCyclesElapsed('2026-02-01', '2026-09-05')).toBe(8);
  });
});