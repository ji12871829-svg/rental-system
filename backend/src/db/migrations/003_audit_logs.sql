-- 003_audit_logs.sql — audit trail table (idempotent for existing installs).
--
-- Every staff-authenticated mutation funnels through logAudit()
-- (services/auditService.ts), which INSERTs here. New installs get the table
-- from database/schema.sql; installs that predate the audit feature keep
-- working because logAudit() swallows failures — this migration back-fills
-- the table so the Users→Activity page and the tenant GDPR data export
-- (which SELECT from audit_logs) work everywhere.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,
  entity      VARCHAR(100) NOT NULL,
  entity_id   INTEGER,
  old_value   JSONB,
  new_value   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user       ON audit_logs(user_id);
