# M-Pesa Rent Automation Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with a focused validation after each task.

**Goal:** Accept confirmed M-Pesa C2B and STK Push payments, match them by unit number, record rent automatically, and send the existing receipt SMS.

**Architecture:** Add a provider-neutral M-Pesa adapter for OAuth, C2B callbacks, and STK Push. Persist every provider transaction in a deduplicated `mpesa_transactions` table before posting matched payments through a shared rent-payment service path. Unmatched callbacks remain `UNMATCHED` for review and never create an incorrect rent record.

**Tech Stack:** Express, TypeScript, PostgreSQL, Zod, React/Vite, Jest.

## Global Constraints

- Secrets remain in environment variables and are never sent to the frontend.
- All SQL is parameterized and schema changes remain idempotent.
- Callback endpoints are public provider endpoints but validate provider payloads and deduplicate provider transaction IDs.
- Existing receipt and SMS behavior is reused; M-Pesa must not duplicate it.
- NODE_ENV=test must never call Safaricom or send real SMS.

---

### Task 1: Persist M-Pesa transactions

**Files:**
- Modify: `database/schema.sql`
- Modify: `backend/src/db/bootstrap.ts` comments if needed
- Test: `backend/tests/unit/mpesaService.test.ts`

**Interfaces:**
- Produces table `mpesa_transactions` with unique `transaction_id`, provider type, account reference, amount, transaction date, phone, raw payload, processing status, tenant/payment references, and error text.

- [ ] Add an idempotent table with statuses `RECEIVED`, `MATCHED`, `POSTED`, `UNMATCHED`, `FAILED` and indexes for status, account reference, and created time.
- [ ] Add unit tests for transaction status transitions and duplicate transaction IDs at the service boundary.
- [ ] Run `npm --prefix backend run typecheck` and the focused Jest file.

### Task 2: Add M-Pesa configuration and provider adapter

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `.env.example`
- Create: `backend/src/services/mpesaProvider.ts`
- Test: `backend/tests/unit/mpesaProvider.test.ts`

**Interfaces:**
- `getMpesaConfig(): MpesaConfig`
- `requestStkPush(input): Promise<{ checkoutRequestId: string; merchantRequestId?: string; responseDescription?: string }>`
- `parseC2bCallback(payload): MpesaPaymentInput`
- `parseStkCallback(payload): MpesaPaymentInput | null`

- [ ] Add Daraja base URL, consumer credentials, shortcode, passkey, callback URL, and environment configuration.
- [ ] Implement OAuth with timeout and STK Push request signing using Basic Auth and the standard timestamp/password formula.
- [ ] Parse C2B and STK payloads defensively, requiring transaction ID, positive amount, account reference, and transaction date.
- [ ] Add tests for normalization, malformed payload rejection, STK success/failure parsing, and no-network test mode.

### Task 3: Post confirmed M-Pesa payments through rent service

**Files:**
- Modify: `backend/src/services/rentService.ts`
- Create: `backend/src/services/mpesaService.ts`
- Modify: `backend/src/routes/rent.ts`
- Create: `backend/src/routes/mpesa.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/unit/mpesaService.test.ts`

**Interfaces:**
- `processMpesaPayment(input: MpesaPaymentInput, source: 'C2B' | 'STK'): Promise<{ status: string; tenantId?: number; paymentId?: number; reason?: string }>`
- `createRentPayment(input, userId, execOptions?)` remains compatible for manual payments and can be called by the M-Pesa service with a system actor.
- `POST /api/mpesa/c2b/confirm`
- `POST /api/mpesa/stk/callback`
- `POST /api/rent/stk-push` authenticated endpoint

- [ ] Match `accountReference` to an active unit number; reject ambiguous or absent matches as `UNMATCHED`.
- [ ] Set billing month/year from the provider transaction date and payment method to `M_PESA`.
- [ ] Store the provider transaction before posting and use the unique provider ID to make retries idempotent.
- [ ] Reuse receipt creation, balance calculation, and SMS preparation/dispatch after the payment commits.
- [ ] Return provider-safe callback responses without exposing internal errors.
- [ ] Add authenticated STK initiation using the tenant phone and unit number as account reference.

### Task 4: Add configuration and operational documentation

**Files:**
- Modify: `.env.example`
- Modify: `docs/DEPLOY.md`
- Modify: `README.md` if the M-Pesa setup section belongs there

- [ ] Document Daraja sandbox/production variables, callback URLs, Paybill/Till registration, and the requirement that tenants use unit number as account reference.
- [ ] Document that unmatched callbacks require manual review and that `SMS_PROVIDER` must be configured for real confirmation SMS.

### Task 5: Verify end to end

- [ ] Run `npm run typecheck:all`.
- [ ] Run `npm --prefix backend run test:unit`.
- [ ] Run a local database schema application and verify `mpesa_transactions` exists.
- [ ] Test a duplicate callback and verify only one rent payment and one SMS notification are created.
- [ ] Run `git diff --check` on task files.
