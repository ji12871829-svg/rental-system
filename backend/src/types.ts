// Shared domain types.

export type Role = 'ADMIN' | 'PROPERTY_MANAGER' | 'STAFF';
export type PaymentMethod = 'CASH' | 'M_PESA' | 'BANK' | 'OTHER';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';
export type ReceiptType = 'RENT' | 'WATER' | 'COMBINED';

export interface AuthUser {
  userId: number;
  role: Role;
  name: string;
  email: string;
}

export interface UnitRow {
  id: number;
  property_id: number;
  floor_id: number;
  unit_number: string;
  unit_type: string;
  monthly_rent: string;
  water_enabled: boolean;
  occupancy_status: 'OCCUPIED' | 'VACANT';
}

export interface TenantRow {
  id: number;
  unit_id: number | null;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  move_in_date: string | null;
  move_out_date: string | null;
  security_deposit: string;
  status: 'ACTIVE' | 'MOVED_OUT';
  notes: string | null;
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

export const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'M_PESA', 'BANK', 'OTHER'];
export const EXPENSE_CATEGORIES = [
  'WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE', 'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER',
] as const;