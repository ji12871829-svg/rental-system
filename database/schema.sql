-- ============================================================================
-- Rental Property Management System — PostgreSQL schema
-- ----------------------------------------------------------------------------
-- Idempotent: safe to run multiple times (CREATE ... IF NOT EXISTS).
-- All money is NUMERIC(12,2); rents, bills and rates are NEVER hard-coded in
-- application code — they live here and in `settings` and are read at runtime.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(150)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  phone         VARCHAR(30),
  password_hash VARCHAR(255)  NOT NULL,
  role          VARCHAR(30)   NOT NULL DEFAULT 'STAFF'
                  CHECK (role IN ('ADMIN', 'PROPERTY_MANAGER', 'STAFF')),
  status        VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- properties — the schema is multi-property ready from day one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(150) NOT NULL,
  address        VARCHAR(255),
  reporting_year INTEGER      NOT NULL DEFAULT 2026,
  currency       VARCHAR(10)  NOT NULL DEFAULT 'KSh',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- floors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS floors (
  id           SERIAL PRIMARY KEY,
  property_id  INTEGER      NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  floor_number INTEGER      NOT NULL CHECK (floor_number > 0),
  name         VARCHAR(100) NOT NULL,
  UNIQUE (property_id, floor_number)
);

-- ---------------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS units (
  id               SERIAL PRIMARY KEY,
  property_id      INTEGER     NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  floor_id         INTEGER     NOT NULL REFERENCES floors(id) ON DELETE RESTRICT,
  unit_number      VARCHAR(20) NOT NULL,
  unit_type        VARCHAR(30) NOT NULL DEFAULT 'Room'
                     CHECK (unit_type IN ('Room', 'Bedsitter', '1 Bedroom', '2 Bedroom')),
  monthly_rent     NUMERIC(12,2) NOT NULL CHECK (monthly_rent >= 0),
  water_enabled    BOOLEAN     NOT NULL DEFAULT FALSE,
  occupancy_status VARCHAR(20) NOT NULL DEFAULT 'VACANT'
                     CHECK (occupancy_status IN ('OCCUPIED', 'VACANT')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, unit_number)
);
CREATE INDEX IF NOT EXISTS idx_units_floor        ON units(floor_id);
CREATE INDEX IF NOT EXISTS idx_units_property     ON units(property_id);
CREATE INDEX IF NOT EXISTS idx_units_occupancy    ON units(occupancy_status);
CREATE INDEX IF NOT EXISTS idx_units_water_enable ON units(water_enabled);

