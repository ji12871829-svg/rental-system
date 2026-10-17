// Client-side CSV export for list pages — the current filtered view, not the
// whole table. Rent/water payment exports stay server-side (they can span
// months); these small operational lists (units, tenants, vendors…) fit in
// the loaded page, so no new endpoint is needed. Excel opens the output
// directly; a BOM keeps non-ASCII names intact.
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (unknown[] | Record<string, unknown>)[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) {
    const vals = Array.isArray(r) ? r : headers.map((h) => (r as Record<string, unknown>)[h]);
    lines.push(vals.map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
