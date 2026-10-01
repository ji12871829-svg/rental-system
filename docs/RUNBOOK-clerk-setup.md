# Runbook — turning on Clerk staff sign-in

**When you need this:** the Clerk integration ships **dormant** — every piece
is inert until Clerk keys exist, and the password form on `/login` remains the
only door. These steps switch it on (and back off, instantly).

**How it works (the 60-second version):**

- The **Landlord / Manager** tab of `/login` renders Clerk's hosted sign-in
  card *only* when `VITE_CLERK_PUBLISHABLE_KEY` is present in the frontend
  build; otherwise it keeps the password form.
- When `CLERK_SECRET_KEY` is set on the backend, two things activate:
  `clerkMiddleware()` + `clerkAuth` in `app.ts` (maps a verified Clerk session
  to a local user and stamps `req.user`), and `POST /api/auth/clerk/session`
  (exchanges the Clerk session for the app's standard staff JWT cookie).
- Authorization never moves: `users.role` + `users.status` in this database
  decide everything, exactly as before. Clerk only proves identity.
- The tenant portal is **untouched** — it keeps its own cookie, secret, and
  password flow regardless of Clerk.

---

## 1. Create the Clerk application

1. Sign up at <https://dashboard.clerk.com> and **Create application**.
2. Choose whatever sign-in methods you want (email/password is the closest
   match to today's behavior; Google etc. are optional extras).
3. From **API keys** copy:
   - `pk_test_…` → the **publishable** key (frontend)
   - `sk_test_…` → the **secret** key (backend)

## 2. Set the keys

- Local dev: `frontend/.env` → `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…`,
  `backend/.env` → `CLERK_SECRET_KEY=sk_test_…`
- Render: add the same two variables in the dashboard —
  `VITE_CLERK_PUBLISHABLE_KEY` on the **frontend** service,
  `CLERK_SECRET_KEY` on the **backend** service (if one service serves both,
  both variables go on it), then **Manual deploy → Deploy latest commit** so
  the frontend rebuild picks up the new Vite variable.
- Optional, for automatic staff mapping (§3 option A): add
  `CLERK_WEBHOOK_SIGNING_SECRET=whsec_…` next to `CLERK_SECRET_KEY` — the
  value comes from the webhook you register in step §3.A.2.
- **Set `CLERK_PUBLISHABLE_KEY=pk_…` on the same service that serves the
  API whenever `CLERK_SECRET_KEY` is set there.** The backend mounts
  `clerkMiddleware()` the moment it sees a secret key, and that middleware
  hard-fails every request (500) without a publishable key to parse against
  — on a single-service deploy (API + frontend in one), that takes the
  whole app down until the publishable key is added.

## 3. Map staff users to Clerk accounts

The bridge trusts nothing on its own: a Clerk session maps to a local user
only through the `user_external_ids` table (unique on `('clerk', external_id)`
and `('clerk', user_id)` — one Clerk identity per staff user, one staff user
per Clerk identity).

There are two supported paths: the **webhook auto-mapping (A)** does it for
any new sign-up whose verified email matches an existing ACTIVE staff user;
the **dashboard pre-provisioning (B)** is the manual fallback — use it to map
accounts whose Clerk email does not match the local email, or if the webhook
is not configured.

### A. Automatic: the Clerk webhook (recommended)

When `CLERK_WEBHOOK_SIGNING_SECRET` is set, `POST /api/webhooks/clerk`
verifies Clerk's svix-signed `user.created` / `user.updated` events and maps
them automatically: the Clerk account's **primary verified email** is matched
case-insensitively against an **existing ACTIVE staff user** (roles ADMIN,
PROPERTY_MANAGER, STAFF). Nothing is ever created locally — an unknown or
INACTIVE email simply doesn't link, and unverified emails can never link.
Replays are idempotent, so Clerk retries are harmless.

1. In Clerk → **Webhooks** → **Add endpoint**, set the URL to
   `https://<backend-host>/api/webhooks/clerk` and subscribe to
   **user.created**, **user.updated** and **user.deleted** (a deleted Clerk
   account's mapping is removed automatically, with a `CLERK_UNLINKED` audit
   row — the local user keeps their password sign-in, and the unlink shows
   in their audit history).
2. Copy the endpoint's **Signing secret** (`whsec_…`) and set it as
   `CLERK_WEBHOOK_SIGNING_SECRET` on the backend (§2), then redeploy.
3. Use **Send test** in the Clerk dashboard; the endpoint replies 200/201 and
   the mapping row appears in `user_external_ids`.
4. Or smoke-test from a terminal without the dashboard:

   ```bash
   # Safe gate check on any deployment (no secret, changes nothing):
   npm run smoke:clerk-webhook --prefix backend -- --url https://<host>

   # Full probe — signs real events, auto-maps a real admin, cleans up:
   npm run smoke:clerk-webhook --prefix backend -- \
     --url https://<host> --secret whsec_... --yes \
     --database-url "$DATABASE_URL"
   ```

   Exit 0 = the endpoint rejects unsigned bodies, maps nothing for
   unverified/unknown emails, auto-maps a verified staff email, and leaves
   no mapping row behind.

Without the signing secret the endpoint 401s every call (fails closed) and
mapping stays manual — exactly the behavior before this option existed.

Every mapping decision lands in the **Audit trail** (`CLERK_LINKED` rows
attributed to the linked staff user; `CLERK_LINK_REFUSED` rows shown as
system, with the reason — e.g. an email that matches no ACTIVE staff user).
Replays and ignored events are not logged, so Clerk retries stay invisible.
Unlinks are traceable too: deleting the Clerk account writes `CLERK_UNLINKED`
attributed to the affected user, and deleting the **staff** user writes
`CLERK_UNLINKED` (`event: account_deleted`) attributed to the acting admin,
since the cascade would otherwise remove the mapping silently.

Refused sign-ups also surface on the **Clerk Sign-ups** admin page
(`/clerk-signups`): one row per refused Clerk identity with the claimed
email, reason and attempt count, and a **Link to staff user…** action that
creates the mapping the webhook could not (typo'd/renamed email, or a role
outside the auto-link set) — no SQL needed. Rows move to the "since linked"
section once mapped.

### B. Manual: pre-provision from the Clerk dashboard (fallback)

In Clerk → **Users**, create or open each staff member's user, copy their
User ID (`user_…`), then insert the mapping directly (SQL editor in Neon /
psql on the production database):

```sql
INSERT INTO user_external_ids (user_id, provider, external_id)
VALUES (<users.id>, 'clerk', 'user_…')
ON CONFLICT DO NOTHING;
```

Tips: `SELECT id, email FROM users WHERE status = 'ACTIVE' ORDER BY id;` lists
the local users to map, and one `INSERT … SELECT` per row (or a `VALUES` list)
can map the whole team at once. Mapping rows can be added any time — a staff
member who signs in before their row exists simply gets the password form
until you add it.

> **A note on history:** an earlier revision of this runbook suggested a
> `map_clerk_user()` trigger function. As written it could not work — it
> created a function but never attached a `CREATE TRIGGER` to any table, and
> the schema has no Clerk-events table for one to fire on. It was removed;
> webhook auto-mapping (§3.A) is the self-serve path it was reaching for.

Unmapped or INACTIVE users get a generic 401 from the bridge and can still
use the password form — nobody is locked out by a half-migration.

## 4. Verify

- `/login` → Landlord / Manager tab shows the Clerk card (key set) or the
  password form (no key).
- Sign in with a mapped user → lands on the dashboard; `Audit trail` shows a
  normal `LOGIN` row for that user.
- If §3.A is configured: a brand-new Clerk sign-up whose verified email
  equals an ACTIVE staff user's email maps on first sign-in attempt (the
  webhook beats the sign-in; the `user_external_ids` row already exists).
- Sign in with an unmapped Clerk user → generic error + "Use password
  sign-in instead" fallback.
- Tenant tab → unchanged password flow, lands on `/portal`.
- `curl -s https://<host>/api/health` → `"status":"ok"`.

## 5. Roll back (instant, no deploy)

Remove `CLERK_SECRET_KEY` (and optionally `VITE_CLERK_PUBLISHABLE_KEY`) from
the Render environment and redeploy. `clerkAuth` and the bridge 401 again,
`clerkMiddleware()` stops mounting, the staff tab reverts to the password
form. Existing staff JWT sessions keep working — nobody is logged out.

Mapping rows in `user_external_ids` can stay — they are inert while Clerk is
disabled and reactivate unchanged if you enable it again later.

## 6. Going live (production keys)

When moving from `pk_test_/sk_test_` to `pk_live_/sk_live_`: create the
production instance in Clerk, repeat §2 with the live keys, re-register the
webhook endpoint (§3.A — dev/test endpoints and their signing secrets do not
carry over), and re-do §3.B in the production database for any account the
webhook will not match (dev mappings do not carry over). Keep the test keys'
mappings — they are separate rows keyed by different external ids and do no
harm.
