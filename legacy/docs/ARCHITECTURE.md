# ARCHITECTURE.md
## Rental Management System (Single Building)

This is the full architecture reference. For a condensed, agent-context-friendly version, see `ARCHITECTURE-ESSENTIALS.md`.

---

## 1. System Overview

```
┌─────────────────┐        HTTPS/JSON        ┌──────────────────┐        SQL        ┌──────────────┐
│  Static Frontend │  ───────────────────────▶ │  Express Backend │ ─────────────────▶│  PostgreSQL  │
│  (HTML/CSS/JS)   │ ◀─────────────────────── │  (Node.js)       │ ◀─────────────────│              │
└─────────────────┘                           └──────────────────┘                   └──────────────┘
     served statically                          stateless, JWT-auth                    single source
     (Netlify/Vercel/                           on Render/Railway                       of truth
      Render Static)
```

The frontend holds no business logic beyond form validation and optimistic UI updates. All business rules (lease overlap, status transitions, balance calculations) live in the backend controllers, backed by database constraints as a safety net.

## 2. Repository Structure

```
rental-management-system/
├── server/
│   ├── src/
│   │   ├── config/           # db connection, env loading, migration/seed runners
│   │   ├── middleware/       # auth, error handler, rate limiter, validation
│   │   ├── routes/           # one file per resource
│   │   ├── controllers/      # business logic per resource
│   │   ├── models/           # SQL query functions per resource
│   │   ├── utils/            # helpers (date overlap check, pagination helper)
│   │   └── app.js
│   ├── server.js
│   ├── package.json
│   └── .env.example
├── client/
│   ├── public/                # one .html file per page
│   ├── css/styles.css
│   └── js/                    # one .js file per page + shared api.js
├── migrations/
│   ├── 001_init_schema.sql
│   └── 002_seed_data.sql
├── tests/{unit,integration,e2e}/
├── postman/rental-management.postman_collection.json
├── docs/                      # this planning doc set
└── README.md
```

## 3. Request Lifecycle

1. Frontend `fetch()` call (via `client/js/api.js`) attaches `Authorization: Bearer <token>` from `localStorage`.
2. Express route (`routes/*.js`) receives the request, passes to `middleware/requireAuth` (validates JWT) and, where needed, `middleware/requireRole('admin')`.
3. Request body validated against a `zod`/`joi` schema in the controller before touching the database.
4. Controller calls the relevant `models/*.js` function, which runs a parameterized SQL query.
5. Business rules (e.g., lease overlap) are checked in the controller *before* the insert, in addition to the database constraint catching it as a last resort.
6. Response shaped per the API contract (see §5) and returned as JSON.
7. Central error-handling middleware catches thrown errors and maps them to the standard error shape (see §6).

## 4. Data Model (full SQL — canonical source is `migrations/001_init_schema.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(150) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE building_settings (
  id              SERIAL PRIMARY KEY,
  building_name   VARCHAR(150) NOT NULL,
  address_line1   VARCHAR(255) NOT NULL,
  address_line2   VARCHAR(255),
  city            VARCHAR(100) NOT NULL,
  country         VARCHAR(100) NOT NULL DEFAULT 'Kenya',
  currency        VARCHAR(3)   NOT NULL DEFAULT 'USD',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE units (
  id              SERIAL PRIMARY KEY,
  unit_number     VARCHAR(20)  NOT NULL UNIQUE,
  floor           VARCHAR(20),
  bedrooms        SMALLINT     NOT NULL DEFAULT 1 CHECK (bedrooms >= 0),
  bathrooms       SMALLINT     NOT NULL DEFAULT 1 CHECK (bathrooms >= 0),
  square_feet     INTEGER,
  base_rent       NUMERIC(10,2) NOT NULL CHECK (base_rent >= 0),
  status          VARCHAR(20)  NOT NULL DEFAULT 'vacant'
                    CHECK (status IN ('vacant', 'occupied', 'maintenance')),
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_units_status ON units(status);

CREATE TABLE tenants (
  id                      SERIAL PRIMARY KEY,
  first_name              VARCHAR(100) NOT NULL,
  last_name               VARCHAR(100) NOT NULL,
  email                   VARCHAR(255) NOT NULL UNIQUE,
  phone                   VARCHAR(30)  NOT NULL,
  national_id             VARCHAR(50),
  emergency_contact_name  VARCHAR(150),
  emergency_contact_phone VARCHAR(30),
  is_archived             BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tenants_is_archived ON tenants(is_archived);

CREATE TABLE leases (
  id              SERIAL PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  monthly_rent    NUMERIC(10,2) NOT NULL CHECK (monthly_rent >= 0),
  deposit_amount  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'terminated')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date > start_date),
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'active')
);
CREATE INDEX idx_leases_unit_id   ON leases(unit_id);
CREATE INDEX idx_leases_tenant_id ON leases(tenant_id);
CREATE INDEX idx_leases_status    ON leases(status);
CREATE INDEX idx_leases_end_date  ON leases(end_date);

