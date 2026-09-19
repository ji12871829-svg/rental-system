# Runbook — splitting the staff and portal JWT signing secrets

**When you need this:** the 2026-09-19 security assessment fixed the
tenant→staff token confusion (finding F1) by pinning JWT audiences. The
deeper hardening is giving each token population its **own signing key**, so
even a lost audience check could never let one side's tokens pass the other's
verifier. The code now supports `JWT_STAFF_SECRET` and `JWT_PORTAL_SECRET`;
until they are set, both fall back to `JWT_SECRET` and production logs a
startup warning.

**Prerequisite:** the security-fix deploy is live (it contains the
key-split code). The steps below only supply configuration — no further
deploy needed after setting the variables.

---

## Compatibility model (why this is zero-downtime)

`backend/src/config/env.ts` resolves:

| Env var | Falls back to | Used by |
|---|---|---|
| `JWT_STAFF_SECRET` | `JWT_SECRET` | staff login/refresh signing, `requireAuth` verification |
| `JWT_PORTAL_SECRET` | `JWT_SECRET` | portal login/refresh signing, `requireTenant` verification |

While unset, both populations sign **and** verify with `JWT_SECRET` — exactly
today's behavior, with the audience claim still enforced. That property makes
the rollout order-free: set the variables whenever, and the moment each
secret becomes distinct, all old tokens of the *other* population simply stop
verifying on that side (which is the point).

## Step 1 — Generate two distinct secrets

```bash
openssl rand -hex 32   # → JWT_STAFF_SECRET
openssl rand -hex 32   # → JWT_PORTAL_SECRET
```

They must differ from each other and from `JWT_SECRET`. If you generate them
in the same terminal history, don't reuse the command output twice.

## Step 2 — Set both on Render (one deploy)

Render dashboard → **rpms** web service → **Environment**:

- `JWT_STAFF_SECRET` = `<staff hex>`
- `JWT_PORTAL_SECRET` = `<portal hex>`

**Save changes** (one redeploy). Verify in the boot log that the warning

```
[config] JWT_STAFF_SECRET / JWT_PORTAL_SECRET are not both set — staff and portal tokens share one signing key. …
```

is **gone**, and the two long-standing warnings are **not** present:
`JWT_SECRET`-set check and the 32-character check are both satisfied because
each split secret is ≥ 32 chars.

## Step 3 — Accept the one-time re-login

The moment the deploy with distinct secrets goes healthy:

- **Every staff session token stops verifying** (signed with `JWT_SECRET`,
  verified against `JWT_STAFF_SECRET`) → staff get `401` and the app sends
  them to the login page. Sign in again — done.
- **Every portal session stops verifying** → tenants re-enter their portal
  credentials on the login page.

Plan it like any session-invalidating change: pick a quiet moment; the
re-login friction is the entire cost, and it also silently invalidates any
token copies that might be circulating outside the browser.

Keep `JWT_SECRET` set on Render: it still serves as the documented fallback
base and is validated for length. (If you later want to retire it entirely,
remove the fallbacks in `env.ts` in a follow-up — not part of this runbook.)

## Step 4 — Verify

```bash
B=https://rpms-gakt.onrender.com

# Health must stay green after the deploy
curl -s -o /dev/null -w "health: %{http_code} (want 200)\n" "$B/api/health"

# Unauthenticated staff surface must still refuse
curl -s -o /dev/null -w "users unauth: %{http_code} (want 401)\n" "$B/api/users"

# Browser check: log into the staff app, then the portal — both must work,
# and each must remain logged in across refreshes (keepalive renews with the
# new keys).
```

Regression coverage in the repo (no action needed): the integration suite
runs with **distinct** test secrets and proves cross-population tokens are
rejected by key **and** audience — see
`backend/tests/integration/audienceBoundary.test.ts`.

## Operational notes

- **Rotation:** rotating any one secret is now independent per population —
  set the new value, deploy, that side's users re-login once; the other side
  is untouched. This is the main operational payoff of the split.
- **Never** set `JWT_STAFF_SECRET` equal to `JWT_PORTAL_SECRET` — that
  restores the shared-key situation while hiding the warning (the warning
  only fires when a variable is *unset*).
- **Local dev:** nothing to do — fallbacks keep dev working with
  `JWT_SECRET`; the warning never prints outside production.
- Related reading: `docs/RUNBOOK-mpesa-callback-gate.md` (finding F2's
  activation) and `docs/SECURITY-ASSESSMENT-2026-09-19.md` (full context).
