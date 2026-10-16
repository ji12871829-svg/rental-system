-- 018_sms_inbox.sql
-- Tenant replies via textbee (MESSAGE_RECEIVED webhook): inbound texts have
-- no receipt or reminder row to attach to, so they land in their own inbox
-- table, newest-first. Dedupe key is the webhook idempotency key — textbee
-- retries a delivery up to 10 times carrying the same key, and may rarely
-- re-emit a status with a fresh key (harmless: a second row for a genuinely
-- distinct delivery).
--
-- Idempotent (IF NOT EXISTS) so a fresh install bootstrapping from
-- database/schema.sql (which carries the same table) re-runs cleanly.

CREATE TABLE IF NOT EXISTS sms_inbox (
  id              SERIAL PRIMARY KEY,
  sender          TEXT NOT NULL,
  message         TEXT NOT NULL DEFAULT '',
  device_id       TEXT,
  textbee_sms_id  TEXT,
  idempotency_key TEXT UNIQUE,
  received_at     TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_inbox_created ON sms_inbox(created_at DESC);
