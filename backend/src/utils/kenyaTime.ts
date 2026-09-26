// Kenya-calendar date helpers.
//
// The money pipeline, the portal, and the review queue all render or book
// timestamps on the Africa/Nairobi calendar — the business's own timezone —
// so a payment taken at 2026-09-01 00:30 Nairobi time belongs to September,
// not the August day a UTC server would see. One implementation here replaces
// four copies of the same Intl.DateTimeFormat(...) block.
//
// Callers, and what each uses:
//   * mpesaService        → kenyaDateParts (billing month/year + payment date)
//   * mpesaReviewService  → kenyaDateParts (same, for manual resolves)
//   * tenantPortalService → kenyaDateParts().date ("pay date" on the timeline)
//   * staleUnmatchedAlertJob → nairobiTimeLabel (human-readable escalation copy)

function formatParts(date: Date, locale: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: 'Africa/Nairobi', ...options }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

// en-CA gives strict YYYY-MM-DD ordering; the values are digits either way.
export function kenyaDateParts(date: Date): { date: string; month: number; year: number } {
  const values = formatParts(date, 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    month: Number(values.month),
    year: Number(values.year),
  };
}

// "14:05, 1 September 2026" — the arrival-time label in stale-payment
// escalation emails. en-GB (not en-CA) matters: it defaults to a 24-hour
// clock, and the operator-facing copy must keep rendering "14:05" not "2:05".
export function nairobiTimeLabel(date: Date): string {
  const v = formatParts(date, 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${v.hour}:${v.minute}, ${v.day} ${v.month} ${v.year}`;
}
