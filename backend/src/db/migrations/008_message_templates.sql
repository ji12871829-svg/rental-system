-- 008_message_templates.sql
-- User-editable message templates (9 kinds) with mail-merge support.
--
-- A row exists ONLY for a template someone actually customized. Every send
-- path (receipt SMS, reminders, WhatsApp composes, tenant email campaign)
-- falls back to its hardcoded default when there is no row, so:
--   * no rows == today's behaviour, byte-for-byte (existing tests stay green)
--   * "Revert" in the UI is just a DELETE of the row
-- Idempotent: safe to re-run, and safe to coexist with the same DDL appended
-- to database/schema.sql (fresh installs bootstrap from schema.sql; existing
-- installs reach this table through the migrations runner).

CREATE TABLE IF NOT EXISTS message_templates (
  id         SERIAL PRIMARY KEY,
  kind       VARCHAR(40) NOT NULL UNIQUE
             CHECK (kind IN (
               'SMS_RENT_RECEIPT', 'SMS_WATER_RECEIPT', 'SMS_COMBINED_RECEIPT',
               'SMS_BALANCE_DUE', 'SMS_OVERDUE',
               'WHATSAPP_BALANCE_DUE', 'WHATSAPP_OVERDUE',
               'WHATSAPP_PAYMENT_CONFIRMATION',
               'EMAIL_CAMPAIGN'
             )),
  subject    VARCHAR(200),                       -- EMAIL_CAMPAIGN only
  body       TEXT NOT NULL,
  is_custom  BOOLEAN NOT NULL DEFAULT TRUE,      -- rows only exist once edited
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_message_templates_updated_at ON message_templates;
CREATE TRIGGER trg_message_templates_updated_at BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();