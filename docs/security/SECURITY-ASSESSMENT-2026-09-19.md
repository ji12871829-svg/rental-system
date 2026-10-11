# Security Assessment — RPMS (Rental Property Management System)

**Date:** 2026-09-19
**Scope:** full repository (white-box) + live deployment `rpms-gakt.onrender.com` (black-box, non-destructive probes only)
**Method:** manual code review of all 18 route modules, middleware, and services; proof-of-concept reproduction in the seeded test environment; full regression-suite verification; safe probing of the live deployment.

---

## Executive Summary

The application is a React (Vite) SPA backed by an Express/PostgreSQL API, with a staff app and a tenant portal sharing one deployment. The security foundations are better than typical for a small codebase: parameterized SQL throughout, zod validation on every mutating route, a coherent CSRF design, role middleware applied at the router level, honest error handling, and a real CI pipeline.

Against that baseline, the assessment confirmed **one critical authentication flaw, three high-severity flaws, and several medium/lower issues** — and fixed them in this pass, each with a regression test:

1. **[F1 — CRITICAL] A tenant-portal token could authenticate as any staff user.** Staff JWTs carried no audience claim and staff verification did not pin one, while portal tokens are signed with the *same secret*. Since user ids and tenant ids collide (both start at 1), a tenant logging into the low-privilege portal could hit every staff API — including admin routes — as `users.id = tenant_id`. The `/refresh` grace path even minted a genuine 8-hour staff session carrying the real role of the colliding user.
2. **[F2 — HIGH] The M-Pesa money-intake endpoints were unauthenticated.** Anyone on the internet could POST a forged Daraja callback (any amount, any unit) and the app would post it into the rent ledger and auto-generate a receipt. Now gated by a timing-safe shared secret (`MPESA_CALLBACK_TOKEN`), business-shortcode validation, and rate limiting.
3. **[F3 — HIGH] The logo upload accepted SVG** — served back with `Content-Type: image/svg+xml` from the app origin, where SVG `<script>` executes: stored XSS on a URL a staff member might open directly. SVG is now rejected and declared content types are verified against magic bytes.
4. **[F4 — HIGH] Every real paybill confirmation would have crashed.** `ON CONFLICT (transaction_id)` targeted a *partial* unique index without restating its predicate, so Postgres rejects the insert ("no unique or exclusion constraint matching the ON CONFLICT specification"). Confirmed by test; fixed and proven end-to-end.

**Posture after fixes:** with `MPESA_CALLBACK_TOKEN` configured on the live service (one env var + one URL edit in the Daraja portal), the critical and high-risk issues are closed. Remaining items are hardening recommendations, not open doors.

---

## Architecture (as verified from source)

| Layer | Implementation |
|---|---|
| Frontend | React 19 + Vite SPA, lazy-loaded routes, service worker (PWA), same-origin deploys |
| Backend | Express (TypeScript), 18 route modules under `/api`, helmet, CORS allowlist, CSRF double-submit |
| Auth | Staff: JWT (HttpOnly cookie or Bearer), `aud: staff_api`, 8h lease + 24h refresh grace. Portal: separate JWT (`aud: tenant_portal`), separate cookie, DB-backed access table |
| Database | PostgreSQL, `pg` pool (max 5), fully parameterized access via `query/queryOne/withTransaction` |
| Payments | M-Pesa Daraja (C2B paybill + STK Push), `mpesa_transactions` ledger with dedup by `transaction_id`/`checkout_request_id` |
| Messaging | Brevo/Twilio/Africa's Talking providers (env-selected), self-test endpoints, provider callbacks |
| CI | GitHub Actions: typecheck + backend suite (real Postgres service) + frontend build + Render-parity build + live verification + knip dead-code gate |

## Attack Surface (major components)

