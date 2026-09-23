-- 006_owner_remittance.sql — property-owner communication settings.
--
-- The owner templates (monthly remittance summary, expense notice, full
-- financial statement) are addressed to the PROPERTY OWNER — the person who
-- owns the building and receives the "rent collected minus fee minus
-- expenses" payout. This system has no multi-owner model: one property, one
-- owner, so the contact details and the management-fee percentage live on
-- the settings singleton alongside everything else that is global.
--
-- All three columns are NULL until the operator fills them in Settings;
-- every owner template degrades gracefully (channels without a contact
-- point are simply not offered, like tenant reminders without a phone).
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS owner_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS owner_phone VARCHAR(30),
  -- Management fee as a percentage of collections (0–100, 2dp). NULL =
  -- no fee arrangement configured; owner messages then show no fee line.
  ADD COLUMN IF NOT EXISTS management_fee_percent NUMERIC(5,2)
    CHECK (management_fee_percent IS NULL OR (management_fee_percent >= 0 AND management_fee_percent <= 100));
