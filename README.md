# RPMS — Rental Property Management System

A full-stack property-management application for Kenyan landlords and property
managers: staff manage properties, tenants, rent and water billing, M-Pesa
payments, receipts, and tenant communications from one dashboard, while tenants
get a self-service portal.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Node.js + Express (TypeScript), `pg` / PostgreSQL, JWT auth (separate staff & portal secrets) |
| Frontend | React 19 + Vite (TypeScript), Tailwind CSS 4, Recharts |
| Database | PostgreSQL (Neon in production), SQL schema + migrations in `database/` |
| Infra    | Deployed on Render (single web service serving the built SPA), CI via GitHub Actions |

## Repos layout

```
backend/    Express API server (src/routes, src/services, src/middleware, src/db)
frontend/   React SPA (src/pages, src/components, src/lib)
database/   schema.sql, seed.sql, and numbered migrations (00x_*.sql)
docs/       runbooks (Clerk setup, M-Pesa callback gate, logo migration, deploy)
scripts/    utility scripts (e.g. delete-user.ts)
```

## Features

- **Properties & units** — units, occupancy, leases, move-in tracking
- **Rent collection** — payment ledger, arrears (move-in-aware), receipts (PDF)
- **Water billing** — meter readings, per-unit invoicing, bulk supply cost & margin
- **M-Pesa** — Daraja STK push (staff-initiated), C2B callback auto-matching, review queue
- **Tenant portal** — credentials issued by staff, self-service balances/statements, send-money payment instructions
- **Messaging** — SMS + email providers with health checks, queued notifications, statement delivery
- **Auth** — staff JWT with audience separation, optional dormant Clerk bridge, CSRF protection, audit log

## Getting started

```bash
# 1. Database — create the schema and seed data
cd backend && npm i && npm run db:setup

# 2. Backend API (localhost:4000)
npm run dev

# 3. Frontend (localhost:5173, proxies /api to :4000)
cd ../frontend && npm i && npm run dev
```

First account: with an **empty users table**, registering via the app's
"Create account → Landlord/Agent" form creates the initial **admin**; every
later registration becomes an approval request handled in Users. No seeded
credentials ship with the codebase.

## Testing & checks

```bash
cd backend && npm test              # Jest integration suite (227 tests)
cd frontend && npx tsc --noEmit     # strict typecheck
cd frontend && npm run build        # production build
```

## Environment

Copy `backend/.env.example` → `backend/.env` and fill in the database URL,
JWT secrets, and (optionally) email/SMS/M-Pesa provider keys. See
`docs/DEPLOY.md` for the full variable reference and Render deployment steps.
