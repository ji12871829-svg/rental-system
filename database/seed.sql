-- Rental Property Management System - clean configuration seed.
-- This file creates the property, floors, and vacant units only. Users are
-- created by backend/src/db/setup.ts with runtime-generated password hashes.

INSERT INTO settings (id, reporting_year, currency, water_rate)
SELECT 1, 2026, 'KSh', 200
WHERE NOT EXISTS (SELECT 1 FROM settings);

INSERT INTO properties (name, address, reporting_year, currency)
SELECT 'Olbano Plaza', '123 Riverside Drive, Nairobi', 2026, 'KSh'
WHERE NOT EXISTS (SELECT 1 FROM properties);

INSERT INTO floors (property_id, floor_number, name)
SELECT p.id, f.floor_number, f.name
FROM properties p,
     (VALUES (1, 'First Floor'), (2, 'Second Floor'),
             (3, 'Third Floor'), (4, 'Fourth Floor')) AS f(floor_number, name)
WHERE NOT EXISTS (SELECT 1 FROM floors);

-- Units 1-24 retain the existing seeded rents. Every unit starts vacant;
-- water billing applies only to units 14-24.
INSERT INTO units (property_id, floor_id, unit_number, unit_type, monthly_rent, water_enabled, occupancy_status)
SELECT p.id, fl.id, u.unit_number, u.unit_type, u.monthly_rent,
       u.unit_number::int BETWEEN 14 AND 24 AS water_enabled,
       'VACANT'
FROM properties p
JOIN floors fl ON fl.property_id = p.id
JOIN (VALUES
  ('1',  1, 'Room',      4000),
  ('2',  1, 'Room',      2500),
  ('3',  1, 'Room',      3000),
  ('4',  1, 'Room',      3000),
  ('5',  1, 'Room',      3000),
  ('6',  1, 'Room',      4000),
  ('7',  2, 'Room',      4000),
  ('8',  2, 'Room',      2500),
  ('9',  2, 'Room',      3000),
  ('10', 2, 'Room',      3000),
  ('11', 2, 'Room',      3000),
  ('12', 2, 'Room',      4000),
  ('13', 2, 'Room',      2500),
  ('14', 3, 'Bedsitter', 5500),
  ('15', 3, '1 Bedroom', 9000),
  ('16', 3, 'Bedsitter', 5000),
  ('17', 3, 'Bedsitter', 5000),
  ('18', 3, 'Bedsitter', 5000),
  ('19', 4, 'Bedsitter', 5500),
  ('20', 4, '1 Bedroom', 9000),
  ('21', 4, 'Bedsitter', 5000),
  ('22', 4, 'Bedsitter', 5000),
  ('23', 4, 'Bedsitter', 5000),
  ('24', 4, '2 Bedroom', 11000)
) AS u(unit_number, floor_number, unit_type, monthly_rent)
  ON u.floor_number = fl.floor_number
ON CONFLICT (property_id, unit_number) DO NOTHING;
