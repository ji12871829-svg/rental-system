-- 010_email_notifications_retry.sql
-- Gives the EMAIL channel the same replay bookkeeping the SMS channel already
-- has (see sms_notifications.attempt_count / next_retry_at and smsRetryJob),
-- and widens the status CHECK to carry the terminal ERRONEOUS outcome.
--
-- Why this migration exists: sendEmailNotification() was extended to increment
-- attempt_count and schedule next_retry_at on failure, but email_notifications
-- never gained the columns — so every receipt email send (success AND failure
-- paths) failed with `column "attempt_count" does not exist`. This migration
-- closes that gap. Fresh installs get the same shape from the updated
-- database/schema.sql, so on a new database this is a harmless no-op; existing
-- installs need it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a DROP/ADD constraint pair, following
-- the 009 constraint-widening precedent.

ALTER TABLE email_notifications
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE email_notifications
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Widen the status CHECK. ERRONEOUS is the terminal "this will never succeed
-- as addressed" outcome (permanent SMTP rejection / undeliverable mailbox),
-- distinct from FAILED "the attempt failed, retry may help". Both stay
-- replayable — emailRetryJob claims rows in EITHER status that carry a due
-- next_retry_at deadline — but ERRONEOUS rows are written without a deadline,
-- so automation leaves them for the operator to act on. Drop-and-recreate
-- because Postgres cannot widen an inline CHECK in place.
ALTER TABLE email_notifications DROP CONSTRAINT IF EXISTS email_notifications_status_check;
ALTER TABLE email_notifications ADD CONSTRAINT email_notifications_status_check
  CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'ERRONEOUS'));

-- The sweep reads due rows by status + deadline, exactly like the SMS sweep.
-- Partial index: only rows that actually carry a deadline are ever candidates,
-- and SENT rows never are.
CREATE INDEX IF NOT EXISTS idx_email_retry ON email_notifications(next_retry_at)
  WHERE next_retry_at IS NOT NULL;
