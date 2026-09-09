# Rental Management System (Single Building)

A complete, runnable rental management system for ONE residential building:
units, tenants, leases, rent payments, maintenance requests, and owner-facing
reports. Backend is Node.js + Express + PostgreSQL (raw parameterized SQL, no
ORM); frontend is plain HTML/CSS/vanilla JS with no build step.

## Assumptions (locked for v1)

- **One building.** Its address lives once in the `building_settings` table,
  not per unit. Multi-building seams are documented in
  `docs/extensibility-notes.md`.
- Units are identified by a unique `unit_number` (string, e.g. `"14"`, `"2B"`)
  — unique within the building.
- Currency is **USD**; all money is `NUMERIC(10,2)`.
- Rent is billed on a **monthly** cycle; the move-in month is billed in full
  (no day proration).
- **One active lease per unit** at a time (no co-leases).

## Prerequisites

- **Node.js 20+** (developed and tested on Node 22/26)
- **PostgreSQL 15+** (tested on 18) running on `localhost:5432`

## Quick start (local)

```bash
# 1. Provision the database role + database once (as the postgres superuser):
psql -U postgres -h localhost -c "CREATE ROLE rms_user LOGIN PASSWORD 'rms_password' CREATEDB;"
psql -U postgres -h localhost -c "CREATE DATABASE rental_management OWNER rms_user;"

# 2. Server
cd server
cp .env.example .env        # then edit: set a real JWT_SECRET, your DATABASE_URL
npm install
npm run migrate             # applies migrations/001 + 002 (idempotent)
npm run seed                # seeds data incl. admin (idempotent)
npm run dev                 # http://localhost:4000

# 3. Frontend (any static file server — no build step)
npx serve client/public -l 5173
```

**Seed login:** `admin@olbano.example` / `ChangeMe123!` (change in production).
Seed data: 3 units, 2 tenants, 2 active leases, 3 payments, 2 maintenance
requests, building settings, admin user.

> `npm run migrate` and `npm run seed` are **idempotent** — safe to re-run.
> `migrate` tracks applied files in a `schema_migrations` table; `seed` guards
> every insert.

## Environment variables (`server/.env.example`)

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` locally, `production` deployed |
| `PORT` | HTTP port (default `4000`) |
| `DATABASE_URL` | `postgres://rms_user:rms_password@localhost:5432/rental_management` |
| `JWT_SECRET` | Long random string; **rotate before production** |
| `JWT_EXPIRES_IN` | Access-token lifetime, default `8h` |
| `BCRYPT_SALT_ROUNDS` | Password hash cost, default `12` |
| `CORS_ORIGIN` | Exact frontend origin (no wildcards in production) |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Global limiter window/max |
| `RMS_TEST_DB` | (tests only) test DB name, default `rental_management_test` |

`.env` is gitignored — never commit it. Secrets load exclusively via
`process.env`.

## Authentication & security model

- `POST /api/auth/login` verifies credentials and sets TWO cookies:
  - **`rms_token`** — the JWT (8h), **httpOnly + SameSite=Lax** (+ `Secure` in
    production). JavaScript can never read it, which closes the
    token-exfiltration hole localStorage had.
  - **`rms_csrf`** — a random double-submit CSRF token (readable cookie, same
    SameSite/Secure rules). The same value is embedded as a claim inside the
    JWT.
- Every **state-changing** request (`POST/PATCH/DELETE`) must send the CSRF
  token in the `X-CSRF-Token` header; `csrfProtection` middleware requires it
  to match both the cookie and the JWT claim (`403` otherwise). Cross-site
  attackers can read neither, and SameSite=Lax additionally stops the cookie
  from being attached to cross-site mutations at all.
- **API clients** (Postman, scripts, e2e tooling) use
  `POST /api/auth/login/token`, which returns the raw JWT for
  `Authorization: Bearer` — bearer requests are not CSRF-able (headers can't
  be attached cross-site), so the CSRF check is skipped for them by design.
