# ARCHITECTURE-ESSENTIALS.md
### Condensed reference — paste this into AI agent context instead of the full ARCHITECTURE.md when context budget is tight.

---

**Stack:** Node.js + Express · PostgreSQL (raw parameterized SQL, no ORM) · plain HTML/CSS/vanilla JS frontend · JWT auth · bcrypt.

**One building. One active lease per unit. USD. Monthly rent.**

## Tables (7)
- `users` (auth) — `role` in `('admin','manager')`
- `building_settings` (single row)
- `units` — `unit_number` UNIQUE, `status` in `('vacant','occupied','maintenance')`
- `tenants` — `email` UNIQUE, `is_archived` bool (never hard-delete if lease history exists)
- `leases` — `unit_id`+`tenant_id` FKs, `status` in `('active','expired','terminated')`, **DB-enforced no-overlap** via `EXCLUDE USING gist` on `(unit_id, daterange(start_date,end_date))` where active
- `payments` — `lease_id` FK, `amount > 0`, never hard-deleted
- `maintenance_requests` — `unit_id` FK, `tenant_id` FK nullable, `status` in `('open','in_progress','resolved','cancelled')`, valid transitions only: `open→in_progress→resolved`, or `(open|in_progress)→cancelled`

## Non-negotiable business rules
1. No overlapping **active** leases per unit — check in controller AND rely on DB constraint.
2. `leases.end_date > start_date`.
3. Payments can be partial/over — don't reject, just reflect in `balanceDue`. **Exception:** a lease with `status='terminated'` rejects all new payments (`409 LEASE_TERMINATED`) — `active`/`expired` leases accept payments regardless of payment date. `balanceDue = (cyclesElapsed × monthlyRent) − SUM(payments.amount)`, where `cyclesElapsed` = whole calendar months from `start_date` through `LEAST(CURRENT_DATE, end_date)` inclusive — implement as a named utility, never inline (see HARD-QUESTIONS.md Q2/Q3).
4. Tenant with an active lease: **cannot** hard-delete → `PATCH /tenants/:id/archive` only. **Archiving is also blocked** if the tenant has any `status='active'` lease (`409 ARCHIVE_BLOCKED_ACTIVE_LEASE`) — archiving means "done with us," which an active lease contradicts (see HARD-QUESTIONS.md Q7).
5. Unit with any lease history: **cannot** hard-delete → set `status='maintenance'` instead.
6. Lease created → unit `status='occupied'` (same transaction). Lease terminated/expired → unit `status='vacant'` (unless another active lease exists — the overlap constraint already guarantees that can't happen).
7. Maintenance `resolved` → stamp `resolved_at = NOW()`. Reject invalid status transitions with `422`.
8. **No automatic date-based lease expiry in v1** — all status transitions are manual via `PATCH`, triggered by the human reading the Dashboard's upcoming-expirations list. Do not build a cron/scheduled job for this unless explicitly asked (see HARD-QUESTIONS.md Q6).

## API base
`/api`, JWT via `Authorization: Bearer <token>`, list endpoints paginate `?page&limit` (default 20, max 100).

Resources: `auth`, `units`, `tenants`, `leases`, `payments`, `maintenance`, `reports`. Full endpoint table lives in ARCHITECTURE.md §5 and the Postman collection — don't re-derive it, reference it.

## Error shape (always)
```json
{ "error": "CODE", "message": "...", "details": {} }
```
`400/401/403/404/409/422/429/500` — see ARCHITECTURE.md §6 for exact meaning per code.

## Folder structure
```
server/src/{config,middleware,routes,controllers,models,utils}
client/{public,css,js}
migrations/  tests/{unit,integration,e2e}
```
One file per resource in `routes/`, `controllers/`, `models/`. SQL lives only in `models/`.

## Money & dates
`NUMERIC(10,2)` for all money (never float). `DATE` for calendar dates (lease dates, payment date). `TIMESTAMPTZ` for audit timestamps.
