-- 011_message_template_kind.sql
-- Tracks which message_templates kind (if any) was used for a sent/reminder
-- SMS or email, so the history can show "sent from <template>" without
-- changing the send lifecycle.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS keeps existing installs safe.
-- Nullable by design: legacy rows and sends that did not pick a template
-- stay NULL; the dashboard quick-action path sets it when the operator
-- chooses a saved template.

ALTER TABLE sms_notifications
  ADD COLUMN IF NOT EXISTS template_kind VARCHAR(40);

COMMENT ON COLUMN sms_notifications.template_kind IS
  'message_templates.kind used for this send, or NULL when no template was selected';

ALTER TABLE email_notifications
  ADD COLUMN IF NOT EXISTS template_kind VARCHAR(40);

COMMENT ON COLUMN email_notifications.template_kind IS
  'message_templates.kind used for this send, or NULL when no template was selected';