- `POST /api/auth/logout` clears both cookies.
- `localStorage` now holds only the non-sensitive display profile
  (`{ id, fullName, email, role }`) — never a credential.
- Roles: **admin** (full access incl. destructive deletes) and **manager**
  (day-to-day operations; no deletes).
- Passwords hashed with **bcrypt cost 12**; login rate-limited to **5 attempts /
  15 minutes per IP** (IP-based only — accounts are never locked).
- All request bodies validated with **zod**; all SQL is **parameterized**
  (`$1, $2…`); no user input ever reaches a SQL string.
- Deployment notes: cookies require HTTPS in production (`Secure` is set
  automatically when `NODE_ENV=production`); keep frontend and API on the
  same site (same registrable domain — a reverse proxy putting both behind one
  hostname is the simplest) so SameSite=Lax cookies flow.

## Business rules enforced (API + DB, defense in depth)

1. No overlapping **active** leases per unit — controller pre-check returns a
   friendly `409`, the Postgres `EXCLUDE USING gist` constraint is the
   race-condition safety net.
2. `end_date` strictly after `start_date` (else `422`).
3. Payments may be partial or overpayments — never rejected on amount; the
   resulting balance is returned as `balanceDue`
   (`cyclesElapsed × monthlyRent − SUM(payments)`). Terminated leases **reject**
   new payments (`409 LEASE_TERMINATED`).
4. Tenants: hard-delete blocked while any active lease exists; **archiving is
   also blocked** while an active lease exists (`409 ARCHIVE_BLOCKED_ACTIVE_LEASE`).
5. Units with lease/maintenance history cannot be deleted (`409`) — "deactivate"
   via `status='maintenance'` instead.
6. Lease creation flips the unit to `occupied`; termination/expiry flips it back
   to `vacant` — both in the **same transaction** as the lease write.
7. Maintenance state machine: `open → in_progress → resolved`, or
   `open/in_progress → cancelled`; `resolved` stamps `resolved_at = NOW()`;
   illegal transitions `422`.

There is **no automatic date-based lease expiry** in v1 — status changes are
manual via `PATCH`, nudged by the Dashboard's upcoming-expirations list
(`docs/HARD-QUESTIONS.md` Q6).

## API overview

All protected routes require `Authorization: Bearer <token>`. Lists paginate
with `?page&limit` (default 20, max 100) and return
`{ data, pagination: { page, limit, total, totalPages } }`. Errors always:
`{ error: CODE, message, details }` with statuses `400/401/403/404/409/422/429/500`.

| Resource | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` |
| Units | `GET /units`, `GET /units/:id`, `POST /units`, `PATCH /units/:id`, `DELETE /units/:id` (admin) |
| Tenants | `GET /tenants`, `GET /tenants/:id`, `POST /tenants`, `PATCH /tenants/:id`, `PATCH /tenants/:id/archive`, `DELETE /tenants/:id` (admin) |
| Leases | `GET /leases`, `GET /leases/:id`, `POST /leases`, `PATCH /leases/:id`; `DELETE` = 405 |
| Payments | `GET /payments`, `GET /payments/:id`, `POST /payments`, `GET /payments/export` (CSV) |
| Maintenance | `GET /maintenance`, `GET /maintenance/:id`, `POST /maintenance`, `PATCH /maintenance/:id` |
| Reports | `GET /reports/occupancy`, `GET /reports/rent-collection`, `GET /reports/upcoming-lease-expirations`, `GET /reports/outstanding-balances` |
| Health | `GET /api/health` |

Full request/response examples live in the Postman collection
(`postman/rental-management.postman_collection.json`) — every endpoint has at
least one success and one failure example.

## Project structure

```
server/        Express API (config, middleware, routes, controllers, models, utils)
client/        Static frontend (public HTML pages, css, js — no build step)
migrations/    001_init_schema.sql, 002_seed_data.sql
tests/         unit/ (Jest, pure functions), integration/ (Jest+Supertest vs
               isolated test DB), e2e/ (Playwright specs)
