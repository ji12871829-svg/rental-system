# Runbook — activating the M-Pesa callback gate (`MPESA_CALLBACK_TOKEN`)

**When you need this:** the 2026-09-19 security assessment (finding F2, see
`docs/SECURITY-ASSESSMENT-2026-09-19.md`) found that `/api/mpesa/*` accepted
unauthenticated POSTs — a forged Daraja callback could post a fake rent
payment into the ledger with a real receipt. The fix adds a shared-secret
gate, but it only **enforces** once the token is configured; until then
production logs a startup warning on every boot. These steps switch the gate on.

**Prerequisite:** the security-fix deploy (audience boundary, callback gate,
logo hardening, ON CONFLICT fix) is live. The gate code ships in that deploy;
the steps below only supply its configuration.

---

## How the gate works (30-second version)

- Daraja cannot log in and cannot set custom headers, so the shared secret
  travels in the **callback URL itself**: `https://…/api/mpesa/…?token=<TOKEN>`.
- On every callback POST the server compares the `token` query parameter
  against `MPESA_CALLBACK_TOKEN` **timing-safely**; a mismatch gets a `404`
  (the endpoint's existence is not even confirmed).
- **One env var covers both flows** because the app already sends
  `MPESA_CALLBACK_URL` verbatim as the `CallBackURL` for every STK Push:
  put the token in that env var's value and STK callbacks arrive
  pre-tokenized. The C2B URLs are registered by hand in the Daraja portal,
  so you add the same `?token=` suffix there yourself.
- While the token is unset the endpoints stay open (documented mock-mode
  behavior for dev/test) — that is why the warning exists.

---

## Step 1 — Generate the token

Anywhere you trust: a terminal is fine.

```bash
openssl rand -hex 32
```

or, if OpenSSL isn't handy, in Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You get 64 hex characters. That value is the `<TOKEN>` in every step below.
Treat it like a password: it gates who can write into your rent ledger.

## Step 2 — Set `MPESA_CALLBACK_TOKEN` on Render

1. Render dashboard → **rpms** web service → **Environment**.
2. **Add environment variable:**
   - Key: `MPESA_CALLBACK_TOKEN`
   - Value: `<TOKEN>` from step 1 (just the hex — no `?token=`, no quotes).
3. **Save changes.** Render redeploys the service automatically.
4. Sanity-check the boot log: the warning
   `[config] MPESA_CALLBACK_TOKEN is not set — /api/mpesa/* callbacks accept unauthenticated POSTs…`
   must be **gone**. If it still appears, the variable didn't reach the
   service (check spelling and that it saved to this environment).

## Step 3 — Point Daraja at tokenized callback URLs

### 3a. C2B paybill (Validation + Confirmation URLs)

Safaricom portal → **Daraja / B2C, B2C & C2B APIs → C2B → URL Registration**
(or your paybill's URL management page). Set both URLs to the production
origin **with the token appended**:

```
Validation URL:   https://rpms-gakt.onrender.com/api/mpesa/c2b/validate?token=<TOKEN>
Confirmation URL: https://rpms-gakt.onrender.com/api/mpesa/c2b/confirm?token=<TOKEN>
```

Notes:
- HTTPS with a valid certificate — already true for the Render origin.
- The token rides in the query string; Daraja replays whatever URL it has
  registered verbatim, so type it exactly.
- If Safaricom re-registers your C2B URLs in the future, re-append the
  suffix — registering bare URLs silently reverts the gate to
  "warn-but-open" mode.

### 3b. STK Push callback

This one needs **no portal change**: the app sends `CallBackURL` from the
`MPESA_CALLBACK_URL` env var on every push. Update the env var so future
pushes carry the token:

1. Render → the same service → **Environment**.
2. Edit `MPESA_CALLBACK_URL` to:

```
https://rpms-gakt.onrender.com/api/mpesa/stk/callback?token=<TOKEN>
```

3. Save (triggers another deploy — harmless; the previous one is already
   healthy).

If the current value doesn't end in `?token=…`, every STK Push issued
*before* that change will still call back without a token and be rejected
with 404 — see "Operational notes" below for the transition behavior.

## Step 4 — Verify the gate is enforcing (safe probes)

No real transactions involved; these are read-only HTTP status checks.

```bash
B=https://rpms-gakt.onrender.com
T=<TOKEN>

# 1. No token → must be 404 (previously 200 — this is the gate working)
curl -s -o /dev/null -w "no token:        %{http_code} (want 404)\n" \
  -X POST "$B/api/mpesa/c2b/validate" -H 'Content-Type: application/json' -d '{}'

# 2. Wrong token → must be 404
curl -s -o /dev/null -w "wrong token:     %{http_code} (want 404)\n" \
  -X POST "$B/api/mpesa/c2b/validate?token=deadbeef" -H 'Content-Type: application/json' -d '{}'

# 3. Correct token → must be 200 with ResultCode 0
curl -s -w "\nright token:     HTTP %{http_code} (want 200)\n" \
  -X POST "$B/api/mpesa/c2b/validate?token=$T" -H 'Content-Type: application/json' -d '{}'
```

Then confirm a **real** end-to-end path with money you control: send a small
amount (e.g. KSh 10) over M-Pesa to the paybill with a unit reference, and
check that it still lands as `MATCHED`/`POSTED` in the M-Pesa review screen.
If it doesn't arrive at all (Daraja reports a callback failure), re-check
step 3's URLs character by character — a typo'd token is the only realistic
failure, and Daraja retries make it visible in the service logs as repeated
`404`s on `/api/mpesa/…`.

## Operational notes

- **Rollout overlap:** changing `MPESA_CALLBACK_URL` and the C2B registrations
  is not atomic with the deploy. Between "token set" and "URLs updated",
  genuine callbacks arrive without a token and get 404 — Daraja retries
  them, so once the URLs are correct the retries succeed. Do the URL steps
  immediately after step 2, ideally during a quiet hour.
- **Rotation:** to rotate the secret, set the *new* token on Render first,
  wait for the deploy, then update all registered URLs to the new value;
  update `MPESA_CALLBACK_URL` last. Requests carrying the old token fail
  only in the window between env change and URL change — same retry
  behavior covers it.
- **Local/dev:** leave `MPESA_CALLBACK_TOKEN` unset in development — the
  mock provider and the integration tests rely on the endpoints being open
  there, and the startup warning only prints in production.
- **Security boundary reminder:** the shortcode validation from the same fix
  stays active regardless of the token — a forged confirmation naming a
  different business shortcode is rejected even in mock mode.
