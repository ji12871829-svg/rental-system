-- ============================================================================
-- Cleanup: remove sample/seed data, keep configuration and users.
-- ----------------------------------------------------------------------------
-- The reverse of database/seed.sql. Use after go-live verification to wipe the
-- demo tenants/payments/readings and start recording real data on a clean
-- slate — without redeploying or re-bootstrapping (settings, the property,
-- floors, units and users are all preserved).
--
--   KEPT:  users, settings, business_branding, properties, floors, units,
--          audit_logs, privacy_requests (compliance register — never purged)
--   DELETED: rent_payments, water_payments, water_meter_readings, receipts,
--          sms_notifications, email_notifications, water_purchases, expenses,
--          the five sample tenants; units they occupied flip back to VACANT.
--
-- Run from a machine with the pooled Neon URL:
--     psql "$DATABASE_URL" -f database/cleanup-seed.sql
-- or paste the whole file into the Neon console → SQL Editor.
--
-- Safety:
--   * single transaction — everything is removed or nothing is;
--   * refuses to run if any row looks user-created (a payment, expense or
--     receipt that is not part of the seed). To force it anyway, uncomment
--     the SET line below — but check what you would be deleting first;
--   * re-running is harmless (second run deletes 0 rows).
-- ============================================================================

-- SET rpms.allow_cleanup = 'on';   -- uncomment ONLY to override the guard

BEGIN;

DO $$
DECLARE
  sample_tenants text[] := ARRAY[
    'Peter Otieno', 'Jane Wanjiru', 'John Mwangi', 'Grace Njeri', 'Amina Hassan'
  ];
  violations text := '';
  n bigint;
BEGIN
  -- Collect ALL violations first so one run reports everything worth reviewing.
  SELECT count(*) INTO n FROM tenants WHERE NOT (full_name = ANY(sample_tenants));
  IF n > 0 THEN violations := format('%s non-sample tenant row(s) exist — real data? Review manually.', n); END IF;

  SELECT count(*) INTO n
    FROM rent_payments WHERE (payment_reference LIKE 'SEED-RP-%') IS NOT TRUE;
  IF n > 0 THEN violations := violations || format(' | %s rent payment row(s) are not seed rows', n); END IF;

  SELECT count(*) INTO n
    FROM water_meter_readings r JOIN tenants t ON t.id = r.tenant_id
    WHERE NOT (t.full_name = ANY(sample_tenants));
  IF n > 0 THEN violations := violations || format(' | %s water reading(s) belong to non-sample tenants', n); END IF;

  SELECT count(*) INTO n FROM water_purchases
    WHERE (reference_number LIKE 'WTR-2026-%') IS NOT TRUE;
  IF n > 0 THEN violations := violations || format(' | %s water purchase row(s) are not seed rows', n); END IF;

  SELECT count(*) INTO n FROM expenses
    WHERE (reference_number LIKE 'EXP-2026-%') IS NOT TRUE;
  IF n > 0 THEN violations := violations || format(' | %s expense row(s) are not seed rows', n); END IF;

  SELECT count(*) INTO n
    FROM receipts rc JOIN tenants t ON t.id = rc.tenant_id
    WHERE NOT (t.full_name = ANY(sample_tenants));
  IF n > 0 THEN violations := violations || format(' | %s receipt(s) belong to non-sample tenants', n); END IF;

  IF violations <> '' THEN
    IF coalesce(current_setting('rpms.allow_cleanup', true), 'off') = 'on' THEN
      RAISE WARNING 'cleanup override enabled — proceeding despite: %', violations;
    ELSE
      RAISE EXCEPTION 'cleanup aborted: %', violations;
    END IF;
  END IF;

  RAISE NOTICE 'guards passed — deleting seed data…';
END
$$;

-- Flip units the sample tenants occupied back to VACANT (before tenant delete).
UPDATE units SET occupancy_status = 'VACANT'
WHERE occupancy_status = 'OCCUPIED'
  AND id IN (SELECT unit_id FROM tenants WHERE full_name IN (
    'Peter Otieno', 'Jane Wanjiru', 'John Mwangi', 'Grace Njeri', 'Amina Hassan'));

-- Children first (FK graph): notifications → receipts → payments → readings.
DELETE FROM sms_notifications      WHERE tenant_id IS NOT NULL;
DELETE FROM email_notifications    WHERE tenant_id IS NOT NULL;
DELETE FROM receipts;
DELETE FROM rent_payments;
DELETE FROM water_payments;
DELETE FROM water_meter_readings;
DELETE FROM water_purchases;
DELETE FROM expenses;
DELETE FROM tenants;

COMMIT;

-- Post-cleanup report: everything transactional should read 0; the config
-- tables keep their counts (24 units, 3 users, 1 settings row, …).
SELECT 'tenants' AS table, count(*) FROM tenants
UNION ALL SELECT 'rent_payments',      count(*) FROM rent_payments
UNION ALL SELECT 'water_payments',     count(*) FROM water_payments
UNION ALL SELECT 'water_readings',     count(*) FROM water_meter_readings
UNION ALL SELECT 'water_purchases',    count(*) FROM water_purchases
UNION ALL SELECT 'expenses',           count(*) FROM expenses
UNION ALL SELECT 'receipts',           count(*) FROM receipts
UNION ALL SELECT 'sms_notifications',  count(*) FROM sms_notifications
UNION ALL SELECT 'email_notifications',count(*) FROM email_notifications
UNION ALL SELECT 'units (kept)',       count(*) FROM units
UNION ALL SELECT 'users (kept)',       count(*) FROM users;
