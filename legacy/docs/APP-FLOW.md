# APP-FLOW.md — UI/UX Design Brief & App Flow
## Rental Management System (Single Building)

---

## 1. Navigation Map

```
[Login] ──(success)──▶ [Dashboard] ◀────────────────┐
                            │                        │
        ┌───────┬──────────┼──────────┬─────────┐   │
        ▼       ▼          ▼          ▼         ▼    │
     [Units] [Tenants]  [Leases]  [Payments] [Maintenance]
        │       │          │          │         │    │
        └───────┴──────────┴──────────┴─────────┴────┘
                            │
                            ▼
                       [Reports]
```

Every authenticated page shares: fixed left sidebar (Dashboard, Units, Tenants, Leases, Payments, Maintenance, Reports, Logout), a top bar (logged-in user + role), and a main content area with page title + primary action button top-right.

## 2. Page-by-Page Flow

### 2.1 Login (`index.html`)
- **Entry point.** Email + password form, client-side required-field check.
- On submit → `POST /api/auth/login`. Success: store `{ token, user }` in `localStorage`, redirect to `dashboard.html`. Failure (401): inline red error banner, no redirect.
- No "forgot password" flow in v1 — admin resets manually via direct DB access if needed (documented in README).

### 2.2 Dashboard (`dashboard.html`)
- **Purpose:** answer "what needs my attention today?" in one glance.
- Layout: 4 summary cards across the top (Occupancy Rate, Outstanding Balance Total, Open Maintenance Count, Units Occupied/Vacant), then a two-column layout below: "Upcoming Lease Expirations" table (left) and "Quick Actions" panel (right: Add Tenant / Record Payment / New Maintenance Request buttons, each opening a modal).
- Data sources: `GET /reports/occupancy`, `/reports/outstanding-balances`, `/reports/upcoming-lease-expirations`, `/maintenance?status=open`.
- Clicking a lease-expiration row deep-links to that lease in Leases page.

### 2.3 Units (`units.html`)
- Table columns: Unit #, Floor, Beds/Baths, Base Rent, Status (colored badge), actions.
- Filter bar: status dropdown (All/Vacant/Occupied/Maintenance).
- "Add Unit" button (top-right) → modal form → `POST /units` → optimistic row insert, rollback + toast on error.
- Row click → edit modal (`PATCH /units/:id`).
- No delete button in UI for units with lease history — show "Mark as Maintenance" instead; a true delete option (admin-only) appears only for units with zero lease history.

### 2.4 Tenants (`tenants.html`)
- Table columns: Name, Email, Phone, Archived (toggle filter to show/hide).
- "Add Tenant" modal → `POST /tenants`.
- Row click → edit modal → `PATCH /tenants/:id`.
- "Archive" action (not "Delete") → confirmation dialog explaining the tenant will be hidden from active lists but retained for history → `PATCH /tenants/:id/archive`.

### 2.5 Leases (`leases.html`)
- Tabbed view: **Active / Expired / Terminated**.
- "Create Lease" wizard (primary action, top-right):
  1. **Pick unit** — dropdown limited to vacant units only (server still re-validates).
  2. **Pick or create tenant** — searchable dropdown + inline "+ New Tenant" shortcut.
  3. **Dates + rent + deposit** — start date, end date, monthly rent (pre-filled from unit's `base_rent`, editable), deposit amount.
  4. **Review & submit** → `POST /leases`. If `409` overlap error returns, show the conflicting lease's dates clearly and let the user adjust dates without losing their other inputs.
- Each active lease row has a "Terminate" action → confirmation → `PATCH status=terminated`.

### 2.6 Payments (`payments.html`)
- Top: "Record Payment" form — searchable lease dropdown (shows unit + tenant name), amount, date, method, reference number, notes → `POST /payments`.
- Below: payment history table, filterable by date range (`dateFrom`/`dateTo`) and by lease.
- "Export CSV" button → `GET /payments/export` with current filters applied, triggers a file download.

### 2.7 Maintenance (`maintenance.html`)
- "New Request" form: unit (dropdown), tenant (optional, auto-suggested from unit's active lease), description, priority → `POST /maintenance`.
- Filterable table/board by status (Open / In Progress / Resolved / Cancelled) and priority.
- Inline status-change dropdown per row — client validates the transition is legal (see ARCHITECTURE-ESSENTIALS.md rule 7) before calling `PATCH /maintenance/:id`, so the user gets instant feedback instead of waiting for a server rejection.

### 2.8 Reports (`reports.html`)
- Month/year picker at top.
- Two report blocks: **Occupancy** (rate + occupied/vacant counts) and **Rent Collection** (billed vs. collected vs. outstanding, broken down by unit in a table).
- Simple bar/line visuals via `<canvas>` — no charting library dependency required.

## 3. Interaction Conventions (apply everywhere)

- **Optimistic updates:** on create/edit, update the UI immediately, then reconcile with the server response; on error, roll back and show a toast with the server's `message`.
- **Modals** for all create/edit forms — never a full page navigation for a simple form.
- **Confirmation dialogs** required before: archiving a tenant, terminating a lease, deleting a unit (admin-only, rare case), cancelling a maintenance request.
- **Loading states:** every button that triggers a network call shows a disabled/spinner state until the response returns.
- **Empty states:** every list page has a friendly empty-state message + primary action when there's no data yet (e.g., Units page with zero units shows "No units yet — Add your first unit").
