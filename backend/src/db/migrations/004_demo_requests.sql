-- 004_demo_requests.sql — public "Request a demo" submissions from the
-- landing page.
--
-- The form is open to the whole internet, so the table is deliberately
-- boring: contact fields, an optional property-size selector, free-text
-- notes, and the standard lifecycle columns. It stores NO secrets — a demo
-- request confers nothing; an operator reads it and reaches out.
CREATE TABLE IF NOT EXISTS demo_requests (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  phone        VARCHAR(30),
  property_name  VARCHAR(200),
  units_count  VARCHAR(30),
  message      TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'NEW'
                 CHECK (status IN ('NEW', 'CONTACTED', 'CLOSED')),
  ip_address   VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demo_requests_status     ON demo_requests(status);
CREATE INDEX IF NOT EXISTS idx_demo_requests_created_at ON demo_requests(created_at);