postman/       Full API collection
docs/          planning docs (PRD/TRD/ARCHITECTURE, kept from the original
               project), wireframes/, extensibility-notes.md
```

## Running tests

```bash
cd server
npm test                 # unit + integration (81 tests), creates/uses
                         # rental_management_test — never touches dev data
npm run test:unit        # pure-function tests only (no DB)
npm run test:integration # DB-backed API tests
```

Unit tests: date-overlap helper, balance-due cycle math, lease + maintenance
transition validators, password rules. Integration tests: auth success/failure,
unit CRUD + pagination, tenant archive-instead-of-delete (incl. active-lease
block), lease overlap rejection + unit-status sync, payment creation +
balance + terminated-lease + duplicate guard, CSV export, maintenance lifecycle,
all four reports against known seeded numbers.

**E2E (Playwright):** specs for all 5 required flows in `tests/e2e/src/`.
Run them against the live stack (`npm run dev` + `npx serve client/public -l 5173`):

```bash
cd tests/e2e
npm i && npx playwright install chromium
npx playwright test
```

## Design decisions (judgment calls not covered by the spec)

- **Cookie sessions + CSRF (post-v1 hardening):** auth migrated from
  localStorage JWTs to httpOnly SameSite=Lax cookies with a double-submit CSRF
  token bound to the JWT (`csrf` claim). The JWT is never in a response body
  on the web flow; `POST /auth/login/token` exists purely for API clients.
  Bearer-authenticated requests skip the CSRF check (not CSRF-able by
  construction) — documented and covered by tests.
- **Billing-cycle formula:** `cycles = calendar months between start and
  min(today, end) + 1` — the move-in month bills in full, no day proration.
  Implemented once in `server/src/utils/calculateCyclesElapsed.js` and reused
  by payments and reports (see `docs/HARD-QUESTIONS.md` Q3).
- **Reports:** occupancy counts units covered by an active lease in the month;
  "vacant" excludes `maintenance` units (a maintenance unit is not rentable).
  Rent collection bills active leases covering the month with no proration.
- **CSV export** capped at 5,000 rows with `X-Export-Truncated: true`
  header (Q10); duplicate payments within 60s → `409 DUPLICATE_PAYMENT` (Q4).
- **No account lockout** — login limiter is IP-based only (Q9).
- **Seed admin hash** is generated at seed time by `runSeed.js` (never stored
  in the repo); the seed SQL itself is guard-idempotent.
- **User management** endpoints are out of scope (spec has no users CRUD); the
  admin row comes from the seed file, and a `manager` can be inserted directly
  for testing (`tests/integration/tenants.test.js` shows the pattern).

## Deploying (checklist)

Backend on **Render/Railway** as a Node web service, managed Postgres add-on;
frontend as a static site (Render Static/Netlify/Vercel).

- [ ] Set every variable from the env table in the platform's env settings
      (`DATABASE_URL` with `?sslmode=require` in production) — **never commit `.env`**
- [ ] Run `npm run migrate && npm run seed` once via a one-off job / release command
- [ ] Frontend: deploy `client/` as a static site; point `client/js/config.js`
      at the production API URL (no rebuild needed — it's a runtime file)
- [ ] `CORS_ORIGIN` restricted to the exact deployed frontend origin (no wildcards)
- [ ] `NODE_ENV=production` set; DB connection uses SSL
- [ ] `JWT_SECRET` rotated from any development value (long, random)
- [ ] Rate limiting confirmed active (global + stricter login limiter)
- [ ] Confirm hosting provider schedules nightly DB backups
- [ ] Confirm `.env` was never committed (check git history, not just `.gitignore`)
- [ ] HTTPS throughout (hosting platform's automatic TLS; never plain HTTP)

Full details in `docs/TRD.md §3` and the build prompt §14.

## Debugging / maintenance

- View server logs: the error handler logs full stacks server-side; clients
  only ever get generic 500 messages.
- Reset to a pristine dev DB: drop the schema and re-run `npm run migrate &&
  npm run seed` (see `server/src/config/runMigrations.js`).