CREATE TABLE payments (
  id                SERIAL PRIMARY KEY,
  lease_id          INTEGER NOT NULL REFERENCES leases(id) ON DELETE RESTRICT,
  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  payment_date      DATE NOT NULL,
  payment_method    VARCHAR(20) NOT NULL
                      CHECK (payment_method IN ('cash','mpesa','bank_transfer','card','other')),
  reference_number  VARCHAR(100),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_lease_id     ON payments(lease_id);
CREATE INDEX idx_payments_payment_date ON payments(payment_date);

CREATE TABLE maintenance_requests (
  id              SERIAL PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  tenant_id       INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  description     TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved','cancelled')),
  priority        VARCHAR(10) NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','urgent')),
  assigned_vendor VARCHAR(150),
  cost            NUMERIC(10,2) CHECK (cost >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX idx_maintenance_unit_id ON maintenance_requests(unit_id);
CREATE INDEX idx_maintenance_status  ON maintenance_requests(status);
```

### Entity Relationship Summary

```
users            (standalone — auth only)
building_settings (standalone — single row)

units 1───* leases *───1 tenants
leases 1───* payments
units  1───* maintenance_requests *───0..1 tenants
```

## 5. API Contract (summary — see individual endpoint docs in the original build prompt / Postman collection for full detail)

Base path: `/api`. All protected routes require `Authorization: Bearer <token>`.

- `POST /auth/login`, `GET /auth/me`
- `GET/POST /units`, `GET/PATCH/DELETE /units/:id`
- `GET/POST /tenants`, `GET/PATCH /tenants/:id`, `PATCH /tenants/:id/archive`, `DELETE /tenants/:id`
- `GET/POST /leases`, `GET/PATCH /leases/:id` (no DELETE — terminate via PATCH)
- `GET/POST /payments`, `GET /payments/:id`, `GET /payments/export`
- `GET/POST /maintenance`, `GET/PATCH /maintenance/:id`
- `GET /reports/occupancy`, `/reports/rent-collection`, `/reports/upcoming-lease-expirations`, `/reports/outstanding-balances`

All list endpoints paginate: `?page=1&limit=20` → `{ data, pagination: { page, limit, total, totalPages } }`.

## 6. Error Contract

```json
{ "error": "ERROR_CODE", "message": "Human-readable explanation", "details": {} }
```
Status codes: `400` malformed, `401` auth missing/invalid, `403` insufficient role, `404` not found, `409` conflict (dup/overlap/deletion blocked), `422` business-rule validation failure, `429` rate limited, `500` unhandled.

## 7. Key Design Decisions & Trade-offs

| Decision | Trade-off accepted |
|---|---|
| JWT in `localStorage`, not httpOnly cookie | Simpler for a static-frontend-plus-API split; accepts XSS-token-theft risk in exchange for zero CORS/cookie complexity. Documented as a production hardening item. |
| DB-level `EXCLUDE` constraint for lease overlap, checked again in controller | Redundant, but a controller-only check has a race-condition window under concurrent requests; the DB constraint is the real guarantee, the controller check is for a fast, friendly error message. |
| Archive instead of delete for tenants with history | Preserves financial/audit history; adds one extra tenant state (`is_archived`) to filter on everywhere tenants are listed. |
| No ORM | More boilerplate per query; in exchange, no hidden N+1 queries and no schema drift between ORM models and actual SQL migrations. |
| Vanilla JS frontend, no framework | No component reusability/state-management help; in exchange, zero build tooling, zero dependency upgrades to manage, easy for one developer to maintain for years. |

## 8. Extensibility Notes (multi-building future)

- Add `buildings` table; add `units.building_id` FK.
- Change `units.unit_number` unique constraint to composite `(building_id, unit_number)`.
- Add optional `buildingId` filter to all `/reports/*` endpoints, defaulting to the single existing building for backward compatibility.
- `building_settings` (currently a single implicit row) becomes the `buildings` table itself.

These are the **only three seams** that need to change — everything else (leases, payments, maintenance) hangs off `unit_id`, which is unaffected.
