// Shared domain types.

export type Role = 'ADMIN' | 'PROPERTY_MANAGER' | 'STAFF';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';
export type ReceiptType = 'RENT' | 'WATER' | 'COMBINED';

export interface AuthUser {
  userId: number;
  role: Role;
  name: string;
  email: string;
}

export interface SettingsRow {
  id: number;
  reporting_year: number;
  currency: string;
  water_rate: string;
  retention_years: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;