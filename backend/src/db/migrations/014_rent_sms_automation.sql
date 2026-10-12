-- Rent SMS automation (landlord alerts + scheduled reminders).
--   notify_landlord_on_payment — per-receipt SMS to the business contact
--     phone (branding) whenever a RENT or COMBINED payment is receipted.
--   auto_reminders_enabled — master switch for the daily scheduler
--     (autoReminderJob): due-soon nudge on the last day of each month,
--     overdue chase on the 5th.
-- sms_notifications.tenant_id drops NOT NULL because the landlord alert is
-- not a tenant message: tenant_id NULL keeps it out of every tenant-scoped
-- history view (tenant filters can never match NULL).
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS notify_landlord_on_payment BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_reminders_enabled     BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE sms_notifications ALTER COLUMN tenant_id DROP NOT NULL;

-- Scheduler dedupe: "did today's AUTO_DUE_SOON / this month's AUTO_OVERDUE
-- batch already go out?" answered by an index on the tag + timestamp.
CREATE INDEX IF NOT EXISTS idx_sms_kind_created ON sms_notifications(template_kind, created_at);
