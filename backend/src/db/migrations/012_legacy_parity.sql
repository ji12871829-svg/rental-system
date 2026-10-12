-- Round 2 (legacy parity): penalty engine, document vault, vacancy listings.
-- Conventions as 011: SERIAL ids, CHECK-guarded enums, TIMESTAMPTZ stamps,
-- ON DELETE SET NULL so history survives reference deletion.
--
-- Penalty reversals ride the rent ledger as NEGATIVE rent_payments rows (the
-- 'PENALTY' reversal the Record-Payment form already accepts). The table-level
-- CHECK (amount > 0) therefore widens to amount <> 0 — manual entries stay
-- positive through the API's z.number().positive() guard, unchanged.
ALTER TABLE rent_payments DROP CONSTRAINT IF EXISTS rent_payments_amount_check;
ALTER TABLE rent_payments ADD CONSTRAINT rent_payments_amount_check CHECK (amount <> 0);

-- --- Late-fee (penalty) engine ----------------------------------------------
-- A rule says what to charge; penalty_log records what WAS charged (with the
-- balance snapshot at apply time). Applied penalties are real ledger rows, so
-- every existing balance view (arrears, ledger, statement, portal) accounts
-- for them with zero special-casing.
CREATE TABLE IF NOT EXISTS penalty_rules (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  rule_type   VARCHAR(20)  NOT NULL DEFAULT 'FIXED'
                CHECK (rule_type IN ('FIXED', 'PERCENTAGE')),
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  percentage  NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (percentage >= 0),
  grace_days  INTEGER      NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  max_penalty NUMERIC(12,2),
  applies_to  VARCHAR(20)  NOT NULL DEFAULT 'RENT'
                CHECK (applies_to IN ('RENT', 'WATER')),
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS penalty_log (
  id              SERIAL PRIMARY KEY,
  rule_id         INTEGER      REFERENCES penalty_rules(id) ON DELETE SET NULL,
  tenant_id       INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month           INTEGER      NOT NULL CHECK (month BETWEEN 1 AND 12),
  year            INTEGER      NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  balance_before  NUMERIC(12,2) NOT NULL DEFAULT 0,
  description     TEXT,
  payment_id      INTEGER      REFERENCES rent_payments(id) ON DELETE SET NULL,
  applied_by      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  applied_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- One penalty per tenant per (rule, month, year): re-running apply can
  -- never double-charge the same month.
  UNIQUE (rule_id, tenant_id, month, year)
);
CREATE INDEX IF NOT EXISTS idx_penalty_log_tenant ON penalty_log(tenant_id, year);

-- --- Document vault ----------------------------------------------------------
-- Entity links are nullable; the service requires at least one. Files live as
-- bytea like the branding logo — single-service deployment, no shared disk.
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  doc_type      VARCHAR(40)  NOT NULL
                  CHECK (doc_type IN ('LEASE_AGREEMENT', 'INVOICE', 'RECEIPT', 'ID_DOCUMENT',
                                      'INSPECTION_REPORT', 'PHOTO', 'INSURANCE', 'OTHER')),
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  unit_id       INTEGER REFERENCES units(id) ON DELETE SET NULL,
  file_data     BYTEA        NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(120) NOT NULL,
  file_size     INTEGER      NOT NULL CHECK (file_size > 0),
  uploaded_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_unit ON documents(unit_id);

-- --- Vacancy listings (public marketing board) -------------------------------
-- One listing per unit. The public endpoint exposes ONLY marketing fields —
-- never tenant identity.
CREATE TABLE IF NOT EXISTS vacancy_listings (
  id            SERIAL PRIMARY KEY,
  unit_id       INTEGER     NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  title         VARCHAR(160) NOT NULL,
  description   TEXT,
  rent_amount   NUMERIC(12,2) NOT NULL,
  deposit       NUMERIC(12,2),
  photos        JSONB       NOT NULL DEFAULT '[]',
  amenities     JSONB       NOT NULL DEFAULT '[]',
  is_published  BOOLEAN     NOT NULL DEFAULT FALSE,
  published_at  TIMESTAMPTZ,
  views         INTEGER     NOT NULL DEFAULT 0,
  inquiries     INTEGER     NOT NULL DEFAULT 0,
  created_by    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (unit_id)
);
CREATE INDEX IF NOT EXISTS idx_vacancy_published ON vacancy_listings(is_published);
