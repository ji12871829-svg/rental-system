-- 016_portal_setup_token.sql
-- One-time portal setup links (OWASP #7 / #2 — stop emailing plaintext
-- passwords): when staff issue portal access without a custom password, the
-- tenant now receives a single-use setup link instead of a generated
-- password. The token is stored only as a SHA-256 hash with an expiry;
-- completing setup overwrites password_hash and clears the token.
--
-- Idempotent (IF NOT EXISTS) so a fresh install bootstrapping from
-- database/schema.sql (which carries the same columns) re-runs cleanly.

ALTER TABLE tenant_portal_access ADD COLUMN IF NOT EXISTS setup_token_hash TEXT;
ALTER TABLE tenant_portal_access ADD COLUMN IF NOT EXISTS setup_token_expires_at TIMESTAMPTZ;
