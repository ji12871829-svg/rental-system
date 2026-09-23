-- 007_stale_unmatched_alerts.sql — stale-unmatched-payment escalation.
--
-- The instant operator alert fires when a payment FIRST lands in the review
-- queue (RECEIVED → UNMATCHED/AMBIGUOUS). This migration adds the bookkeeping
-- needed for the follow-up escalation: when a transaction is STILL sitting in
-- the queue after an hour (nobody has reviewed it), the alert job emails the
-- operator again — once per transaction.
--
-- stale_alerted_at records that the escalation email was sent; NULL means the
-- transaction has never been escalated (or is not stale). Resolved rows are
-- excluded by the job's WHERE clause, so the column is never cleaned up on
-- resolution — an audit-friendly trail.
ALTER TABLE mpesa_transactions
  ADD COLUMN IF NOT EXISTS stale_alerted_at TIMESTAMPTZ;
