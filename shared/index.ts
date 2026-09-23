// RPMS shared types — the single source of truth for shapes that cross the
// API boundary. Backend and frontend both import from this package, so a
// change on one side breaks the other side's typecheck instead of drifting
// silently. Types only: no runtime code, no dependencies.
//
// Adding a type here? It must be consumed by BOTH sides (knip enforces this).
// Frontend-only UI types belong in the frontend; backend row types belong in
// the backend services.

// ---------------------------------------------------------------------------
// Enums / literal unions
// ---------------------------------------------------------------------------

/** Staff account roles (users.role). */
export type Role = 'ADMIN' | 'PROPERTY_MANAGER' | 'STAFF';

/** Computed per-tenant-month payment status (rent + water pages, PDFs). */
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';

/** Receipt kinds. */
export type ReceiptType = 'RENT' | 'WATER' | 'COMBINED';

/** Payment methods accepted across rent, water and expenses. */
export type PaymentMethod = 'CASH' | 'M_PESA' | 'BANK' | 'OTHER';

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

/** Success envelope: every endpoint answers `{ data: … }` (+ optional pagination). */
export interface ApiItemResponse<T> {
  data: T;
}

/** List envelope: paginated endpoints answer `{ data: rows, pagination }`. */
export interface ApiListResponse<T> {
  data: T[];
  pagination: Pagination;
}

/** Error envelope: every failure answers `{ error, message, details }` (httpError.ts). */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Metadata every paginated list response carries. */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Dashboard (GET /api/reports/dashboard) — the widest response in the app
// ---------------------------------------------------------------------------

/** Most recent failed send this month (SMS + email health strips). */
export interface LastFailure {
  at: string;
  reason: string;
}

/**
 * SMS wallet health. Members carry single-literal `state` fields so
 * `state === 'x'` narrows exactly; `balance` is present only when a real
 * provider reported one.
 */
export type SmsBalance =
  | { state: 'unknown'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'ok'; balance: { amount: number; currency: string }; threshold: number | null }
  | { state: 'low'; balance: { amount: number; currency: string }; threshold: number | null }
  | { state: 'empty'; balance: { amount: number; currency: string }; threshold: number | null };

/**
 * Water-year summary KPIs. Used directly by GET /api/reports/water-summary
 * (which appends `currency`) and — minus `currency`, which the dashboard
 * payload carries at the top level — as the shape of DashboardData.water.
 */
export interface WaterSummaryRow {
  waterBilled: number;
  waterCollected: number;
  waterOutstanding: number;
  waterPurchased: number;
  waterSupplyCost: number;
  averagePurchaseCost: number;
  collectionRate: number;
  surplusDeficit: number;
  surplus: boolean;
  currency: string;
}

/**
 * One row of the dashboard's per-unit outstanding-water chart. Mirrors the
 * backend's `OutstandingWaterRow` (waterService) — keep in sync via the same
 * field names.
 */
export interface OutstandingWaterRow {
  unitId: number;
  unitNumber: string;
  tenantName: string | null;
  waterBilled: number;
  waterPaid: number;
  waterOutstanding: number;
}

/** The full dashboard payload — property, water and combined KPIs + charts. */
export interface DashboardData {
  reportingYear: number;
  currency: string;
  property: {
    totalUnits: number;
    occupiedUnits: number;
    vacantUnits: number;
    expectedRent: number;
    expectedRentYtd: number;
    rentCollected: number;
    rentOutstanding: number;
    rentCollectionRate: number;
    totalExpenses: number;
    netPropertyIncome: number;
  };
  water: Omit<WaterSummaryRow, 'currency'>;
  combined: {
    totalDueThisMonth: number;
    totalCollected: number;
    totalOutstanding: number;
    rentCollected: number;
    waterCollected: number;
    totalExpenses: number;
    netIncome: number;
  };
  sms: {
    balance: SmsBalance;
    sentThisMonth: number;
    failedThisMonth: number;
    /** Optional: older API payloads predate it. */
    lastFailure?: LastFailure | null;
  };
  /** Absent on older payloads / when email has never been configured. */
  email?: {
    sentThisMonth: number;
    failedThisMonth: number;
    pendingCount: number;
    lastFailure: LastFailure | null;
  };
  charts: {
    monthlyRentCollected: { month: number; collected: number }[];
    expectedVsCollected: { month: number; expected: number; collected: number }[];
    occupiedVsVacant: { occupied: number; vacant: number };
    rentByPaymentMethod: { method: string; total: number }[];
    outstandingRentByUnit: { unitNumber: string; outstanding: number }[];
    monthlyWaterBilledVsCollected: { month: number; billed: number; collected: number }[];
    waterSupplyCostVsCollected: { month: number; supplyCost: number; collected: number }[];
    monthlyWaterSurplusDeficit: { month: number; surplusDeficit: number }[];
    outstandingWaterByUnit: OutstandingWaterRow[];
  };
}
