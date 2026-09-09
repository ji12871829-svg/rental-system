// dateOverlap.js — pure helper, unit-tested in tests/unit/dateOverlap.test.js.
// Returns true if the inclusive ranges [aStart, aEnd] and [bStart, bEnd] overlap.
//
// WHY inclusive: the leases EXCLUDE constraint uses daterange(start, end, '[]')
// (closed on both ends), so the DB treats touching dates as overlapping — the
// controller pre-check MUST agree with the DB or the friendly-409 and the raw
// constraint error would disagree. See AGENTS.md §4 and HARD-QUESTIONS.md.
//
// Accepts anything comparable: 'YYYY-MM-DD' strings compare correctly
// lexicographically, so no Date parsing (and no TZ pitfalls) is needed.
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

module.exports = { rangesOverlap };
