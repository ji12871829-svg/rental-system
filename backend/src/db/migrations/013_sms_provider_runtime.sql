-- Runtime SMS provider selection: the Settings UI can now flip the SMS
-- provider (Africa's Talking ↔ textbee) without an .env edit or redeploy.
-- The env var SMS_PROVIDER remains the default/fallback so existing
-- deployments behave exactly as before; the settings row, when set to a
-- concrete provider, overrides it until cleared back to NULL.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(20)
  CHECK (sms_provider IN ('mock', 'africastalking', 'twilio', 'textbee'));
