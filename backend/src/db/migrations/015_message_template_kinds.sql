-- 015_message_template_kinds.sql
-- Widens the message_templates.kind CHECK to the full 14-kind list.
--
-- Two reasons, one of them a live bug:
--
--   1. SMS_LANDLORD_ALERT and SMS_RENT_DUE_SOON were added to
--      TEMPLATE_KINDS (templateService.ts) and to their send paths, but the
--      CHECK constraint was never widened for them — 008 shipped a 9-kind
--      list and 009 only added WHATSAPP_PAYMENT_CONFIRMATION to it. The
--      Message Templates editor therefore offered two kinds the database
--      would reject: saving either one raised a check violation (500) that
--      the UI reported as a generic save failure.
--
--   2. The three operator-sendable notice kinds (SMS_WATER_BILLING,
--      SMS_LATE_FEE, SMS_WELCOME) are new in this release.
--
-- Follows the 009 precedent: DROP the old constraint, ADD the wider one.
-- Idempotent (DROP IF EXISTS), and re-runnable from a cold start because a
-- fresh install bootstraps from database/schema.sql, which carries the same
-- list. No data is touched: rows can only ever hold kinds that were valid.

ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_kind_check;
ALTER TABLE message_templates ADD CONSTRAINT message_templates_kind_check CHECK (kind IN (
  'SMS_RENT_RECEIPT', 'SMS_WATER_RECEIPT', 'SMS_COMBINED_RECEIPT',
  'SMS_BALANCE_DUE', 'SMS_OVERDUE',
  'SMS_LANDLORD_ALERT', 'SMS_RENT_DUE_SOON',
  'SMS_WATER_BILLING', 'SMS_LATE_FEE', 'SMS_WELCOME',
  'WHATSAPP_BALANCE_DUE', 'WHATSAPP_OVERDUE',
  'WHATSAPP_PAYMENT_CONFIRMATION',
  'EMAIL_CAMPAIGN'
));
