// Shared CSV cell escaping. Exporters used to inline `"${name}"` quoting,
// which breaks when a tenant name contains a double quote (and leaves
// comma/newline-bearing values unquoted). This mirrors privacyService's
// escaper, including the leading =+-@ formula-injection guard for Excel.
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote when the cell contains a comma, quote, newline, or a leading =+-@
  // (the last guards against CSV-formula injection in Excel).
  return /[\s",\n\r]/.test(s) || /^[=+@-]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
