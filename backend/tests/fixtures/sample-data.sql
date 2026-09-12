-- ============================================================================
-- TEST-ONLY FIXTURE: historical sample dataset, frozen from before the M-Pesa seed-cleanup commit ("feat: automate M-Pesa rent payments", 2026-09-11).
-- ----------------------------------------------------------------------------
-- The integration tests (backend/tests/integration/api.test.ts) were written
-- against this dataset: tenants (Peter Otieno, Grace Njeri, ...), rent
-- payments, water readings (unit 13/15), arrears, and water purchases.
-- The M-Pesa seed-cleanup commit emptied database/seed.sql into a clean go-live seed (no
-- sample tenants), which broke the suite everywhere. This copy lives HERE so
-- tests own their data and the production seed stays clean. Do not edit
-- without updating the tests that depend on it.
-- ============================================================================

-- ============================================================================
-- Rental Property Management System — seed data (idempotent / guarded).
-- ----------------------------------------------------------------------------
-- Everything here is safe to re-run. The admin user is NOT created in this
-- file: `npm run db:setup` executes this SQL, then inserts users with bcrypt
-- hashes generated at runtime (no secrets in the repo).
--
-- Sample data covers the spec's acceptance scenarios:
--   * Unit 15 water test: prev 120 → current 128 (8 units @ 200 = KSh 1,600),
--     paid in two instalments (1,000 + 600) → PAID.
--   * Unit 12 water: readings + full payments each month.
--   * Unit 15 March water bill KSh 1,200, paid KSh 500 → PARTIAL.
--   * Rent arrears for several tenants later in the year.
--   * Water purchases: 100 units @ 50 = KSh 5,000 etc.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- settings (singleton, id = 1)
-- ---------------------------------------------------------------------------
INSERT INTO settings (id, reporting_year, currency, water_rate)
SELECT 1, 2026, 'KSh', 200
WHERE NOT EXISTS (SELECT 1 FROM settings);

-- ---------------------------------------------------------------------------
-- property + floors
-- ---------------------------------------------------------------------------
INSERT INTO properties (name, address, reporting_year, currency)
SELECT 'Olbano Apartments', '123 Riverside Drive, Nairobi', 2026, 'KSh'
WHERE NOT EXISTS (SELECT 1 FROM properties);

INSERT INTO floors (property_id, floor_number, name)
SELECT p.id, f.floor_number, f.name
FROM properties p,
     (VALUES (1, 'First Floor'), (2, 'Second Floor'),
             (3, 'Third Floor'), (4, 'Fourth Floor')) AS f(floor_number, name)
WHERE NOT EXISTS (SELECT 1 FROM floors);

-- ---------------------------------------------------------------------------
-- The 24 units — rents exactly as specified, water enabled ONLY for 12–23.
-- ---------------------------------------------------------------------------
INSERT INTO units (property_id, floor_id, unit_number, unit_type, monthly_rent, water_enabled, occupancy_status)
SELECT p.id, fl.id, u.unit_number, u.unit_type, u.monthly_rent,
       u.unit_number::int BETWEEN 12 AND 23 AS water_enabled,
       CASE WHEN u.unit_number::int IN (1, 2, 12, 15, 24) THEN 'OCCUPIED' ELSE 'VACANT' END
FROM properties p
JOIN floors fl ON fl.property_id = p.id
JOIN (VALUES
  -- First Floor
  ('1',  1, 'Room',      4000),
  ('2',  1, 'Room',      2500),
  ('3',  1, 'Room',      3000),
  ('4',  1, 'Room',      3000),
  ('5',  1, 'Room',      3000),
  ('6',  1, 'Room',      4000),
  -- Second Floor
  ('7',  2, 'Room',      4000),
  ('8',  2, 'Room',      2500),
  ('9',  2, 'Room',      3000),
  ('10', 2, 'Room',      3000),
  ('11', 2, 'Room',      3000),
  ('12', 2, 'Room',      4000),   -- rent editable (4000 or 3500) via Units page
  ('13', 2, 'Room',      2500),
  -- Third Floor
  ('14', 3, 'Bedsitter', 5500),   -- BS14
  ('15', 3, '1 Bedroom', 9000),
  ('16', 3, 'Bedsitter', 5000),
  ('17', 3, 'Bedsitter', 5000),
  ('18', 3, 'Bedsitter', 5000),
  -- Fourth Floor
  ('19', 4, 'Bedsitter', 5500),   -- BS19
  ('20', 4, '1 Bedroom', 9000),
  ('21', 4, 'Bedsitter', 5000),
  ('22', 4, 'Bedsitter', 5000),
  ('23', 4, 'Bedsitter', 5000),
  ('24', 4, '2 Bedroom', 11000)
) AS u(unit_number, floor_number, unit_type, monthly_rent)
  ON u.floor_number = fl.floor_number
