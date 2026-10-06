// Single source of truth for route-level code-split chunks.
//
// App.tsx turns each loader into a lazy() route; the sidebar turns each
// loader into a hover/focus/touch prefetch. Because both consume the SAME
// loader, a prefetched chunk is guaranteed to be the exact chunk the route
// later needs — one network request, then instant navigation.
//
// How prefetch works with Vite: each `import('./pages/X')` compiles to a
// module whose dynamic import is memoized by the browser's module map —
// calling it twice fetches once. The loaders here are thin wrappers around
// those same dynamic imports, so calling `.preload()` is idempotent and
// warms the same cache `lazy()` reads.

export const routeChunks = {
  landing: () => import('../pages/Landing'),
  register: () => import('../pages/Register'),
  login: () => import('../pages/Login'),
  dashboard: () => import('../pages/Dashboard'),
  instructions: () => import('../pages/Instructions'),
  settings: () => import('../pages/Settings'),
  units: () => import('../pages/Units'),
  tenants: () => import('../pages/Tenants'),
  rent: () => import('../pages/RentCollection'),
  water: () => import('../pages/Water'),
  ledger: () => import('../pages/TenantLedger'),
  monthly: () => import('../pages/MonthlySummary'),
  expenses: () => import('../pages/Expenses'),
  arrears: () => import('../pages/Arrears'),
  receipts: () => import('../pages/Receipts'),
  sms: () => import('../pages/SmsNotifications'),
  emailHistory: () => import('../pages/EmailHistory'),
  emailCampaign: () => import('../pages/EmailCampaign'),
  messageTemplates: () => import('../pages/MessageTemplates'),
  users: () => import('../pages/Users'),
  audit: () => import('../pages/AuditLogs'),
  clerkSignups: () => import('../pages/ClerkSignups'),
  privacyRegister: () => import('../pages/PrivacyRegister'),
  mpesaReview: () => import('../pages/MpesaReview'),
  maintenance: () => import('../pages/Maintenance'),
  vendors: () => import('../pages/Vendors'),
  expenseApprovals: () => import('../pages/ExpenseApprovals'),
  recurringExpenses: () => import('../pages/RecurringExpenses'),
  penalties: () => import('../pages/Penalties'),
  documents: () => import('../pages/Documents'),
  vacancies: () => import('../pages/Vacancies'),
  publicVacancies: () => import('../pages/PublicVacancies'),
  legal: () => import('../pages/Legal'),
} as const;

export type RouteChunkKey = keyof typeof routeChunks;

// Fire-and-forget: resolves when the chunk is in the module cache; a rejected
// import resolves too (offline/404) so callers never need to handle it — the
// real navigation will surface any genuine failure itself.
export function prefetchRoute(key: RouteChunkKey): void {
  void routeChunks[key]().catch(() => {});
}
