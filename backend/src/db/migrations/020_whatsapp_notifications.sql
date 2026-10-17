-- 020_whatsapp_notifications.sql
-- The WHATSAPP channel's outbound queue — delivery rows for reminders and
-- Final Notices sent through the official Meta WhatsApp Cloud API (see
-- whatsappProvider).
--
-- Why this exists: the WhatsApp channel used to be click-to-chat only — the
-- backend composed a wa.me link and the operator pressed send in the app.
-- Direct Cloud API delivery needs bookkeeping the click-to-chat flow never
-- had: which number the send went to, whether Meta accepted it (and its
-- wamid), what went wrong (Meta's 24-hour customer-service window is the
-- common one), and how many attempts the retry sweep has burned.
--
-- The lifecycle mirrors sms_notifications / email_notifications exactly so
-- the shared retry sweep (retrySweep.ts) and the history page work the same
-- way:
--   PENDING    queued, not yet attempted (a crash between queue and send
--              leaves a recoverable row).
--   SENT       Meta accepted the message (stored provider_message_id = wamid).
--   FAILED     transient failure with a next_retry_at backoff deadline —
--              whatsappRetryJob replays it; a closed 24-hour window lands
--              here too, because a tenant reply opens the window and then
--              the same row goes through.
--   ERRONEOUS  terminal — the recipient number is not on WhatsApp (Meta
--              code 131026) or the message type is unsupported; no deadline
--              is scheduled. Still manually re-sendable after a phone fix.
--
-- Idempotent on fresh installs only (plain CREATE TABLE); the app applies
-- migrations in order, so 019 already exists by the time this runs.

CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'ERRONEOUS')),
  provider_message_id TEXT,
  template_kind TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_notifications_tenant ON whatsapp_notifications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_notifications_status ON whatsapp_notifications (status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_notifications_created ON whatsapp_notifications (created_at DESC);
