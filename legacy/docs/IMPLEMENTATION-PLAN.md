# IMPLEMENTATION-PLAN.md
## Rental Management System (Single Building) — phased build order

Work top to bottom. Do not start a phase until the previous phase's exit criteria are met — each phase depends on the last.

---

### Phase 0 — Project Setup
**Goal:** runnable skeleton, empty but correct.
- Initialize `server/` (`npm init`, install dependencies per TRD.md §4).
- Set up `client/` static file structure (empty HTML shells with shared layout).
- Write `.env.example`, `.gitignore`, base `README.md` skeleton.
- Stand up local Postgres, confirm connection from `server/src/config`.
- **Exit criteria:** `npm run dev` starts the server, health-check route (`GET /api/health`) returns `200`.

### Phase 1 — Schema, Migrations, Seed, Auth
**Goal:** database is real, login works.
- Write `migrations/001_init_schema.sql` exactly per BACKEND-SCHEMA.md / ARCHITECTURE.md §4.
- Write `migrations/002_seed_data.sql` per the seed baseline.
- Build `POST /api/auth/login`, `GET /api/auth/me`, `requireAuth` middleware, `requireRole` middleware.
- Build the Login page end-to-end (real login, real redirect, real error state).
- **Exit criteria:** can log in as the seeded admin user and hit a protected test route with the returned JWT.

### Phase 2 — Units & Tenants CRUD
**Goal:** the two foundational resources fully work, UI included.
- Implement `units` and `tenants` routes/controllers/models per the API contract.
- Implement archive-instead-of-delete logic for tenants, **including blocking archive itself when the tenant has an active lease** (`409 ARCHIVE_BLOCKED_ACTIVE_LEASE` — see HARD-QUESTIONS.md Q7); implement delete-blocked-by-history logic for units.
- Build Units and Tenants pages (list, filter, create modal, edit modal).
- **Exit criteria:** can create/edit a unit and a tenant through the UI, refresh the page, and see the data persisted.

### Phase 3 — Leases (the hardest part)
**Goal:** overlap-safe lease creation, unit status auto-sync.
- Implement `leases` routes/controllers/models, including the controller-side overlap pre-check.
- Confirm the DB `EXCLUDE` constraint actually rejects a forced overlap (write a deliberate test that tries to bypass the controller check).
- Implement the unit-status side effect (occupied on lease create, vacant on terminate/expire) inside the same DB transaction as the lease write.
- Build the Leases page including the 4-step creation wizard and the `409` conflict UX.
- **Exit criteria:** cannot create two overlapping active leases on the same unit, from the UI or a raw API call; unit status flips correctly both directions.

### Phase 4 — Payments
**Goal:** record payments, compute balance due correctly.
- Implement `payments` routes/controllers/models, including the CSV export endpoint.
- Implement `utils/calculateCyclesElapsed.js` and use it for the `balanceDue` calculation (see HARD-QUESTIONS.md Q3) — return `balanceDue` on payment creation.
- Reject new payments against a `status='terminated'` lease with `409 LEASE_TERMINATED` (HARD-QUESTIONS.md Q2).
- Build the Payments page (record form, history table with date-range filter, CSV export button).
- **Stretch (not exit-blocking):** duplicate-payment soft guard (HARD-QUESTIONS.md Q4); CSV export row cap at 5,000 with `X-Export-Truncated` header (HARD-QUESTIONS.md Q10).
- **Exit criteria:** recording a payment updates balance due correctly for both exact and partial/overpayment amounts; terminated leases reject new payments.

### Phase 5 — Maintenance Requests
**Goal:** full lifecycle tracked, invalid transitions blocked.
- Implement `maintenance_requests` routes/controllers/models, including the status-transition validator.
- Build the Maintenance page (new-request form, filterable table, inline status changes with client-side transition validation).
- **Exit criteria:** cannot force an illegal status transition (e.g., resolved → open) from either the UI or a raw API call; `resolved_at` stamps correctly.

### Phase 6 — Dashboard & Reports
**Goal:** the "why we built this" payoff screen.
- Implement all four `/reports/*` endpoints.
- Build the Dashboard page (summary cards, upcoming expirations table, quick actions).
- Build the Reports page (month/year picker, occupancy + rent collection blocks).
- **Exit criteria:** dashboard figures match a manual spot-check against the seeded data.

### Phase 7 — Tests
**Goal:** confidence the business rules hold under change.
- Unit tests: overlap-detection helper, balance-due calculation, lease/maintenance transition validators.
- Integration tests: auth, full CRUD per resource, archive-instead-of-delete behavior, lease overlap rejection, pagination.
- E2E tests: the 5 flows listed in the original build prompt §13.
- **Exit criteria:** `npm test` green across unit + integration; E2E suite passes locally against a seeded test DB.

### Phase 8 — Deployment
**Goal:** it runs somewhere other than localhost.
- Provision managed Postgres + Node web service (Render/Railway).
- Set all environment variables per TRD.md/README.
- Deploy static `client/` separately, point its `config.js` at the deployed API URL.
- Run through the production checklist in the original build prompt §14.
- **Exit criteria:** a fresh browser session against the production URL can log in and complete the Phase 3 lease-creation flow end-to-end.

---

## Definition of Done (every phase)

- Code matches ARCHITECTURE-ESSENTIALS.md rules exactly — no invented schema, no invented endpoints.
- No hardcoded secrets; `.env.example` updated if new variables were introduced.
- Relevant section of README updated (setup/run/test instructions stay accurate).
- Tests for that phase's new logic exist and pass before moving to the next phase.
