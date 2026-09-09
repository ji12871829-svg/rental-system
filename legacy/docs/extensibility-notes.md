# Extensibility Notes — multi-building future

v1 manages **one building** deliberately. The seams below are the exact,
deliberate places where multi-building support would attach. Do **not** build
any of this now; this file exists so a future developer (human or AI) knows
precisely what to change and where.

## The three changes (per the build prompt §16)

### 1. Introduce a real `buildings` table and `units.building_id`

Today `building_settings` is an implicit single-row table acting as "the
building". The widening seam:

- Create `buildings` (`id`, name, address, city, country, currency — split
  out of `building_settings`).
- Add `units.building_id INTEGER NOT NULL REFERENCES buildings(id)`.
- Keep `building_settings` or fold it into the single `buildings` row; either
  way, seed one building and backfill `units.building_id = 1`.

**Files touched:** `migrations/003_*.sql`, `server/src/models/units.js` (every
query gains a `building_id` predicate), `server/src/models/reports.js`.

### 2. Make `unit_number` unique per building (composite constraint)

Current: `units.unit_number VARCHAR(20) NOT NULL UNIQUE` (whole table = one
building). Future:

```sql
ALTER TABLE units DROP CONSTRAINT units_unit_number_key;
ALTER TABLE units ADD CONSTRAINT uq_units_building_unit UNIQUE (building_id, unit_number);
```

The controller's `409 DUPLICATE_UNIT_NUMBER` mapping already works unchanged
(the unique violation error code is the same). The `leases` overlap EXCLUDE
constraint (unit-scoped) also needs no change — units are already unique
records per building once (1) lands.

### 3. Add an optional `buildingId` filter to every report

All four report endpoints (`/api/reports/occupancy`, `rent-collection`,
`upcoming-lease-expirations`, `outstanding-balances`) would accept
`?buildingId=N`, defaulting to the single building's ID so existing clients
keep working (backward compatible).

**Files touched:** `server/src/controllers/reports.js` (parse + default),
`server/src/models/reports.js` (predicates).

## Other seams to be aware of

- **`users` are global** (not per-building) — fine for v1; multi-building
  would probably want role-per-building or a join table later.
- **Payments are keyed to leases**, which are keyed to units — money math
  automatically becomes per-building once units have `building_id`;
  `outstanding-balances` just needs the filter from (3).
- **`building_settings.currency` is stored but unused** — multi-currency is
  out of scope; the column is the seam if it ever becomes real.
- **Report month math** (`total_billed` = active leases covering the month)
  and the cycle formula in `server/src/utils/calculateCyclesElapsed.js` are
  per-lease, so they are agnostic to buildings already.

## Rules that must NOT change when multi-building lands

- Lease overlap exclusion stays per-`unit_id` (a unit belongs to exactly one
  building; overlap is a unit-level property).
- `unit_number` uniqueness becomes composite `(building_id, unit_number)` —
  never globally unique again.
- All money stays `NUMERIC(10,2)` USD until multi-currency is explicitly
  scoped.