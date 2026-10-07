# Runbook — deploy-gap checks (repo → live parity without Render or DB access)

**When you need this:** you merged/pushed to `main` and want to verify what
Render actually serves, or you suspect a deploy shipped only part of the code
(e.g. old frontend bundle, missing backend route module). Everything here
reads public HTTP responses — no Render dashboard, no API token, no DB
credentials.

**Why this runbook exists:** on 2026-10-07 a deploy-gap check produced a
false positive. Probing `/api/reports/notification-stuck` returned
`401 UNAUTHORIZED` on the *old* build, which looked like the
`notificationStuck` route was live. It was not: `backend/src/routes/reports.ts`
opens with `router.use(requireAuth)`, so **every** path under `/api/reports/*`
— including never-registered ones — answers 401 before routing can 404.
A bogus probe (`/api/reports/bogus-probe-xyz`) returned the identical 401.
The rule: **a 401 under a router-level auth gate proves the router is
mounted, never that a specific subroute exists.**

Techniques 1–3 are scripted: `node scripts/audit-deploy-drift.mjs [baseUrl]`
prints missing files with reasons and exits 1 on definite drift.

---

## Technique 1 — read `/api/health` first (authoritative)

`/api/health` is anonymous and reports two deploy-gap fields (added after the
false positive above):

- `commit` — the exact revision Render deployed. Render injects
  `RENDER_GIT_COMMIT` at runtime; it is `null` outside Render (local dev,
  tests). Compare it with `git rev-parse origin/main` — equal means the
  deployed build is the current tip; anything else quantifies the gap.
- `apiModules` — `[{ "prefix": "...", "name": "..." }, ...]`, one entry per
  route module mounted in the **running build**, recorded at mount time by
  `mountApi()` in `backend/src/app.ts`. The deploy-gap test for a module is
  simply "is the name in `apiModules`?" — no inference, no ambiguity.

The **name**, not the prefix, is the module identity: two routers can share
one prefix (`/api/reports` mounts both `reports` and `notificationStuck`;
`/api/public` mounts `public` and `vacanciesPublic`). A prefix-only report
cannot distinguish them — that is exactly the shape of the original false
positive.

`db: "ok"` plus `frontendDistPresent: true` confirm the boot and static build
succeeded.

*Disclosure tradeoff (reviewed 2026-10-07, before the fields shipped; no env
gate — deliberate):* the repo is PUBLIC
(github.com/ji12871829-svg/rental-system, verified via the GitHub API), so
`commit` lets anyone resolve the exact deployed source. That was accepted:

- Any commit identifier leaks the same thing on a public repo (short SHA,
  tag — all resolve), and the pin was already inferable from outside with
  zero new fields: bundle-hash fingerprinting plus the rebuild technique in
  Technique 4 pinned 23e3431 without the health field. The gate adds
  attacker friction of one resolution step while blinding every defender.
- `apiModules` is route names/prefixes only — no parameter routes, no
  handler detail — and the same map is enumerable via the Technique 2
  probes (the audit script's fallback mode does exactly that; it confirmed
  15/31 modules from outside without credentials). Twin-mount identities
  (`reports` vs `notificationStuck` behind one prefix) are the only thing
  probes cannot recover, and that is code organization, not attack surface.
- The consumers — Render health checks, CI verify-live, the one-GET audit —
  are unauthenticated by design. A default-off flag would disable
  authoritative deploy-gap checks in exactly the environment (production)
  where drift matters; a default-on flag is a lever nobody pulls.
- The most attack-relevant disclosures in this payload predate these fields:
  the config booleans (`mpesaCallbackTokenSet`, `jwtSecretSet`) tell the
  outside world which protections are unconfigured. Accepted earlier;
  unchanged by this work.

If the posture changes later: gate BOTH fields behind one env flag and
accept the documented fallback — Technique 2 probes prove module presence,
Technique 4 rebuild-pin recovers the exact revision.

## Technique 2 — route probing (fallback for builds without the health fields)

For a deployed build that predates the `commit`/`apiModules` health fields:

