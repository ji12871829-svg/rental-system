# BACKEND-SCHEMA.md
## Quick DB reference — canonical SQL lives in `migrations/001_init_schema.sql` and is mirrored in `ARCHITECTURE.md §4`.

## ER Diagram (textual)

```
users            (standalone)
building_settings (standalone, single row)

┌─────────┐      1        *  ┌─────────┐  *        1  ┌─────────┐
│  units  │ ─────────────────│ leases  │───────────────│ tenants │
└─────────┘                  └─────────┘               └─────────┘
     │ 1                          │ 1
     │                            │
     * │                          * │
┌──────────────┐            ┌──────────┐
│ maintenance_ │            │ payments │
│  requests    │            └──────────┘
└──────────────┘
     │ 0..1
     * │
┌─────────┐
│ tenants │  (nullable FK — maintenance can exist without a tenant on file)
└─────────┘
```

## Table Cheat Sheet

| Table | PK | FKs | Unique | Notable constraints |
|---|---|---|---|---|
| `users` | id | — | email | role ∈ {admin, manager} |
| `building_settings` | id | — | — | single row, no FK |
| `units` | id | — | unit_number | status ∈ {vacant, occupied, maintenance}; base_rent ≥ 0 |
| `tenants` | id | — | email | is_archived flag instead of delete |
| `leases` | id | unit_id → units, tenant_id → tenants | — | end_date > start_date; **EXCLUDE constraint** prevents overlapping active leases per unit |
| `payments` | id | lease_id → leases | — | amount > 0; never deleted |
| `maintenance_requests` | id | unit_id → units, tenant_id → tenants (nullable) | — | status ∈ {open, in_progress, resolved, cancelled}; priority ∈ {low, medium, high, urgent} |

## Indexes

- `units(status)`
- `tenants(is_archived)`
- `leases(unit_id)`, `leases(tenant_id)`, `leases(status)`, `leases(end_date)`
- `payments(lease_id)`, `payments(payment_date)`
- `maintenance_requests(unit_id)`, `maintenance_requests(status)`

## Delete Semantics (important — do not deviate)

- `ON DELETE RESTRICT` on `leases.unit_id`, `leases.tenant_id`, `payments.lease_id`, `maintenance_requests.unit_id` — these are historical/financial records; the DB physically refuses to let you delete a parent row with children.
- `ON DELETE SET NULL` on `maintenance_requests.tenant_id` only — a maintenance request can outlive the tenant record being archived without losing the request itself.

## Seed Data Baseline (for local dev)

3 units, 2 tenants, 2 active leases, 3 payments, 2 maintenance requests, 1 admin user. Exact `INSERT` statements in `migrations/002_seed_data.sql`.
