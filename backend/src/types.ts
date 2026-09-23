// Shared domain types.
//
// Cross-boundary shapes (roles, payment statuses, the API envelope and the
// dashboard payload) live in @rpms/shared and are re-exported here, so the
// backend keeps ONE import path while the frontend imports the package
// directly. A change there breaks both sides' typechecks — drift becomes a
// compile error instead of a runtime surprise.
import { type Role } from '@rpms/shared';

export {
  type DashboardData,
  type Pagination,
  type PaymentStatus,
  type ReceiptType,
  type Role,
} from '@rpms/shared';

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

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;