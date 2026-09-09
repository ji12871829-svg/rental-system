// Money helpers. PostgreSQL returns NUMERIC as strings — always normalize
// through n() before arithmetic so results are JS numbers rounded to cents.

export function n(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number, currency = 'KSh'): string {
  return `${currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}