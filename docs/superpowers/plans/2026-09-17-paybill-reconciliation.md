# PayBill Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one landlord PayBill channel that displays safe rent/water references to tenants and automatically reconciles confirmed C2B callbacks into rent or water payments.

**Architecture:** Extend the existing `business_branding` singleton with typed PayBill fields and expose a tenant-safe payment-instructions view. Extend the existing M-Pesa transaction lifecycle with a payment kind and water-payment link, then route C2B callbacks through a parser and idempotent reconciliation service. Add a staff review API for unmatched callbacks and preserve the current STK rent flow.

**Tech Stack:** Express, TypeScript, PostgreSQL, Zod, Jest, React, Vite, Tailwind utility classes.

## Global Constraints

- One landlord PayBill serves all tenants.
- Rent references use `UNIT-NUMBER`; water references use `UNIT-NUMBER-WATER`.
- Account references are normalized for trimming and case-insensitive comparison, while displayed unit numbers remain unchanged.
- Unknown, ambiguous, duplicate, malformed, or water-disabled callbacks must not create payments automatically.
- Existing STK Push behavior remains compatible and rent-only.
- M-Pesa provider credentials remain server-only.
- Database changes must be safe for an existing production database and preserve existing transactions.

---

### Task 1: Add typed PayBill and transaction schema

**Files:**
- Modify: `database/schema.sql`
- Create: `backend/src/db/migrations/002_paybill_reconciliation.sql`
- Test: `backend/tests/unit/paybillSchema.test.ts`

**Interfaces:**
- Add nullable `paybill_number`, `paybill_name`, `paybill_enabled`, and `paybill_instructions` columns to `business_branding`.
- Add `payment_kind` with values `RENT` and `WATER`, plus nullable `water_payment_id`, to `mpesa_transactions`.
- Expand transaction status values with `AMBIGUOUS` and add indexes for status and account reference.
- The migration must use `IF NOT EXISTS` / guarded constraint operations so it can run against an already-bootstrapped database.

- [ ] Add the columns and constraints to the declarative schema.
- [ ] Write the idempotent production migration.
- [ ] Add unit coverage for reference normalization and `UNIT-NUMBER-WATER` parsing contracts.
- [ ] Run `npm --prefix backend run typecheck` and the focused test file.

### Task 2: Add payment configuration API and service

**Files:**
- Modify: `backend/src/services/brandingService.ts`
- Modify: `backend/src/routes/branding.ts`
- Modify: `frontend/src/lib/BrandingContext.tsx`
- Modify: `frontend/src/pages/Settings.tsx`
- Test: `backend/tests/unit/paybillConfig.test.ts`

**Interfaces:**
- Extend `BrandingRow`, `BrandingInput`, and `BrandingView` with the four PayBill fields and a nested `paymentInstructions` view containing rent and water references only when enabled.
- Validate PayBill numbers as 5-10 digits and instructions as a bounded string.
- Keep public branding responses limited to PayBill display information; never expose provider credentials.

- [ ] Add service mapping and environment fallback-free typed fields.
- [ ] Add manager/admin validation and update handling.
- [ ] Add Settings controls for PayBill number, business name, instructions, and enabled state.
- [ ] Show saved/unsaved state consistently with existing identity settings.
- [ ] Run backend and frontend type checks plus focused configuration tests.

### Task 3: Add tenant payment instructions

**Files:**
- Modify: `backend/src/services/tenantPortalService.ts`
- Modify: `backend/src/routes/tenantPortal.ts`
- Modify: `frontend/src/pages/portal/PortalPayments.tsx`
- Test: `backend/tests/unit/tenantPaymentInstructions.test.ts`

**Interfaces:**
- Add `GET /api/portal/payment-instructions` returning the active PayBill number, business name, tenant unit reference, optional water reference, and instructions.
- Derive references from the authenticated tenant's current unit; the request must not accept a tenant or reference parameter.

- [ ] Implement tenant-scoped instruction lookup.
- [ ] Add copyable rent/water reference controls and explicit reference warnings.
- [ ] Hide the panel when PayBill is disabled while leaving STK Push unchanged.
- [ ] Test tenant scoping and water-enabled behavior.

### Task 4: Implement C2B reference parsing and reconciliation

**Files:**
- Modify: `backend/src/services/mpesaProvider.ts`
- Modify: `backend/src/services/mpesaService.ts`
- Modify: `backend/src/routes/mpesa.ts`
- Modify: `backend/src/services/waterService.ts`
- Test: `backend/tests/unit/paybillReconciliation.test.ts`

**Interfaces:**
- Add `parsePaybillReference(reference: string): { normalizedUnitNumber: string; kind: 'RENT' | 'WATER' }`.
- Add `processPaybillPayment(input: MpesaPaymentInput)` returning `POSTED`, `UNMATCHED`, `AMBIGUOUS`, or `DUPLICATE` with linked IDs when posted.
- Add a system-payment path to `createWaterPayment` that accepts `userId: null` and preserves receipt/notification behavior.

- [ ] Parse rent and water references with trimming and case normalization.
- [ ] Match exactly one active tenant/unit and reject unknown or ambiguous matches.
- [ ] Reject water callbacks when the unit has water disabled.
- [ ] Deduplicate by transaction ID before posting.
- [ ] Post rent through `createRentPayment` and water through `createWaterPayment`, linking the transaction row only after the payment succeeds.
- [ ] Preserve raw payloads and reasons for every non-posted callback.
- [ ] Keep STK callback behavior unchanged except for shared deduplication compatibility.
- [ ] Run the focused reconciliation tests and backend typecheck.

### Task 5: Add unmatched transaction review API

**Files:**
- Create: `backend/src/services/mpesaReviewService.ts`
- Create: `backend/src/routes/mpesaReview.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/unit/mpesaReview.test.ts`

**Interfaces:**
- Add authenticated manager/admin endpoints under `/api/mpesa/review` to list, inspect, resolve, and ignore non-posted C2B transactions.
- Resolution accepts `tenantId` and `kind`, validates the tenant/unit and water eligibility, posts exactly once, and records an audit event.

- [ ] Implement paginated review listing with safe fields and reason/status filters.
- [ ] Implement explicit resolution and ignore actions with transaction locking/idempotency.
- [ ] Add audit records containing original reference, selected tenant, payment kind, and resulting payment ID.
- [ ] Register the route and run focused review tests.

### Task 6: Add staff review UI and verify the full feature

**Files:**
- Create: `frontend/src/pages/MpesaReview.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/lib/format.ts`
- Test: `backend/tests/unit/paybillReconciliation.test.ts`

- [ ] Add a staff review page showing transaction ID, amount, reference, date, reason, and action controls.
- [ ] Add tenant and payment-kind selection for manual resolution.
- [ ] Add the route and navigation item with existing role conventions.
- [ ] Run backend unit tests, all type checks, frontend and backend production builds, and `node scripts/verify-live.mjs` against a deployed environment after release.
- [ ] Review the final diff for accidental generated files and migration safety.