ON CONFLICT (property_id, unit_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Sample tenants
-- ---------------------------------------------------------------------------
INSERT INTO tenants (unit_id, full_name, phone_number, email, move_in_date, security_deposit, status, notes)
SELECT u.id, 'Peter Otieno',  '+254711000001', 'peter.otieno@example.com',  DATE '2025-11-01', 4000, 'ACTIVE', 'Pays rent via M-Pesa'
FROM units u JOIN properties p ON u.property_id = p.id
WHERE u.unit_number = '1' AND NOT EXISTS (SELECT 1 FROM tenants WHERE full_name = 'Peter Otieno');

INSERT INTO tenants (unit_id, full_name, phone_number, email, move_in_date, security_deposit, status, notes)
SELECT u.id, 'Jane Wanjiru',  '+254711000002', 'jane.wanjiru@example.com',  DATE '2025-12-01', 2500, 'ACTIVE', NULL
FROM units u JOIN properties p ON u.property_id = p.id
WHERE u.unit_number = '2' AND NOT EXISTS (SELECT 1 FROM tenants WHERE full_name = 'Jane Wanjiru');

INSERT INTO tenants (unit_id, full_name, phone_number, email, move_in_date, security_deposit, status, notes)
SELECT u.id, 'John Mwangi',   '+254711000003', 'john.mwangi@example.com',   DATE '2025-10-01', 4000, 'ACTIVE', 'Unit 12 – water metered'
FROM units u JOIN properties p ON u.property_id = p.id
WHERE u.unit_number = '12' AND NOT EXISTS (SELECT 1 FROM tenants WHERE full_name = 'John Mwangi');

INSERT INTO tenants (unit_id, full_name, phone_number, email, move_in_date, security_deposit, status, notes)
SELECT u.id, 'Grace Njeri',   '+254711000004', 'grace.njeri@example.com',   DATE '2025-09-01', 9000, 'ACTIVE', 'Unit 15 – 1 bedroom, water metered'
FROM units u JOIN properties p ON u.property_id = p.id
WHERE u.unit_number = '15' AND NOT EXISTS (SELECT 1 FROM tenants WHERE full_name = 'Grace Njeri');

INSERT INTO tenants (unit_id, full_name, phone_number, email, move_in_date, security_deposit, status, notes)
SELECT u.id, 'Amina Hassan',  '+254711000005', 'amina.hassan@example.com',  DATE '2026-01-01', 11000, 'ACTIVE', 'Unit 24 – 2 bedroom, no water billing'
FROM units u JOIN properties p ON u.property_id = p.id
WHERE u.unit_number = '24' AND NOT EXISTS (SELECT 1 FROM tenants WHERE full_name = 'Amina Hassan');

-- ---------------------------------------------------------------------------
-- Rent payments 2026 (payment_reference doubles as the seed guard).
-- ---------------------------------------------------------------------------
INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-001', t.id, t.unit_id, DATE '2026-01-03', 1, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Peter Otieno'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-001');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-002', t.id, t.unit_id, DATE '2026-02-02', 2, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Peter Otieno'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-002');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-003', t.id, t.unit_id, DATE '2026-03-02', 3, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Peter Otieno'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-003');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-004', t.id, t.unit_id, DATE '2026-04-01', 4, 2026, 4000, 'CASH', NULL
FROM tenants t WHERE t.full_name = 'Peter Otieno'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-004');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-005', t.id, t.unit_id, DATE '2026-01-05', 1, 2026, 2500, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Jane Wanjiru'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-005');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-006', t.id, t.unit_id, DATE '2026-02-05', 2, 2026, 2500, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Jane Wanjiru'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-006');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-007', t.id, t.unit_id, DATE '2026-03-05', 3, 2026, 2500, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Jane Wanjiru'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-007');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-008', t.id, t.unit_id, DATE '2026-04-04', 4, 2026, 2500, 'CASH', NULL
FROM tenants t WHERE t.full_name = 'Jane Wanjiru'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-008');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-009', t.id, t.unit_id, DATE '2026-05-02', 5, 2026, 2500, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Jane Wanjiru'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-009');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-010', t.id, t.unit_id, DATE '2026-06-02', 6, 2026, 2500, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Jane Wanjiru'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-010');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-011', t.id, t.unit_id, DATE '2026-07-02', 7, 2026, 2500, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Jane Wanjiru'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-011');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-012', t.id, t.unit_id, DATE '2026-01-10', 1, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'John Mwangi'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-012');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-013', t.id, t.unit_id, DATE '2026-02-10', 2, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'John Mwangi'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-013');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-014', t.id, t.unit_id, DATE '2026-03-10', 3, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'John Mwangi'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-014');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-015', t.id, t.unit_id, DATE '2026-04-10', 4, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'John Mwangi'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-015');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-016', t.id, t.unit_id, DATE '2026-05-11', 5, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'John Mwangi'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-016');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-017', t.id, t.unit_id, DATE '2026-06-10', 6, 2026, 4000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'John Mwangi'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-017');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-018', t.id, t.unit_id, DATE '2026-01-12', 1, 2026, 9000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-018');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-019', t.id, t.unit_id, DATE '2026-02-12', 2, 2026, 9000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-019');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-020', t.id, t.unit_id, DATE '2026-03-12', 3, 2026, 9000, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-020');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-021', t.id, t.unit_id, DATE '2026-04-13', 4, 2026, 9000, 'CASH', NULL
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-021');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-022', t.id, t.unit_id, DATE '2026-05-14', 5, 2026, 5000, 'M_PESA', 'Partial payment – balance due'
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-022');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-023', t.id, t.unit_id, DATE '2026-01-02', 1, 2026, 11000, 'BANK', NULL
FROM tenants t WHERE t.full_name = 'Amina Hassan'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-023');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-024', t.id, t.unit_id, DATE '2026-02-02', 2, 2026, 11000, 'BANK', NULL
FROM tenants t WHERE t.full_name = 'Amina Hassan'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-024');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-025', t.id, t.unit_id, DATE '2026-03-02', 3, 2026, 11000, 'BANK', NULL
FROM tenants t WHERE t.full_name = 'Amina Hassan'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-025');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-026', t.id, t.unit_id, DATE '2026-04-02', 4, 2026, 11000, 'BANK', NULL
FROM tenants t WHERE t.full_name = 'Amina Hassan'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-026');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-027', t.id, t.unit_id, DATE '2026-05-02', 5, 2026, 11000, 'BANK', NULL
FROM tenants t WHERE t.full_name = 'Amina Hassan'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-027');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-028', t.id, t.unit_id, DATE '2026-06-02', 6, 2026, 11000, 'BANK', NULL
FROM tenants t WHERE t.full_name = 'Amina Hassan'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-028');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-029', t.id, t.unit_id, DATE '2026-07-02', 7, 2026, 11000, 'BANK', NULL
FROM tenants t WHERE t.full_name = 'Amina Hassan'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-029');

