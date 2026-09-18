# Runbook — add the business-logo columns to a pre-existing database

**When you need this:** the business logo feature (upload in Settings →
rendered in the app header, tenant portal, and on PDF receipts) stores the
image in three columns on `business_branding`. Those columns exist in
`database/schema.sql` for *new* installs, but the first-boot bootstrap
(`backend/src/db/bootstrap.ts`) only applies the schema on an **empty**
database — an install that predates the logo feature keeps running without
them. Every logo read/write then fails with HTTP 500
(`GET /api/branding/logo` → `INTERNAL`), because the queries reference
columns that don't exist yet.

**Symptom:** uploading a logo in Settings fails; the header/portal still show
the monogram fallback; `GET /api/branding/logo` returns 500.

**Fix:** run the three `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements
below once against the production database. They are idempotent — safe to
re-run, they no-op when the columns already exist, and nothing else is
touched.

## The migration

```sql
ALTER TABLE business_branding
  ADD COLUMN IF NOT EXISTS logo_data       TEXT,
  ADD COLUMN IF NOT EXISTS logo_mime_type  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ;
```

Column definitions match `database/schema.sql` exactly (logo block, ~line
457). `logo_data` holds the image as base64 text (≤ 512 KB per the app's
upload guard, ≈ 683 KB as base64); `logo_mime_type` is `image/png`, `image/jpeg`,
`image/gif`, `image/webp` or `image/svg+xml`; `logo_updated_at` stamps uploads
and doubles as the cache-buster version for `/api/branding/logo`.

## Applying it from the Render dashboard

1. Render Dashboard → **your rpms web service** → **Shell** tab (or use the
   **Connect → psql** string from the linked Neon/Postgres instance in a local
   terminal — both reach the same database).
2. In the shell, the service's `DATABASE_URL` env var is already set, so run:

   ```bash
   psql "$DATABASE_URL" -c "
   ALTER TABLE business_branding
     ADD COLUMN IF NOT EXISTS logo_data       TEXT,
     ADD COLUMN IF NOT EXISTS logo_mime_type  VARCHAR(50),
     ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ;"
   ```

   (If `psql` isn't in the runtime image, use the **Connect** button on the
   database instance's dashboard instead — it gives a `psql` command pre-filled
   with the same connection string; paste the ALTER statement at its prompt.)
3. Expect the response `ALTER TABLE`. Re-running it also prints `ALTER TABLE`
   (that's the IF NOT EXISTS no-op — normal).

## Verify

1. `curl -s -o /dev/null -w "%{http_code}\n" https://<your-service>.onrender.com/api/branding/logo`
   → `404` now (route works, no logo uploaded yet) instead of `500`.
2. In the app: **Settings → Business identity → upload logo**. The header tile,
   tenant portal and new PDF receipts should all show it immediately (the
   `/api/branding/logo` response carries `logo_updated_at` as the cache-buster,
   so no redeploy is needed).

## Notes

- No downtime: `ADD COLUMN` without a default is metadata-only in Postgres —
  instant, no table rewrite, safe while the app is running.
- The running service needs no restart after the migration; the next query
  simply finds the columns.
- Fresh installs never need this runbook: the bootstrap applies the full
  `schema.sql` (columns included) to an empty database automatically.
