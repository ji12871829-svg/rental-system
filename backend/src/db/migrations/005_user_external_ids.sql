-- 005_user_external_ids.sql — map local users to external identity
-- providers (currently Clerk).
--
-- The staff app's authorization model stays entirely local: users.role and
-- users.status decide what a session may do. This table only answers "which
-- local user does this Clerk session belong to", so Clerk sign-in can ride
-- the existing requireAuth pipeline (see middleware/clerkAuth.ts). One row
-- per provider per user; deleting it instantly unlinks the external login.
CREATE TABLE IF NOT EXISTS user_external_ids (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     VARCHAR(40) NOT NULL,
  external_id  VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_id),
  UNIQUE (user_id, provider)
);