DROP TRIGGER IF EXISTS trg_units_updated_at ON units;
CREATE TRIGGER trg_units_updated_at BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- tenants — one row per tenant; unit assignment via unit_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id               SERIAL PRIMARY KEY,
  unit_id          INTEGER REFERENCES units(id) ON DELETE SET NULL,
  full_name        VARCHAR(150) NOT NULL,
  phone_number     VARCHAR(30),
  email            VARCHAR(255),
  move_in_date     DATE,
  move_out_date    DATE,
  security_deposit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
  status           VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'MOVED_OUT')),
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (move_out_date IS NULL OR move_in_date IS NULL OR move_out_date >= move_in_date)
);
CREATE INDEX IF NOT EXISTS idx_tenants_unit   ON tenants(unit_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- rent_payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rent_payments (
  id                SERIAL PRIMARY KEY,
  payment_reference VARCHAR(100),
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  unit_id           INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  payment_date      DATE    NOT NULL,
  billing_month     SMALLINT NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
  billing_year      INTEGER  NOT NULL,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method    VARCHAR(20) NOT NULL
                      CHECK (payment_method IN ('CASH', 'M_PESA', 'BANK', 'OTHER')),
  receipt_number    VARCHAR(30),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rent_payments_tenant ON rent_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_unit   ON rent_payments(unit_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_month  ON rent_payments(billing_year, billing_month);
CREATE INDEX IF NOT EXISTS idx_rent_payments_date   ON rent_payments(payment_date);

-- ---------------------------------------------------------------------------
-- mpesa_transactions — provider callbacks are retried, so provider IDs and
-- STK checkout IDs are unique before any rent payment is posted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id                   SERIAL PRIMARY KEY,
  source               VARCHAR(10) NOT NULL CHECK (source IN ('C2B', 'STK')),
  transaction_id      VARCHAR(100),
  checkout_request_id VARCHAR(100),
  merchant_request_id VARCHAR(100),
  account_reference   VARCHAR(100) NOT NULL,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  transaction_date    TIMESTAMPTZ,
  phone_number        VARCHAR(30),
  status              VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
                        CHECK (status IN ('RECEIVED', 'MATCHED', 'POSTED', 'UNMATCHED', 'FAILED')),
  tenant_id           INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  rent_payment_id     INTEGER REFERENCES rent_payments(id) ON DELETE SET NULL,
  error_message       TEXT,
  raw_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_transaction_id
  ON mpesa_transactions(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_checkout_request_id
  ON mpesa_transactions(checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mpesa_status ON mpesa_transactions(status);
CREATE INDEX IF NOT EXISTS idx_mpesa_account_reference ON mpesa_transactions(account_reference);
CREATE INDEX IF NOT EXISTS idx_mpesa_created ON mpesa_transactions(created_at);

DROP TRIGGER IF EXISTS trg_mpesa_transactions_updated_at ON mpesa_transactions;
CREATE TRIGGER trg_mpesa_transactions_updated_at BEFORE UPDATE ON mpesa_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- water_meter_readings — one reading per unit per billing month.
-- The CHECK below makes "current lower than previous" impossible at the DB
-- level; the service layer returns the friendly error message first.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_meter_readings (
  id               SERIAL PRIMARY KEY,
  unit_id          INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  tenant_id        INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  reading_date     DATE    NOT NULL,
  billing_month    SMALLINT NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
  billing_year     INTEGER  NOT NULL,
  previous_reading NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (previous_reading >= 0),
  current_reading  NUMERIC(12,2) NOT NULL CHECK (current_reading >= 0),
  consumption      NUMERIC(12,2) NOT NULL CHECK (consumption >= 0),
  water_rate       NUMERIC(12,2) NOT NULL CHECK (water_rate >= 0),
  water_bill       NUMERIC(12,2) NOT NULL CHECK (water_bill >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (current_reading >= previous_reading),
  CHECK (consumption = current_reading - previous_reading),
  CHECK (water_bill = consumption * water_rate),
  UNIQUE (unit_id, billing_month, billing_year)
);
CREATE INDEX IF NOT EXISTS idx_readings_unit  ON water_meter_readings(unit_id);
CREATE INDEX IF NOT EXISTS idx_readings_month ON water_meter_readings(billing_year, billing_month);

-- ---------------------------------------------------------------------------
-- water_payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_payments (
  id                SERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  unit_id           INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  payment_date      DATE    NOT NULL,
  billing_month     SMALLINT NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
  billing_year      INTEGER  NOT NULL,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method    VARCHAR(20) NOT NULL
                      CHECK (payment_method IN ('CASH', 'M_PESA', 'BANK', 'OTHER')),
  receipt_number    VARCHAR(30),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_water_payments_tenant ON water_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_water_payments_unit   ON water_payments(unit_id);
CREATE INDEX IF NOT EXISTS idx_water_payments_month  ON water_payments(billing_year, billing_month);

-- ---------------------------------------------------------------------------
-- STRICT WATER RULE (enforced at the database level, §11/§51):
-- water transactions may ONLY reference units with water_enabled = TRUE.
-- The application also validates this and returns a friendly 422, but the
-- trigger is the race-condition / mistake safety net.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_water_billing_rule() RETURNS trigger AS $$
DECLARE
  unit_water_enabled BOOLEAN;
BEGIN
  SELECT water_enabled INTO unit_water_enabled FROM units WHERE id = NEW.unit_id;
  IF unit_water_enabled IS NULL THEN
    RAISE EXCEPTION 'UNIT_NOT_FOUND';
  END IF;
  IF NOT unit_water_enabled THEN
    RAISE EXCEPTION 'WATER_DISABLED_FOR_UNIT';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_readings_enforce_water ON water_meter_readings;
CREATE TRIGGER trg_readings_enforce_water BEFORE INSERT OR UPDATE ON water_meter_readings
  FOR EACH ROW EXECUTE FUNCTION enforce_water_billing_rule();

DROP TRIGGER IF EXISTS trg_water_payments_enforce_water ON water_payments;
CREATE TRIGGER trg_water_payments_enforce_water BEFORE INSERT OR UPDATE ON water_payments
  FOR EACH ROW EXECUTE FUNCTION enforce_water_billing_rule();

-- ---------------------------------------------------------------------------
-- water_purchases — water the landlord buys to supply the building.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_purchases (
  id               SERIAL PRIMARY KEY,
  purchase_date    DATE    NOT NULL,
  supplier         VARCHAR(150) NOT NULL,
  quantity         NUMERIC(12,2) NOT NULL CHECK (quantity >= 0),
  measurement_unit VARCHAR(30) NOT NULL DEFAULT 'units',
  cost_per_unit    NUMERIC(12,2) NOT NULL CHECK (cost_per_unit >= 0),
  total_cost       NUMERIC(12,2) NOT NULL CHECK (total_cost >= 0),
  payment_method   VARCHAR(20) NOT NULL
                     CHECK (payment_method IN ('CASH', 'M_PESA', 'BANK', 'OTHER')),
  reference_number VARCHAR(100),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (total_cost = quantity * cost_per_unit)
);
CREATE INDEX IF NOT EXISTS idx_water_purchases_date ON water_purchases(purchase_date);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id               SERIAL PRIMARY KEY,
  expense_date     DATE    NOT NULL,
  description      TEXT    NOT NULL,
  category         VARCHAR(30) NOT NULL
                     CHECK (category IN ('WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE',
                                         'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER')),
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method   VARCHAR(20) NOT NULL
                     CHECK (payment_method IN ('CASH', 'M_PESA', 'BANK', 'OTHER')),
  reference_number VARCHAR(100),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- ---------------------------------------------------------------------------
-- receipts — receipt_number is globally unique (RC- / WC- / RWC- prefixes).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipts (
  id             SERIAL PRIMARY KEY,
  receipt_number VARCHAR(30) NOT NULL UNIQUE,
  receipt_type   VARCHAR(10) NOT NULL CHECK (receipt_type IN ('RENT', 'WATER', 'COMBINED')),
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  unit_id        INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  payment_date   DATE NOT NULL,
  billing_month  SMALLINT NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
  billing_year   INTEGER NOT NULL,
  rent_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (rent_amount >= 0),
  water_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (water_amount >= 0),
  total_amount   NUMERIC(12,2) NOT NULL CHECK (total_amount = rent_amount + water_amount),
  balance        NUMERIC(12,2) NOT NULL DEFAULT 0,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_tenant ON receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_receipts_unit   ON receipts(unit_id);
CREATE INDEX IF NOT EXISTS idx_receipts_month  ON receipts(billing_year, billing_month);

-- ---------------------------------------------------------------------------
-- sms_notifications — prepared messages; sending is a stub ready for
-- Africa's Talking / any provider. Keys live in env vars, never here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_notifications (
  id                  SERIAL PRIMARY KEY,
  receipt_id          INTEGER REFERENCES receipts(id) ON DELETE SET NULL,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number        VARCHAR(30) NOT NULL,
  message             TEXT NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  provider_message_id VARCHAR(100),
  sent_at             TIMESTAMPTZ,
  failure_reason      TEXT,
  -- Delivery report outcome (Africa's Talking callback): DELIVERED once the
  -- handset/network confirms receipt, FAILED_ON_NETWORK when the operator
  -- reports a failure after the gateway accepted the message. Empty until a
  -- report arrives; send-status is never mutated by delivery reports.
  delivery_status     VARCHAR(20) CHECK (delivery_status IN ('DELIVERED', 'FAILED_ON_NETWORK')),
  -- Operator network code from the report (e.g. "63902" = Safaricom KE).
  delivery_network    VARCHAR(10),
  delivery_updated_at TIMESTAMPTZ,
  -- Provider-reported delivery cost (e.g. Africa's Talking "KES 1.20"),
  -- stored at send time; NULL for simulated sends (nothing was delivered).
  provider_cost       NUMERIC(10,4),
  provider_currency   VARCHAR(8),
  -- Automatic retry bookkeeping (see smsRetryJob): every send attempt —
  -- auto-send, manual or retry-job — increments attempt_count; FAILED rows
  -- with attempts left get a next_retry_at deadline for the sweep to honor.
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  next_retry_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_tenant ON sms_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_notifications(status);
-- Delivery reports arrive keyed by the provider's message id.
CREATE INDEX IF NOT EXISTS idx_sms_provider_message ON sms_notifications(provider_message_id);

-- ---------------------------------------------------------------------------
-- email_notifications — receipt emails, same lifecycle as SMS: a row is
-- created when a send is requested, then flips to SENT/FAILED with the
-- provider's message id. The rendered receipt HTML is stored so the record
-- is a faithful copy of what the tenant received. Receipt emails carry the
-- real PDF (base64 in attachment_content) as the attachment; the JSON data
-- file on data-request letters uses the same columns (utf8 text).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_notifications (
  id                  SERIAL PRIMARY KEY,
  receipt_id          INTEGER REFERENCES receipts(id) ON DELETE SET NULL,
  -- Nullable: operational emails aimed at the operator (e.g. the monthly
  -- financial report to the landlord) have no tenant counterpart.
  tenant_id           INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  email_address       VARCHAR(255) NOT NULL,
  subject             TEXT NOT NULL,
  body_html           TEXT NOT NULL,
  body_text           TEXT NOT NULL DEFAULT '',
  status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  provider_message_id VARCHAR(255),
  sent_at             TIMESTAMPTZ,
  failure_reason      TEXT,
  -- Faithful copy of any attachment sent with the email (the receipt PDF,
  -- or the JSON data file on a data-request response letter). NULL = none.
  attachment_name     VARCHAR(255),
  attachment_content  TEXT,
  -- MIME type of the attachment; NULL on rows that predate attachments.
  -- 'application/pdf' content is stored base64-encoded, other types utf8.
  attachment_content_type VARCHAR(100),
  -- Second attachment (data-request letter emails carry BOTH the formal
  -- letter PDF and the machine-readable JSON data file). Same encoding rule:
  -- application/pdf base64, other types utf8. NULL = single attachment.
  attachment2_name        VARCHAR(255),
  attachment2_content     TEXT,
  attachment2_content_type VARCHAR(100),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_tenant ON email_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_notifications(status);

-- ---------------------------------------------------------------------------
-- settings — singleton row (id is always 1). Central source of truth for the
-- reporting year, currency and water rate. Never hard-code these elsewhere.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reporting_year INTEGER      NOT NULL DEFAULT 2026,
  currency       VARCHAR(10)  NOT NULL DEFAULT 'KSh',
  water_rate     NUMERIC(12,2) NOT NULL DEFAULT 200 CHECK (water_rate >= 0),
  -- Years after a moved-out tenant's last financial activity before the
  -- automated retention sweep anonymises their personal data (0 disables).
  retention_years SMALLINT    NOT NULL DEFAULT 7 CHECK (retention_years BETWEEN 0 AND 30),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- business_branding — singleton row (id = 1). The operator's real business
-- identity, editable from the Settings page (admin). NULL = not filled yet;
-- every surface (legal pages, receipts, SMS, footers, favicon) hides the
-- missing parts instead of showing placeholders. backend/.env business vars
-- (BUSINESS_NAME etc.) act as fallbacks until values are stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_branding (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  legal_name          VARCHAR(200),
  registration_number VARCHAR(100),
  address             TEXT,
  contact_email       VARCHAR(255),
  privacy_email       VARCHAR(255),
  contact_phone       VARCHAR(60),
  retention_period    VARCHAR(100),
  response_days       VARCHAR(20),
  jurisdiction        VARCHAR(100),
  property_scope      TEXT,
  payment_channels    VARCHAR(200),
  refund_window_days  VARCHAR(40),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_business_branding_updated_at ON business_branding;
CREATE TRIGGER trg_business_branding_updated_at BEFORE UPDATE ON business_branding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated_at ON settings;
CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs — every important mutation writes a row (service layer does
-- this); old_value/new_value are JSONB for structured diffs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(50) NOT NULL,
  entity     VARCHAR(50) NOT NULL,
  entity_id  INTEGER,
  old_value  JSONB,
  new_value  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ---------------------------------------------------------------------------
-- privacy_requests — register of every data-subject request (Kenya DPA 2019
-- / GDPR arts. 15–17): exports and erasures, with who requested the action
-- and why. Written by the export/erase endpoints themselves so nothing can
-- bypass it. Refused requests are logged too (outcome = REFUSED).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS privacy_requests (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  request_type  VARCHAR(20) NOT NULL CHECK (request_type IN ('EXPORT_JSON', 'EXPORT_CSV', 'ERASURE')),
  requester     VARCHAR(120) NOT NULL,
  reason        TEXT NOT NULL,
  performed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outcome       VARCHAR(20) NOT NULL DEFAULT 'COMPLETED'
                  CHECK (outcome IN ('COMPLETED', 'FAILED', 'REFUSED')),
  outcome_note  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_tenant ON privacy_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_created ON privacy_requests(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);-- Tenant portal access — self-service login for tenants.
-- One credential row per tenant, kept in its own table (not on tenants)
-- so tenant PII stays single-sourced and the portal never grants staff
-- roles or staff API access.

CREATE TABLE IF NOT EXISTS tenant_portal_access (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'DISABLED')),
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email),
  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_portal_access_tenant ON tenant_portal_access(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_portal_access_email  ON tenant_portal_access(email);

DROP TRIGGER IF EXISTS trg_tenant_portal_access_updated_at ON tenant_portal_access;
CREATE TRIGGER trg_tenant_portal_access_updated_at BEFORE UPDATE ON tenant_portal_access
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
