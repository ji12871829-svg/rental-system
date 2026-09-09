-- 002_seed_data.sql — local dev baseline (idempotent: every INSERT is guarded).
--
-- The admin user's bcrypt hash CANNOT live in this file (no secrets in the
-- repo). server/src/config/runSeed.js executes this file, then inserts the
-- admin row with a REAL hash generated at seed time via a parameterized query.

INSERT INTO building_settings (building_name, address_line1, city, country, currency)
SELECT 'Olbano Apartments', '123 Riverside Drive', 'Nairobi', 'Kenya', 'USD'
WHERE NOT EXISTS (SELECT 1 FROM building_settings);

INSERT INTO units (unit_number, floor, bedrooms, bathrooms, square_feet, base_rent, status) VALUES
  ('1',  'Ground', 1, 1, 450, 350.00, 'occupied'),
  ('2',  'Ground', 2, 1, 620, 500.00, 'occupied'),
  ('3',  '1st',    1, 1, 450, 350.00, 'vacant')
ON CONFLICT (unit_number) DO NOTHING;

INSERT INTO tenants (first_name, last_name, email, phone, national_id) VALUES
  ('Jane', 'Wanjiru', 'jane.wanjiru@example.com', '+254700111222', '30112233'),
  ('Peter', 'Otieno',  'peter.otieno@example.com', '+254700333444', '29988776')
ON CONFLICT (email) DO NOTHING;

INSERT INTO leases (unit_id, tenant_id, start_date, end_date, monthly_rent, deposit_amount, status)
SELECT 1, 1, DATE '2026-01-01', DATE '2026-12-31', 350.00, 350.00, 'active'
WHERE NOT EXISTS (SELECT 1 FROM leases WHERE unit_id = 1 AND tenant_id = 1);

INSERT INTO leases (unit_id, tenant_id, start_date, end_date, monthly_rent, deposit_amount, status)
SELECT 2, 2, DATE '2026-02-01', DATE '2027-01-31', 500.00, 500.00, 'active'
WHERE NOT EXISTS (SELECT 1 FROM leases WHERE unit_id = 2 AND tenant_id = 2);

INSERT INTO payments (lease_id, amount, payment_date, payment_method, reference_number)
SELECT 1, 350.00, DATE '2026-01-03', 'mpesa', 'MPESA-AX92JD'
WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number = 'MPESA-AX92JD');

INSERT INTO payments (lease_id, amount, payment_date, payment_method, reference_number)
SELECT 1, 350.00, DATE '2026-02-02', 'mpesa', 'MPESA-BQ12KZ'
WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number = 'MPESA-BQ12KZ');

INSERT INTO payments (lease_id, amount, payment_date, payment_method, reference_number)
SELECT 2, 500.00, DATE '2026-02-03', 'bank_transfer', 'BNK-000217'
WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number = 'BNK-000217');

INSERT INTO maintenance_requests (unit_id, tenant_id, description, status, priority, assigned_vendor)
SELECT 1, 1, 'Leaking kitchen tap', 'resolved', 'medium', 'Nairobi Plumbing Co.'
WHERE NOT EXISTS (SELECT 1 FROM maintenance_requests WHERE description = 'Leaking kitchen tap');

INSERT INTO maintenance_requests (unit_id, tenant_id, description, status, priority, assigned_vendor)
SELECT 2, 2, 'AC unit not cooling', 'open', 'high', NULL
WHERE NOT EXISTS (SELECT 1 FROM maintenance_requests WHERE description = 'AC unit not cooling');