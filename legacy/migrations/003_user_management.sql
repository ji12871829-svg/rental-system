-- 003_user_management.sql — admin user management (Phase: post-v1 feature).
--
-- password_version: bumped on every password change. JWTs issued before the
-- bump carry the old value and are rejected by requireAuth, so a password
-- reset instantly invalidates every existing session (the stateless-JWT
-- equivalent of "log out everywhere"). Existing rows backfill to 1.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_version INTEGER NOT NULL DEFAULT 1;