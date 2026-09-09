// formatDate.js — renders DATE-valued outputs as 'YYYY-MM-DD' strings.
//
// pg parses DATE columns into JS Date objects at LOCAL midnight, which JSON
// then serializes as a timestamp in an ambiguous zone ("2026-08-31T21:00Z").
// The API contract treats dates as date-only (no time, no timezone), so we
// rebuild 'YYYY-MM-DD' from local components — NOT toISOString(), which shifts
// a day for non-UTC servers. Accepts Date, 'YYYY-MM-DD' string, or ISO string.
function formatDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : s;
}

module.exports = { formatDate };