INSERT INTO rent_payments (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT 'SEED-RP-030', t.id, t.unit_id, DATE '2026-08-03', 8, 2026, 11000, 'BANK', NULL
FROM tenants t WHERE t.full_name = 'Amina Hassan'
  AND NOT EXISTS (SELECT 1 FROM rent_payments WHERE payment_reference = 'SEED-RP-030');

-- ---------------------------------------------------------------------------
-- Water meter readings 2026 — the spec's exact test data for Unit 15.
-- ---------------------------------------------------------------------------
INSERT INTO water_meter_readings (unit_id, tenant_id, reading_date, billing_month, billing_year, previous_reading, current_reading, consumption, water_rate, water_bill)
SELECT u.id, t.id, DATE '2026-01-15', 1, 2026, 112, 120, 8, 200, 1600
FROM units u JOIN tenants t ON t.unit_id = u.id AND t.full_name = 'John Mwangi'
WHERE u.unit_number = '12'
ON CONFLICT (unit_id, billing_month, billing_year) DO NOTHING;

INSERT INTO water_meter_readings (unit_id, tenant_id, reading_date, billing_month, billing_year, previous_reading, current_reading, consumption, water_rate, water_bill)
SELECT u.id, t.id, DATE '2026-02-15', 2, 2026, 120, 127, 7, 200, 1400
FROM units u JOIN tenants t ON t.unit_id = u.id AND t.full_name = 'John Mwangi'
WHERE u.unit_number = '12'
ON CONFLICT (unit_id, billing_month, billing_year) DO NOTHING;

INSERT INTO water_meter_readings (unit_id, tenant_id, reading_date, billing_month, billing_year, previous_reading, current_reading, consumption, water_rate, water_bill)
SELECT u.id, t.id, DATE '2026-01-18', 1, 2026, 112, 120, 8, 200, 1600
FROM units u JOIN tenants t ON t.unit_id = u.id AND t.full_name = 'Grace Njeri'
WHERE u.unit_number = '15'
ON CONFLICT (unit_id, billing_month, billing_year) DO NOTHING;

INSERT INTO water_meter_readings (unit_id, tenant_id, reading_date, billing_month, billing_year, previous_reading, current_reading, consumption, water_rate, water_bill)
SELECT u.id, t.id, DATE '2026-02-18', 2, 2026, 120, 128, 8, 200, 1600
FROM units u JOIN tenants t ON t.unit_id = u.id AND t.full_name = 'Grace Njeri'
WHERE u.unit_number = '15'
ON CONFLICT (unit_id, billing_month, billing_year) DO NOTHING;

INSERT INTO water_meter_readings (unit_id, tenant_id, reading_date, billing_month, billing_year, previous_reading, current_reading, consumption, water_rate, water_bill)
SELECT u.id, t.id, DATE '2026-03-20', 3, 2026, 128, 134, 6, 200, 1200
FROM units u JOIN tenants t ON t.unit_id = u.id AND t.full_name = 'Grace Njeri'
WHERE u.unit_number = '15'
ON CONFLICT (unit_id, billing_month, billing_year) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Water payments 2026
-- ---------------------------------------------------------------------------
INSERT INTO water_payments (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT t.id, t.unit_id, DATE '2026-01-20', 1, 2026, 1600, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'John Mwangi'
  AND NOT EXISTS (SELECT 1 FROM water_payments wp WHERE wp.tenant_id = t.id AND wp.billing_month = 1 AND wp.billing_year = 2026);

INSERT INTO water_payments (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT t.id, t.unit_id, DATE '2026-02-20', 2, 2026, 1400, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'John Mwangi'
  AND NOT EXISTS (SELECT 1 FROM water_payments wp WHERE wp.tenant_id = t.id AND wp.billing_month = 2 AND wp.billing_year = 2026);

INSERT INTO water_payments (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT t.id, t.unit_id, DATE '2026-01-22', 1, 2026, 1600, 'M_PESA', NULL
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM water_payments wp WHERE wp.tenant_id = t.id AND wp.billing_month = 1 AND wp.billing_year = 2026);

INSERT INTO water_payments (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT t.id, t.unit_id, DATE '2026-02-20', 2, 2026, 1000, 'M_PESA', 'First instalment'
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM water_payments wp WHERE wp.tenant_id = t.id AND wp.billing_month = 2 AND wp.billing_year = 2026 AND wp.amount = 1000);

INSERT INTO water_payments (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT t.id, t.unit_id, DATE '2026-02-25', 2, 2026, 600, 'CASH', 'Second instalment – completes KSh 1,600 bill'
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM water_payments wp WHERE wp.tenant_id = t.id AND wp.billing_month = 2 AND wp.billing_year = 2026 AND wp.amount = 600);

INSERT INTO water_payments (tenant_id, unit_id, payment_date, billing_month, billing_year, amount, payment_method, notes)
SELECT t.id, t.unit_id, DATE '2026-03-24', 3, 2026, 500, 'M_PESA', 'Partial – KSh 700 still outstanding'
FROM tenants t WHERE t.full_name = 'Grace Njeri'
  AND NOT EXISTS (SELECT 1 FROM water_payments wp WHERE wp.tenant_id = t.id AND wp.billing_month = 3 AND wp.billing_year = 2026);

-- ---------------------------------------------------------------------------
-- Water purchases — what the landlord spends buying water.
-- ---------------------------------------------------------------------------
INSERT INTO water_purchases (purchase_date, supplier, quantity, measurement_unit, cost_per_unit, total_cost, payment_method, reference_number, notes)
SELECT DATE '2026-01-05', 'Nairobi Water Co.', 100, 'units', 50, 5000, 'BANK', 'WTR-2026-001', NULL
WHERE NOT EXISTS (SELECT 1 FROM water_purchases WHERE reference_number = 'WTR-2026-001');

INSERT INTO water_purchases (purchase_date, supplier, quantity, measurement_unit, cost_per_unit, total_cost, payment_method, reference_number, notes)
SELECT DATE '2026-02-05', 'Nairobi Water Co.', 80, 'units', 50, 4000, 'BANK', 'WTR-2026-002', NULL
WHERE NOT EXISTS (SELECT 1 FROM water_purchases WHERE reference_number = 'WTR-2026-002');

INSERT INTO water_purchases (purchase_date, supplier, quantity, measurement_unit, cost_per_unit, total_cost, payment_method, reference_number, notes)
SELECT DATE '2026-03-06', 'Nairobi Water Co.', 60, 'units', 55, 3300, 'CASH', 'WTR-2026-003', NULL
WHERE NOT EXISTS (SELECT 1 FROM water_purchases WHERE reference_number = 'WTR-2026-003');

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
INSERT INTO expenses (expense_date, description, category, amount, payment_method, reference_number, notes)
SELECT DATE '2026-01-08', 'Electricity bill – January', 'ELECTRICITY', 1200, 'BANK', 'EXP-2026-001', NULL
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE reference_number = 'EXP-2026-001');

INSERT INTO expenses (expense_date, description, category, amount, payment_method, reference_number, notes)
SELECT DATE '2026-02-08', 'Electricity bill – February', 'ELECTRICITY', 1100, 'BANK', 'EXP-2026-002', NULL
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE reference_number = 'EXP-2026-002');

INSERT INTO expenses (expense_date, description, category, amount, payment_method, reference_number, notes)
SELECT DATE '2026-03-09', 'Electricity bill – March', 'ELECTRICITY', 1250, 'BANK', 'EXP-2026-003', NULL
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE reference_number = 'EXP-2026-003');

