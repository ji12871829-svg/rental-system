# PRD.md — Product Requirements Document
## Rental Management System (Single Building)

---

## 1. Problem Statement

A single-building property owner/manager currently tracks units, tenants, leases, rent payments, and maintenance requests manually (spreadsheets, notebooks, memory). This causes missed rent follow-ups, lease renewals discovered too late, no single source of truth for who owes what, and no easy way to see building-wide occupancy or collection performance.

## 2. Goals

- Give the property manager **one system of record** for units, tenants, leases, payments, and maintenance.
- Make **rent collection status** (who's paid, who's behind) visible at a glance.
- Make **lease expirations** visible before they become a crisis.
- Track **maintenance requests** from report to resolution.
- Produce simple **owner-facing reports** (occupancy, rent collected) without manual spreadsheet work.

## 3. Non-Goals (v1)

- Multiple buildings/properties (see ARCHITECTURE.md §Extensibility for the seam to add this later).
- Tenant self-service portal or tenant-facing login.
- Online payment processing / payment gateway integration.
- SMS/email notifications (may be added later; v1 is manual-entry only).
- Multi-currency support (USD only).
- Co-tenancy / multiple tenants per lease.

## 4. Users & Roles

| Role | Description | Permissions |
|---|---|---|
| **Admin** | Building owner or senior manager | Full access, incl. user management, hard-deletes where allowed |
| **Manager** | Day-to-day property manager | Create/edit units, tenants, leases, payments, maintenance; cannot delete users or hard-delete tenant/unit records |

Both roles log in with email + password. No tenant-facing accounts in v1.

## 5. Core Features (must-have for v1)

1. **Unit management** — list, add, edit units; track status (vacant/occupied/maintenance).
2. **Tenant management** — list, add, edit tenants; archive instead of delete when a tenant has lease history.
3. **Lease management** — create leases linking a tenant to a unit for a date range and monthly rent; prevent overlapping active leases per unit; terminate/expire leases.
4. **Payment tracking** — record rent payments against a lease; view payment history; see running balance due; export payment history to CSV.
5. **Maintenance requests** — log a request against a unit (optionally tied to a tenant), track status through open → in progress → resolved (or cancelled), assign a vendor, record cost.
6. **Dashboard** — occupancy rate, outstanding balances total, open maintenance count, upcoming lease expirations (next 60 days), quick-action shortcuts.
7. **Reports** — occupancy rate by month, rent collected vs. billed by month, outstanding balances by unit, upcoming lease expirations.

## 6. User Stories

- *As a manager*, I want to record a tenant's rent payment in under 30 seconds so I can process payments quickly during a busy collection day.
- *As a manager*, I want the system to refuse to let me create two overlapping active leases on the same unit, so I don't accidentally double-book a unit.
- *As an admin*, I want to see which leases expire in the next 60 days so I can start renewal conversations early.
- *As a manager*, I want to archive a tenant who moved out rather than delete them, so their payment history stays intact for reporting.
- *As an admin*, I want a one-glance dashboard of occupancy and outstanding balances so I don't have to run a report every morning.
- *As a manager*, I want to log a maintenance request and update its status as it's worked on, so nothing falls through the cracks.

## 7. Success Metrics

- Manager can record a payment in ≤3 clicks/interactions after selecting the lease.
- Zero double-booked units possible (enforced by the system, not manual discipline).
- Dashboard loads all summary figures in a single page load, no manual report generation needed for the common case.
- 100% of the required CRUD flows (units, tenants, leases, payments, maintenance) are usable end-to-end without needing direct database access.

## 8. Assumptions

- Single physical building, single address.
- Units identified by unique `unit_number` within the building.
- Currency: USD. Monetary values to 2 decimal places.
- Rent billed on a monthly cycle.
- One active lease per unit at a time.

## 9. Open Questions — RESOLVED, see HARD-QUESTIONS.md

All three questions originally listed here have been resolved after a dedicated edge-case review pass:
- In-flight maintenance requests when a tenant moves out → HARD-QUESTIONS.md Q1 (no special handling needed, already schema-safe).
- Terminated-lease payments → HARD-QUESTIONS.md Q2 (blocked entirely, `409 LEASE_TERMINATED`).
- Monthly vs. daily rent accrual → HARD-QUESTIONS.md Q3 (monthly, whole cycles, precise formula pinned down).

The review pass also surfaced one gap not originally anticipated: archiving a tenant with an active lease was not blocked in the first draft — see HARD-QUESTIONS.md Q7. This is now a hard rule.
