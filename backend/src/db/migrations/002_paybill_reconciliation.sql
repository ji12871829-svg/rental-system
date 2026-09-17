-- PayBill configuration and typed callback reconciliation.

ALTER TABLE business_branding
  ADD COLUMN IF NOT EXISTS paybill_number VARCHAR(10),
  ADD COLUMN IF NOT EXISTS paybill_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS paybill_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS paybill_instructions TEXT;

ALTER TABLE mpesa_transactions
  ADD COLUMN IF NOT EXISTS water_payment_id INTEGER REFERENCES water_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_kind VARCHAR(10) NOT NULL DEFAULT 'RENT';

ALTER TABLE mpesa_transactions DROP CONSTRAINT IF EXISTS mpesa_transactions_payment_kind_check;
ALTER TABLE mpesa_transactions
  ADD CONSTRAINT mpesa_transactions_payment_kind_check
  CHECK (payment_kind IN ('RENT', 'WATER'));

ALTER TABLE mpesa_transactions DROP CONSTRAINT IF EXISTS mpesa_transactions_status_check;
ALTER TABLE mpesa_transactions
  ADD CONSTRAINT mpesa_transactions_status_check
  CHECK (status IN ('RECEIVED', 'MATCHED', 'POSTED', 'UNMATCHED', 'AMBIGUOUS', 'FAILED'));

CREATE INDEX IF NOT EXISTS idx_mpesa_payment_kind ON mpesa_transactions(payment_kind);