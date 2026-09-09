# HARD-QUESTIONS.md
## Edge-case review pass — questions asked against every planning doc, with resolutions

This file exists because a spec is never done after the first draft. Each question below was asked deliberately against PRD.md, ARCHITECTURE.md, and APP-FLOW.md to find gaps before code gets written. Where a resolution changes a rule stated elsewhere, that source doc has been updated to match — this file is the paper trail for *why*.

---

### Q1. What happens to an in-flight maintenance request when the tenant moves out mid-request?
**Resolution:** Maintenance requests belong to the **unit**, not the lease or tenant — `tenant_id` is nullable with `ON DELETE SET NULL`. Terminating a lease does not touch open maintenance requests; they stay open against the unit regardless of who's currently leasing it. The UI should still display the historical tenant name (frozen at time of request) even after that tenant is archived.
**Doc updated:** none needed — schema already supports this correctly.

### Q2. Should a terminated lease block new payments against it, or just flag them?
**Resolution:** **Block.** A `status='terminated'` lease cannot accept new payments — return `409 { error: "LEASE_TERMINATED" }`. An `'expired'` or `'active'` lease **can** accept a payment regardless of the payment's date (managers need to record late/back-dated rent), so no date restriction is applied there.
**Doc updated:** `ARCHITECTURE-ESSENTIALS.md` rule 3 — expanded to state this explicitly.

### Q3. Is rent due calculated monthly or does it accrue daily?
**Resolution:** **Monthly, whole cycles only.** `balanceDue = (cyclesElapsed × monthlyRent) − SUM(payments.amount)`, where `cyclesElapsed` is the count of calendar months from `start_date` through `LEAST(CURRENT_DATE, end_date)`, inclusive of the starting month. This must be implemented as a named utility function (`utils/calculateCyclesElapsed.js`), not inlined, because it's the second-most-likely place someone "simplifies" incorrectly (see AGENTS.md §4).
**Doc updated:** `ARCHITECTURE-ESSENTIALS.md` rule 3; `IMPLEMENTATION-PLAN.md` Phase 4 now names this function explicitly.

### Q4. Can two managers accidentally double-submit the same payment?
**Resolution:** Soft protection, not a hard block: reject a payment matching an identical `(lease_id, amount, payment_date, reference_number)` recorded within the last 60 seconds, returning `409 { error: "DUPLICATE_PAYMENT" }`. This is a should-have hardening item for Phase 4, not a Phase 4 exit-criteria blocker.
**Doc updated:** `IMPLEMENTATION-PLAN.md` Phase 4, added as a stretch item.

### Q5. Can a unit be deleted if it was never leased?
**Resolution:** Yes. `DELETE /units/:id` succeeds only when zero rows exist in `leases` or `maintenance_requests` referencing it (the DB's `ON DELETE RESTRICT` already guarantees this — the controller's job is just to catch that DB error and translate it into a friendly `409` rather than a raw Postgres error).
**Doc updated:** none needed — clarifies existing behavior, no rule change.

### Q6. Does the system auto-expire a lease the day after `end_date`, or is that manual?
**Resolution:** **Manual in v1.** There is no scheduled job/cron. `status` only changes via an explicit `PATCH`. The Dashboard's "Upcoming Lease Expirations" (next 60 days) is the human-facing nudge that prompts the manager to terminate/expire a lease themselves. An automatic date-based transition is an explicit **v2 candidate**, not a v1 gap.
**Doc updated:** `ARCHITECTURE-ESSENTIALS.md` — added as an explicit non-feature so no agent "helpfully" builds a cron job that wasn't asked for.

### Q7. Can a tenant be archived while they still have an active lease?
**Resolution:** **No — this was an actual gap.** The original spec only blocked *hard-delete* of a tenant with an active lease, but said nothing about *archiving* one. Archiving implies "this tenant is done with us," which contradicts an active lease. **New rule:** `PATCH /tenants/:id/archive` must also return `409 { error: "ARCHIVE_BLOCKED_ACTIVE_LEASE" }` if the tenant has any lease with `status='active'`.
**Doc updated:** `ARCHITECTURE-ESSENTIALS.md` rule 4 — expanded to cover archiving, not just hard-delete. This is the most important fix in this pass.

### Q8. What about a maintenance request for a currently-vacant unit (no tenant on file)?
**Resolution:** Already supported — `unit_id` is required, `tenant_id` is nullable. A manager can log "noticed a leak during a walkthrough" against an empty unit with no tenant attached.
**Doc updated:** none needed.

### Q9. On repeated failed logins, do we lock the account or just rate-limit the IP?
**Resolution:** **IP-based rate limiting only — never lock the account itself.** Account-level lockout on failed attempts creates a denial-of-service vector: an attacker can lock out the legitimate admin on purpose just by failing their password repeatedly. Stick to `express-rate-limit` on the IP/endpoint as specified in TRD.md.
**Doc updated:** none needed — confirms existing TRD.md decision, closes off a tempting "improvement" an agent might add unprompted.

### Q10. What happens if someone exports payments CSV over a very large, unfiltered date range?
**Resolution:** Cap CSV export at 5,000 rows; if the filtered result would exceed that, return the first 5,000 and include a response header (`X-Export-Truncated: true`) so the frontend can warn the user to narrow their filter. Should-have hardening, not a Phase 4 blocker.
**Doc updated:** `IMPLEMENTATION-PLAN.md` Phase 4, added as a stretch item alongside Q4's resolution.

---

## Summary of Rule Changes Applied Elsewhere

| # | Change | Where |
|---|---|---|
| Q2 | Terminated leases reject new payments | ARCHITECTURE-ESSENTIALS.md rule 3 |
| Q3 | Balance-due formula pinned down precisely | ARCHITECTURE-ESSENTIALS.md rule 3, IMPLEMENTATION-PLAN.md Phase 4 |
| Q4 | Duplicate-payment soft guard | IMPLEMENTATION-PLAN.md Phase 4 (stretch) |
| Q6 | No auto-expiry cron in v1 — explicit non-feature | ARCHITECTURE-ESSENTIALS.md |
| Q7 | Archiving blocked by an active lease (new rule — was a real gap) | ARCHITECTURE-ESSENTIALS.md rule 4 |
| Q10 | CSV export row cap | IMPLEMENTATION-PLAN.md Phase 4 (stretch) |