INSERT INTO expenses (expense_date, description, category, amount, payment_method, reference_number, notes)
SELECT DATE '2026-01-15', 'Common area cleaning', 'CLEANING', 500, 'CASH', 'EXP-2026-004', NULL
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE reference_number = 'EXP-2026-004');

INSERT INTO expenses (expense_date, description, category, amount, payment_method, reference_number, notes)
SELECT DATE '2026-02-15', 'Common area cleaning', 'CLEANING', 500, 'CASH', 'EXP-2026-005', NULL
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE reference_number = 'EXP-2026-005');

INSERT INTO expenses (expense_date, description, category, amount, payment_method, reference_number, notes)
SELECT DATE '2026-03-15', 'Common area cleaning', 'CLEANING', 500, 'CASH', 'EXP-2026-006', NULL
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE reference_number = 'EXP-2026-006');

INSERT INTO expenses (expense_date, description, category, amount, payment_method, reference_number, notes)
SELECT DATE '2026-02-20', 'Fix leaking roof gutter', 'REPAIRS', 2000, 'CASH', 'EXP-2026-007', NULL
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE reference_number = 'EXP-2026-007');

INSERT INTO expenses (expense_date, description, category, amount, payment_method, reference_number, notes)
SELECT DATE '2026-03-25', 'Water pump maintenance', 'WATER', 800, 'CASH', 'EXP-2026-008', NULL
WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE reference_number = 'EXP-2026-008');