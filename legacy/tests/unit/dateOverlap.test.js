// Unit tests for utils/dateOverlap.js — inclusive range overlap.
// 'YYYY-MM-DD' strings compare lexicographically, exactly like the DB's
// daterange(start, end, '[]') comparison (see utils/dateOverlap.js).
const { rangesOverlap } = require('../../server/src/utils/dateOverlap');

describe('rangesOverlap (inclusive)', () => {
  it('detects fully-overlapping ranges', () => {
    expect(rangesOverlap('2026-01-01', '2026-12-31', '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('detects partially-overlapping ranges', () => {
    expect(rangesOverlap('2026-01-01', '2026-06-30', '2026-06-01', '2026-12-31')).toBe(true);
  });

  it('detects a range contained inside another', () => {
    expect(rangesOverlap('2026-01-01', '2026-12-31', '2026-06-01', '2026-06-30')).toBe(true);
  });

  it('detects touching ranges as overlapping (inclusive endpoints)', () => {
    // Jan 1 → Dec 31 touching Dec 31 → Dec 31 must overlap; the DB uses
    // daterange(..., '[]') so touching dates ARE an overlap.
    expect(rangesOverlap('2026-01-01', '2026-12-31', '2026-12-31', '2027-12-31')).toBe(true);
    expect(rangesOverlap('2026-01-01', '2026-06-30', '2026-06-30', '2026-07-31')).toBe(true);
  });

  it('returns false for non-overlapping ranges', () => {
    expect(rangesOverlap('2026-01-01', '2026-01-31', '2026-02-01', '2026-02-28')).toBe(false);
  });

  it('returns false for ranges separated by a gap', () => {
    expect(rangesOverlap('2026-01-01', '2026-03-31', '2026-05-01', '2026-12-31')).toBe(false);
  });

  it('is symmetric (order of arguments does not matter)', () => {
    const a = ['2026-01-01', '2026-06-30'];
    const b = ['2026-06-01', '2026-12-31'];
    expect(rangesOverlap(...a, ...b)).toBe(rangesOverlap(...b, ...a));
    expect(rangesOverlap(...a, ...b)).toBe(true);
  });

  it('handles identical ranges', () => {
    expect(rangesOverlap('2026-01-01', '2026-12-31', '2026-01-01', '2026-12-31')).toBe(true);
  });
});