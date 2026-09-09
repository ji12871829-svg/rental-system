export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function money(value: number | string | null | undefined, currency = 'KSh'): string {
  const n = Number(value ?? 0);
  return `${currency} ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

export function number(value: number | string | null | undefined): string {
  return Number(value ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

export function methodLabel(m: string): string {
  const map: Record<string, string> = {
    CASH: 'Cash',
    M_PESA: 'M-Pesa',
    BANK: 'Bank',
    OTHER: 'Other',
  };
  return map[m] ?? m;
}

export function categoryLabel(c: string): string {
  return c.charAt(0) + c.slice(1).toLowerCase();
}

// Tailwind classes per status — keep statuses consistent across the app.
const statusClasses: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-800',
  OVERPAID: 'bg-blue-100 text-blue-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  UNPAID: 'bg-red-100 text-red-800',
  OVERDUE: 'bg-red-600 text-white',
  CLEARED: 'bg-emerald-100 text-emerald-800',
  OCCUPIED: 'bg-emerald-100 text-emerald-800',
  VACANT: 'bg-gray-200 text-gray-700',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  MOVED_OUT: 'bg-gray-200 text-gray-700',
  INACTIVE: 'bg-gray-200 text-gray-700',
  PENDING: 'bg-amber-100 text-amber-800',
  SENT: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  // SMS delivery-report outcomes (beyond the send lifecycle).
  DELIVERED: 'bg-emerald-600 text-white',
  FAILED_ON_NETWORK: 'bg-red-600 text-white',
  SURPLUS: 'bg-emerald-100 text-emerald-800',
  DEFICIT: 'bg-red-100 text-red-800',
};

export function statusClass(status: string): string {
  return statusClasses[status] ?? 'bg-gray-100 text-gray-700';
}