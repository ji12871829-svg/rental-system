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

## 3. Map staff users to Clerk accounts

The bridge trusts nothing on its own: a Clerk session maps to a local user
only through the `user_external_ids` table (unique on `('clerk', external_id)`
and `('clerk', user_id)` — one Clerk identity per staff user, one staff user
per Clerk identity).

**Pre-provision from the Clerk dashboard (the supported path).** In Clerk →
**Users**, create or open each staff member's user, copy their User ID
(`user_…`), then insert the mapping directly (SQL editor in Neon / psql on the
production database):

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

> **A note on self-serve mapping:** an earlier revision of this runbook
> suggested a `map_clerk_user()` trigger function. As written it could not
> work — it created a function but never attached a `CREATE TRIGGER` to any
> table, and the schema has no Clerk-events table for one to fire on. There
> is also no webhook endpoint in the backend. Self-serve mapping by verified
> email would need a Clerk webhook handler (`user.created` → look up the
> local user by email → insert the mapping); until that is built, dashboard
> pre-provisioning above is the only supported path.

Unmapped or INACTIVE users get a generic 401 from the bridge and can still
use the password form — nobody is locked out by a half-migration.

## 4. Verify

- `/login` → Landlord / Manager tab shows the Clerk card (key set) or the
  password form (no key).
- Sign in with a mapped user → lands on the dashboard; `Audit trail` shows a
  normal `LOGIN` row for that user.
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
production instance in Clerk, repeat §2 with the live keys, and re-do §3 in
the production database (dev mappings do not carry over). Keep the test keys'
mappings — they are separate rows keyed by different external ids and do no
harm.