- Unknown top-level `/api/*` paths return `404 {"error":"NOT_FOUND"}`.
- A path that reaches a mounted router returns `401` (auth gate) or the
  handler's response.
- **Probes prove presence, never absence.** Any non-404 at the prefix
  (200/3xx/401) means a router is mounted. A 404 is **ambiguous** in BOTH
  directions of the original rule: an unmounted prefix and a mounted
  authless router with no GET route at the prefix return the identical 404
  — e.g. `GET /api/auth` 404s on every known-good build even though the
  auth router (login!) is live. Before the `apiModules` field existed, the
  7 feature-route 404s were treated as proof of absence; the git diff
  confirmed they *were* missing, but the probe alone could not prove it.
  Absence is provable only via `/api/health apiModules`.

Always pair the target probe with **two controls**:

1. a bogus path under the **same prefix** (`/api/reports/bogus-probe-xyz`) —
   if it also 401s, that prefix has a router-level auth gate and 401 proves
   nothing about subroutes;
2. a bogus **top-level** path (`/api/bogus-top-level-xyz`) — sanity-checks
   that unknown paths really 404 on this build.

```bash
BASE=https://rpms-gakt.onrender.com
for p in /api/vacancies /api/reports/notification-stuck \
         /api/reports/bogus-probe-xyz /api/bogus-top-level-xyz; do
  printf '%-40s %s\n' "$p" "$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$BASE$p")"
done
```

## Technique 3 — frontend chunk inventory

`frontend/src/lib/routeChunks.ts` is the single source of truth for the
lazy-loaded route chunks.

1. Fetch `/` and take the `assets/index-*.js` URL from it.
2. Download that bundle and extract every `[A-Za-z]+-[A-Za-z0-9_-]{8}\.js`
   chunk filename it references (Vite embeds the full chunk map).
3. The live page set = `routeChunks.ts` at the deployed commit. A new page
   (e.g. `Vacancies`) absent from both the inventory and the bundle means the
   frontend predates the feature.

Marker greps for feature-specific strings (e.g. `ERRONEOUS`,
`UserInBlacklist` in the right *chunk*, not just the main bundle) bracket the
deployed commit when the inventory alone is not decisive. Remember the app is
code-split: a page's strings live in its own chunk, not in `index-*.js`.

## Technique 4 — pin the deployed commit by local rebuild

The chunk inventory narrows the page set; to pin the exact commit, rebuild
the frontend from the candidate commit and hash-compare against live:

1. `git worktree add ../pin-wt --detach <candidate-sha>` (see
   docs/worktrees.md — worktrees, never clones).
2. Run the Render build sequence: `NODE_ENV=production npm run build
   --prefix shared`, then `cd frontend && npm ci --include=dev && npm run
   build`. Note `shared` needs its own `npm ci --prefix shared --include=dev`
   on a machine where `tsc` is not already resolvable.
3. Compare every `dist/assets/*` byte-for-byte against
   `https://<live>/assets/<name>`.

Gotcha: `frontend/vite.config.ts` injects `src/lib/branding.ts`'s **mtime**
as the legal pages' "Last updated" timestamp, so two builds of identical
source hash differently, and the difference cascades through every chunk
that embeds the main-bundle filename. Diff a page chunk first: if the only
differences are embedded `assets/*.js` filenames plus one ISO timestamp,
set the mtime to that value (`fs.utimesSync('src/lib/branding.ts', t, t)`),
rebuild, and expect a 100% byte match. For the 2026-10-07 audit this
reproduced all 49 live assets byte-for-byte from `23e3431`.

Caveat: if `frontend/` and `shared/` are unchanged across a range of
candidate commits, the hashes pin the *content*, not the individual commit —
narrow further with backend evidence (e.g. `/api/health` field changes) and
deploy mechanics (Render builds the branch tip).

## Migrations

`applyMigrations` runs at boot (`backend/src/index.ts`); a failed migration
aborts boot, fails the `/api/health` check, and Render keeps the previous
build. Therefore **"new backend live + `db: ok`" implies the migrations
shipped with it applied**. Direct schema inspection needs DB credentials;
this indirect chain is the documented method.