- **Unauthenticated:** `/api/health`, `/api/auth/login|refresh|logout`, `/api/portal/login|refresh|logout`, `/api/mpesa/c2b/*`, `/api/mpesa/stk/callback`, `/api/sms/delivery-reports`, `/api/branding` + `/api/branding/logo` (public identity), static SPA.
- **Staff-authenticated:** all `/api/{users,settings,units,tenants,rent,water,expenses,receipts,sms,emails,reports,audit,privacy-requests,mpesa/review}` routes with `adminOnly`/`managerOrAdmin` scoping where appropriate.
- **Portal-authenticated:** `/api/portal/{me,summary,payments,water,receipts,statement.pdf,pay-rent,...}` — every query scoped by the token's `tenant_id`; no client-supplied object ids on portal reads.

---

## Findings

Severity bands: Critical / High / Medium / Low / Informational. All "Fixed" items carry regression tests in `backend/tests/integration/`.

### F1 — Cross-audience JWT confusion: tenant → staff privilege escalation
- **Severity:** Critical · **CWE-287** (Improper Authentication) · **CVSS ≈ 9.1** (AV:N/AC:L/PR:L/UI:N → full admin compromise, integrity+confidentiality high)
- **Status:** **Fixed** (`audienceBoundary.test.ts`, 7 tests)
- **Affected:** `backend/src/middleware/auth.ts`, `backend/src/routes/auth.ts`, `backend/src/middleware/portalAuth.ts`, `backend/src/routes/tenantPortal.ts`
- **Root cause:** Both token populations are signed with one secret, but staff tokens carried no `aud` and `requireAuth`/`/api/auth/refresh` verified without an audience constraint. Portal tokens (`aud: 'tenant_portal'`, `sub = tenant_id`) therefore verified as staff tokens with `sub = users.id`.
- **Attack scenario:** Tenant N logs into the portal (credentials they legitimately hold), copies their `rpms_portal_session` cookie (or replays it via curl), calls `GET /api/users` with it — user N's data is returned and admin writes succeed because user N is ADMIN in every fresh install. `POST /api/auth/refresh` upgrades the borrowed identity into a genuine staff session with the correct role and 8-hour life.
- **Fix:** Named audiences exported from one module (`STAFF_JWT_AUDIENCE = 'staff_api'`, `PORTAL_JWT_AUDIENCE = 'tenant_portal'`); every `jwt.sign` on the staff side stamps `aud: staff_api`; every staff-side verify (including `/refresh` under `ignoreExpiration`) pins `audience: STAFF_JWT_AUDIENCE`; portal side unchanged and symmetrical. Comments mark the boundary as load-bearing.
- **Verification:** 7 regression tests mint portal-style tokens and prove rejection via Bearer header, via staff cookie, on admin routes, and through `/refresh`; control tests prove genuine staff and portal tokens still work and that staff tokens carry `aud: staff_api`.

### F2 — Unauthenticated M-Pesa money-intake endpoints
- **Severity:** High (ledger integrity) · **CWE-306** (Missing Authentication for Critical Function) · **CVSS ≈ 8.2**
- **Status:** **Fixed** (gate) — **ops step required to activate** (see Recommendations); regression tests in `mpesaCallbackGate.test.ts`
- **Affected:** `backend/src/routes/mpesa.ts`; new `MPESA_CALLBACK_TOKEN` in `backend/src/config/env.ts`
- **Root cause:** Daraja callbacks have no authentication and the endpoints accepted any POST. The handler trusts body fields (`TransID`, `TransAmount`, `BillRefNumber`, `TransTime`), matches the reference to an active tenant, posts a rent payment with method M_PESA, and auto-generates a receipt — exactly what a forged request needs.
- **Attack scenario:** `curl -X POST .../api/mpesa/c2b/confirm -d '{"TransID":"FAKE1","TransAmount":"50000","BillRefNumber":"1","TransTime":"20260919120000"}'` credits a tenant's rent and mints a receipt — no money moved.
- **Fix:** (1) Shared-secret gate: Daraja appends `?token=<secret>` to the callback URL (it cannot set headers); verified timing-safe; 404 on mismatch so the endpoint's existence is not confirmed. (2) Business-shortcode validation: a confirmation naming any till other than `MPESA_SHORTCODE` is rejected, so forged bodies must also know the business's till. (3) Router-level rate limit (120/min) to blunt secret brute-force. (4) Production boot warns loudly until the token is set. A hard requirement was deliberately avoided: enforcing boot-failure before the callback URL is re-registered would take rent collection offline.
- **Verification:** token missing/wrong → 404; correct token → pass; foreign shortcode → 400; no token configured → open (documented mock-mode behavior).

