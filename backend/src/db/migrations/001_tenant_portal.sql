-- Tenant portal access — self-service login for tenants.
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
