-- 001_init_schema.sql
-- Canonical schema — see docs/BACKEND-SCHEMA.md and docs/ARCHITECTURE.md §4 for reference.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(150) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE building_settings (
  id              SERIAL PRIMARY KEY,
  building_name   VARCHAR(150) NOT NULL,
  address_line1   VARCHAR(255) NOT NULL,
  address_line2   VARCHAR(255),
  city            VARCHAR(100) NOT NULL,
  country         VARCHAR(100) NOT NULL DEFAULT 'Kenya',
  currency        VARCHAR(3)   NOT NULL DEFAULT 'USD',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE units (
  id              SERIAL PRIMARY KEY,
  unit_number     VARCHAR(20)  NOT NULL UNIQUE,
  floor           VARCHAR(20),
  bedrooms        SMALLINT     NOT NULL DEFAULT 1 CHECK (bedrooms >= 0),
  bathrooms       SMALLINT     NOT NULL DEFAULT 1 CHECK (bathrooms >= 0),
  square_feet     INTEGER,
  base_rent       NUMERIC(10,2) NOT NULL CHECK (base_rent >= 0),
  status          VARCHAR(20)  NOT NULL DEFAULT 'vacant'
                    CHECK (status IN ('vacant', 'occupied', 'maintenance')),
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_units_status ON units(status);

CREATE TABLE tenants (
  id                      SERIAL PRIMARY KEY,
  first_name              VARCHAR(100) NOT NULL,
  last_name               VARCHAR(100) NOT NULL,
  email                   VARCHAR(255) NOT NULL UNIQUE,
  phone                   VARCHAR(30)  NOT NULL,
  national_id             VARCHAR(50),
  emergency_contact_name  VARCHAR(150),
  emergency_contact_phone VARCHAR(30),
  is_archived             BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tenants_is_archived ON tenants(is_archived);

CREATE TABLE leases (
  id              SERIAL PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  monthly_rent    NUMERIC(10,2) NOT NULL CHECK (monthly_rent >= 0),
  deposit_amount  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'terminated')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date > start_date),
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'active')
);
CREATE INDEX idx_leases_unit_id   ON leases(unit_id);
CREATE INDEX idx_leases_tenant_id ON leases(tenant_id);
CREATE INDEX idx_leases_status    ON leases(status);
CREATE INDEX idx_leases_end_date  ON leases(end_date);

CREATE TABLE payments (
  id                SERIAL PRIMARY KEY,
  lease_id          INTEGER NOT NULL REFERENCES leases(id) ON DELETE RESTRICT,
  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  payment_date      DATE NOT NULL,
  payment_method    VARCHAR(20) NOT NULL
                      CHECK (payment_method IN ('cash','mpesa','bank_transfer','card','other')),
  reference_number  VARCHAR(100),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_lease_id     ON payments(lease_id);
CREATE INDEX idx_payments_payment_date ON payments(payment_date);

CREATE TABLE maintenance_requests (
  id              SERIAL PRIMARY KEY,
  unit_id         INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  tenant_id       INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  description     TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved','cancelled')),
  priority        VARCHAR(10) NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','urgent')),
  assigned_vendor VARCHAR(150),
  cost            NUMERIC(10,2) CHECK (cost >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX idx_maintenance_unit_id ON maintenance_requests(unit_id);
CREATE INDEX idx_maintenance_status  ON maintenance_requests(status);