## Worked example — the 2026-10-07 deploy gap

| Probe | Result | Conclusion |
| --- | --- | --- |
| 7 feature-only routes (`/api/vacancies`, `/api/vendors`, …) | 404 | consistent with not deployed — confirmed by the git diff, not by the probe (see Technique 2) |
| `/api/reports/notification-stuck` | 401 | **false positive** — router gate, not liveness |
| `/api/reports/bogus-probe-xyz` | 401 | confirmed the gate masks 404s |
| Live chunk inventory vs `routeChunks.ts` | old page set only | frontend predates the branch |
| Verdict | | live = `origin/main` @ `23e3431` — proven by Technique 4 (49/49 assets byte-identical, build timestamp 2026-10-06T19:31:24.511Z); fix = merge PR + one manual Redeploy (autoDeploy was `false` on main) |

With the new health fields, the same check is one request: does
`commit == git rev-parse origin/main`, and is every expected name in
`apiModules`?

---

## autoDeploy posture (reviewed 2026-10-07)

`autoDeploy: true` is safe on `main` because every push self-reports the 8
checks: `ci.yml` triggers on `push` with no branch/path filters (plus PRs and
the weekly sweep), every job's only `if` is the schedule guard, job names
match the required-check list in `render.yaml` exactly, there is no
`concurrency:` cancellation ambiguity, and `render-build` executes the real
`buildCommand` parsed out of `render.yaml`. The orphan scenario that
motivated disabling auto-deploy in 24d65bc (pushes bypassing the checks)
required the bypasses below.

Residual bypass paths, ranked:

1. **`[skip ci]`-family tokens in a commit message** pushed to `main` —
   GitHub skips the whole workflow, so the commit carries ZERO status checks
   and Render's wait-for-CI is a no-op (nothing to wait for): untested code
   deploys, and a failed boot leaves the old build live = the silent gap.
   No repo config can force a check onto a commit Actions never ran for.
   Mitigations: never use the tokens on this repo (verified: never used so
   far), a local husky `commit-msg` hook that rejects them, and the health
   `commit` field so any drift is detectable after the fact.
2. **GitHub-side settings the repo cannot pin** — required-status-check
   enforcement lives in branch protection (include administrators) and
   Render's "Auto-Deploy & Wait for CI" lives in the dashboard; the blueprint
   can only set `autoDeploy`. Verify both once after merging. Without them a
   direct push still runs CI and a red check still aborts the deploy — but
   visibly, not silently.
3. **verify-live is not a post-deploy gate** — it probes whatever service is
   CURRENTLY live, and Render deploys the new commit only after all 8 checks
   pass. On a push to `main` it therefore green-lights the previous deploy,
   not the new one. Treat it as a public-surface regression check; the
   health `commit`/`apiModules` fields are the actual drift detector.
4. **Node drift** — CI runs `node-version: 26` (latest 26.x) while Render is
   pinned to `26.3.0`; `render-build` mirrors the command but not the exact
   minor. Theoretical green-on-CI / fail-on-Render. Fix: pin `26.3.0` in
   `ci.yml` too.
5. **Advisory-driven red on an already-deployed tip** — the weekly
   secrets-scan/dependency-audit can fail the current `main` tip after it
   deployed (new advisory published). This does not orphan anything (Render
   never reacts to check changes, only pushes), but it will block a manual
   "Redeploy this commit" of that tip. Expected; assess the advisory, then
   push the fix.
6. **Action pinning** — `actions/checkout@v4` and `actions/setup-node@v4`
   are tag-pinned, not SHA-pinned (gitleaks is, by sha256). A compromised
   action could forge passing statuses. Hardening option: pin by SHA.

`keep-warm.yml` only pings `/api/health` (cron + manual dispatch) — it can
neither deploy nor gate a deploy, and it is deliberately not one of the 8
checks so its alarm cannot jam wait-for-CI on a push.
