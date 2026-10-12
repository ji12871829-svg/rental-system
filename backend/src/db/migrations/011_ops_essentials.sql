-- Ops essentials: the operational modules the legacy system had and this
-- codebase lacked — a vendor directory feeding maintenance, maintenance
-- requests with work orders, an expense approval gate, and recurring
-- expenses that auto-generate their expense rows on schedule.
--
-- Conventions mirror the existing tables: SERIAL ids, TEXT enums guarded by
-- CHECK constraints, TIMESTAMPTZ stamps, ON DELETE SET NULL so history
-- survives the deletion of a referenced user/unit/vendor.

-- --- Vendor directory -------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id           SERIAL PRIMARY KEY,
  name         TEXT        NOT NULL,
  service      VARCHAR(40) NOT NULL
                 CHECK (service IN ('PLUMBING', 'ELECTRICAL', 'CLEANING', 'SECURITY',
                                    'CARPENTRY', 'PAINTING', 'LANDSCAPING', 'PEST_CONTROL',
                                    'GENERAL_REPAIRS', 'OTHER')),
  phone        VARCHAR(30),
  email        VARCHAR(255),
  rating       INTEGER     CHECK (rating BETWEEN 1 AND 5),
  notes        TEXT,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(active);

-- --- Maintenance requests ---------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_requests (
  id           SERIAL PRIMARY KEY,
  unit_id      INTEGER     REFERENCES units(id) ON DELETE SET NULL,
  tenant_id    INTEGER     REFERENCES tenants(id) ON DELETE SET NULL,
  title        TEXT        NOT NULL,
  description  TEXT,
  priority     VARCHAR(12) NOT NULL DEFAULT 'MEDIUM'
                 CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY')),
  status       VARCHAR(12) NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED')),
  reported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  created_by   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A resolved request must carry its resolution timestamp.
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL) OR (status <> 'RESOLVED' AND resolved_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_requests(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_unit ON maintenance_requests(unit_id);

-- --- Work orders (execution side of a maintenance request) -------------------
CREATE TABLE IF NOT EXISTS work_orders (
  id            SERIAL PRIMARY KEY,
  request_id    INTEGER      NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  vendor_id     INTEGER      REFERENCES vendors(id) ON DELETE SET NULL,
  assigned_to   TEXT,
  cost          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  status        VARCHAR(12)  NOT NULL DEFAULT 'ASSIGNED'
                  CHECK (status IN ('ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  scheduled_for DATE,
  completed_at  TIMESTAMPTZ,
  notes         TEXT,
  created_by    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_orders_request ON work_orders(request_id);

-- --- Expense approvals (gate before an expense row is recorded) --------------
CREATE TABLE IF NOT EXISTS expense_approvals (
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
  status           VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  decided_by       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  expense_id       INTEGER     REFERENCES expenses(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_approvals_status ON expense_approvals(status);

-- --- Recurring expenses (periodic costs that generate their expense row) -----
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id                SERIAL PRIMARY KEY,
  description       TEXT    NOT NULL,
  category          VARCHAR(30) NOT NULL
                      CHECK (category IN ('WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE',
                                          'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER')),
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method    VARCHAR(20) NOT NULL DEFAULT 'CASH'
                      CHECK (payment_method IN ('CASH', 'M_PESA', 'BANK', 'OTHER')),
  frequency         VARCHAR(10) NOT NULL
                      CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'YEARLY')),
  next_due_date     DATE    NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  last_generated_at TIMESTAMPTZ,
  last_expense_id   INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_expenses(active, next_due_date);
