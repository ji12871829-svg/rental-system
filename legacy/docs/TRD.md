# TRD.md — Technical Requirements Document
## Rental Management System (Single Building)

---

## 1. Stack Decisions (locked — do not substitute)

| Layer | Choice | Rationale |
|---|---|---|
| Backend runtime | Node.js + Express | Simple, widely understood, no heavy framework overhead for this scope |
| Database | PostgreSQL | Strong constraint support (`CHECK`, `EXCLUDE USING gist` for lease-overlap prevention), reliable for financial data |
| Query layer | Raw parameterized SQL (via `pg`) or `knex` as a thin query builder | Avoids ORM magic hiding constraint violations; raw SQL migrations are the source of truth regardless |
| Frontend | Plain HTML + CSS + vanilla JS (ES6+, `fetch`) | No build step, no framework version drift, easy for a single developer to maintain long-term |
| Auth | JWT, 8-hour expiry, `Authorization: Bearer` header | Stateless, simple; httpOnly-cookie upgrade path noted for production hardening |
| Password hashing | bcrypt, cost factor 12 | Industry standard, resistant to brute force at reasonable cost |
| Validation | `zod` or `joi` schema validation at the API boundary | Catch bad input before it reaches SQL; pairs with parameterized queries for defense in depth |
| Rate limiting | `express-rate-limit` | Blunts brute-force login attempts and API abuse |
| Testing | Jest (unit + integration via Supertest), Playwright or Cypress (E2E) | Standard Node testing stack, no exotic tooling |

## 2. Non-Functional Requirements

- **Security:** parameterized queries only (no string-interpolated SQL); secrets via environment variables only; CORS restricted to the known frontend origin in production; HTTPS enforced in production (via hosting platform TLS).
- **Data integrity:** critical business rules (lease overlap, no negative payments, valid status transitions) enforced at **both** the API layer and the database layer — the database is the last line of defense, not the only one.
- **Performance:** list endpoints must paginate (default 20/page, max 100/page); dashboard should resolve in a single page load without N+1 query patterns (use joins, not per-row queries in a loop).
- **Availability:** no specific SLA for v1 (single-building internal tool); nightly DB backups via hosting provider are sufficient.
- **Maintainability:** one file per resource in `routes/`, `controllers/`, `models/` — no god-files; SQL lives in `models/`, never inline in `routes/`.
- **Auditability:** every table has `created_at`; mutable tables have `updated_at`; payments and maintenance requests are never hard-deleted (financial/history records).

## 3. Environments

- **Local development:** Node + local Postgres (via Docker or native install), `.env` file (gitignored).
- **Production:** Node hosted on Render/Railway, managed Postgres add-on, static frontend hosted separately (Render Static Site/Netlify/Vercel) pointed at the backend via a small runtime `config.js` (not baked into HTML at build time, since there is no build step).

## 4. Dependencies (expected `package.json` — backend)

```
express
pg (or knex + pg)
bcrypt
jsonwebtoken
zod (or joi)
express-rate-limit
cors
dotenv
jest, supertest (devDependencies)
nodemon (devDependency)
```

No frontend dependencies beyond what the browser provides natively (no npm install needed for `client/` since there's no build step — files are served as static assets).

## 5. Out-of-Scope Technical Choices

- No TypeScript in v1 (adds build-step complexity disproportionate to project size) — flagged as a possible v2 upgrade once the schema stabilizes.
- No GraphQL — REST is sufficient for this resource shape.
- No microservices — single Express monolith is correct at this scale.
- No server-side rendering / templating engine — frontend is static HTML + fetch calls to a JSON API.

## 6. Constraints Carried Into ARCHITECTURE.md

- Database schema must live in versioned SQL migration files (not ORM auto-migrations) — see `migrations/001_init_schema.sql`.
- All monetary columns are `NUMERIC(10,2)`, never `FLOAT`/`REAL` (avoid floating-point rounding errors on money).
- All timestamps are `TIMESTAMPTZ`, all pure calendar dates (lease start/end, payment date) are `DATE` (no time-of-day ambiguity for billing dates).