### F3 — Stored XSS via SVG logo upload
- **Severity:** High · **CWE-79** (with CWE-434 upload aspect) · **CVSS ≈ 7.1**
- **Status:** **Fixed** (pre-existing tests still pass)
- **Affected:** `backend/src/services/brandingService.ts` (`parseLogoPayload`), served by `GET /api/branding/logo`
- **Root cause:** `svg+xml` was in the accepted `data:image/…` regex; the logo endpoint serves stored bytes with the stored content type on the app origin. SVG can embed `<script>`, which executes on direct navigation (the CSP's `script-src 'self'` does not stop inline SVG script on same-origin documents).
- **Attack scenario:** A (compromised or malicious) manager-or-admin uploads `data:image/svg+xml;base64,…<script>fetch('/api/users',{credentials:'include'})…</script>`; anyone opening `/api/branding/logo` directly executes it with their session. Auth requirement is the mitigating context — hence High, not Critical.
- **Fix:** SVG removed from the accepted list; magic-byte verification (`hasKnownImageMagic`) ensures declared PNG/JPEG/GIF/WebP matches actual bytes, so mislabeled script content can never be stored or served.
- **Verification:** full suite green including existing logo tests; typecheck clean.

### F4 — Paybill confirmations crash on partial-index conflict target
- **Severity:** High (availability/integrity of the payment pipeline) · **CWE-703**
- **Status:** **Fixed and proven end-to-end** (`mpesaCallbackGate.test.ts` "posts a full C2B confirmation")
- **Affected:** `backend/src/services/mpesaService.ts` (C2B insert; STK-push insert)
- **Root cause:** `ON CONFLICT (transaction_id)` cannot use the partial unique index `uq_mpesa_transaction_id … WHERE transaction_id IS NOT NULL` unless the predicate is restated; Postgres raises 42P10. Every real Daraja confirmation would have failed and been retried indefinitely (Daraja retries on non-200), while the integration tests never exercised a full C2B insert.
- **Fix:** `ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING` (same for `checkout_request_id`).
- **Verification:** a full C2B confirmation now posts a rent payment into the test ledger; replaying the same `TransID` is a no-op (dedup works).

### F5 — SMS delivery-report callback is unauthenticated
- **Severity:** Low · **CWE-306** · **Status:** Accepted risk (documented)
- **Affected:** `backend/src/routes/sms.ts` `/delivery-reports`
- **Rationale and note:** The handler only updates `status`/`statusCode` on existing message rows by provider message id — no money, no data exfiltration, no injection (fields are typed and length-bounded by the DB columns). It also always answers 200 by design so the gateway doesn't retry. If abuse is ever observed, the same `?token=` pattern from F2 applies in ~10 lines.

### F6 — `c2b/validate` echoes acceptance unconditionally
- **Severity:** Informational · **Status:** Correct behavior
- Daraja's validation phase expects an instant acceptance response; the confirmation phase is where money moves, and it is now gated (F2). No change needed.

---

## Vulnerability Summary

| ID | Vulnerability | Severity | Status |
|---|---|---|---|
| F1 | Cross-audience JWT confusion (tenant → staff/admin) | Critical | **Fixed + tests** |
| F2 | Unauthenticated M-Pesa callback → forged ledger entries | High | **Fixed + tests** (needs env activation) |
| F3 | Stored XSS via SVG logo upload | High | **Fixed** |
| F4 | `ON CONFLICT` vs partial index — all real paybill callbacks crash | High | **Fixed + tests** |
| F5 | Unauthenticated SMS delivery-report callback | Low | Accepted (documented) |
| F6 | `c2b/validate` unconditional acceptance | Informational | Correct behavior |

## Attack Paths (chains considered)

- **Tenant → admin (pre-fix):** portal credentials (attacker's own) → F1 audience confusion → `users` table write access → full data + role manipulation. Broken at the first hop.
- **Forge → ledger → receipt (pre-fix):** F2 forged callback → `POSTED` transaction + auto-receipt → tenant's arrears show paid. Broken by token gate + shortcode validation.
- **F1 + F3 combined (pre-fix):** tenant-as-admin could upload an SVG logo and poison everyone who opens the logo URL. Both ends now closed.
- No chain was found post-fix that crosses from portal or anonymous to staff privileges.

## Positive Security Controls (verified working)

- Parameterized SQL everywhere; dynamic fragments are module constants or numbered placeholders only.
- Router-level `requireAuth` on every staff module; `adminOnly`/`managerOrAdmin` on sensitive writes; `users.ts` fully admin-gated via `router.use`.
- CSRF: double-submit cookies per session type, timing-safe comparison, principled exemptions (login/refresh/logout/provider callbacks).
- Uniform login errors across staff and portal (no account enumeration); bcrypt cost 12; passwords logged nowhere (audit records metadata only).
- 30s re-validation cache on staff sessions with immediate invalidation on role/status writes; portal rows re-checked per request so revocation is instant.
- Error handler hides stack traces in production; constraint errors mapped to friendly codes; no secret values in logs or `/api/health`.
- Security headers verified live: CSP, HSTS (1y, includeSubDomains), nosniff, frame policy, Referrer-Policy; cookie flags correct (HttpOnly, Secure in prod, SameSite=Lax).
- CI gates every push: typecheck, real-Postgres backend suite, frontend build, Render-parity production build, live-surface verification, knip.
- Zero vulnerabilities in production dependencies (both workspaces, `npm audit --omit=dev`).
- No tracked `.env` files; frontend stores no tokens in web storage; print documents escape all injected values.

## False Positives / Investigated and Cleared

- `users.ts` write routes "without role middleware" — protected by `router.use(requireAuth, adminOnly)`.
- `.gitignore` reverts during the session — cosmetic, no security effect.
- `<mark>`/gradient light-mode rendering — styling only.
- Portal login brute-force — covered by `loginLimiter` (20/15min) shared with staff login.
- SQL injection — every `\${...}` inside SQL is a module constant or a `$n` placeholder; no user input reaches string interpolation.

## Recommendations

**Immediate (before real money flows):**
1. Set `MPESA_CALLBACK_TOKEN` on Render (long random string) and append `?token=<same value>` to both Daraja callback URLs (Confirmation/Validation URL and the STK callback registered per transaction). This activates the F2 gate; the startup warning disappears when it's set.
2. Deploy this branch (F1–F4 fixes) — F1 alone is reason enough.

**Short term:**
3. Consider IP allowlisting Daraja ranges if the provider documents them — defense in depth on top of the token.
4. Add the authed live-verification checks to CI by setting `VERIFY_ADMIN_EMAIL`/`VERIFY_ADMIN_PASSWORD` repo secrets and `VERIFY_SKIP_AUTH=0` (the workflow already supports it).

**Long term:**
5. Split signing keys per token population (`JWT_SECRET_STAFF` / `JWT_SECRET_PORTAL`) so the boundary no longer depends on `aud` alone.
6. Add a row-level regression test that every portal query carries a `tenant_id` predicate (schema-driven check or query lint).
7. Add dependency-audit and secret-scanning jobs to CI (audit is currently manual; the workflow is ready for an `npm audit` gate).

---

## Retest Status

| Fix | Retest |
|---|---|
| F1 | 7/7 regression tests pass; full suite 200/200 |
| F2 | 6/6 gate tests pass (token open/closed paths, shortcode, mock mode) |
| F3 | Existing logo tests pass; magic-byte validation active |
| F4 | End-to-end C2B post + replay-dedup test passes |

All 200 tests across 15 suites pass; `tsc --noEmit` clean for app and tests. Live probes: security headers present, `/api/users` 401 unauthenticated, health OK. No live destructive testing was performed; no real financial transactions were made.
