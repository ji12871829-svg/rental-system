# AGENTS.md
## Instructions for any AI coding agent working on this repository

Read this file first, every session, before touching code. If anything here conflicts with a request you're given mid-task, this file wins unless the human explicitly overrides it in that conversation.

---

## 1. Read Order

Before writing any code, read in this order:
1. `docs/ARCHITECTURE-ESSENTIALS.md` — the non-negotiable rules, every session, no exceptions.
2. `docs/IMPLEMENTATION-PLAN.md` — find the current phase, do not skip ahead.
3. The full `docs/ARCHITECTURE.md`, `docs/BACKEND-SCHEMA.md`, or `docs/APP-FLOW.md` **only if** the essentials doc doesn't answer your specific question — don't load full context you don't need.

## 2. Ground Rules

- **Do not invent schema.** If a table/column/endpoint isn't in `ARCHITECTURE-ESSENTIALS.md` or `BACKEND-SCHEMA.md`, don't add it without flagging the gap to the human first.
- **Do not add dependencies** beyond what's listed in `docs/TRD.md §4`. No frameworks, no ORMs, no CSS libraries, no chart libraries. If you believe one is genuinely necessary, stop and ask.
- **SQL only in `models/`.** Never write raw SQL inline in a route or controller file.
- **Parameterized queries only.** Never string-interpolate a value into a SQL string, ever, for any reason, even for "internal" values.
- **Business rules live in the controller, enforced again by the database.** Don't rely on the database constraint alone (the user needs a friendly `409`, not a raw Postgres exclusion-violation error) and don't rely on the controller alone (race conditions are real).
- **One file per resource** in `routes/`, `controllers/`, `models/`. Don't merge resources into a shared file for convenience.
- **Never hard-delete** `payments` or any row a `payments`/`leases`/`maintenance_requests` row depends on. If a delete request would violate this, return `409`, don't work around it.

## 3. Working Style

- Follow `docs/IMPLEMENTATION-PLAN.md` phase by phase. Don't jump to Payments (Phase 4) before Leases (Phase 3) is actually done and its exit criteria are met.
- After finishing a phase, self-check against that phase's **Exit criteria** before considering it done.
- When you hit an open question (see `docs/PRD.md §9` and any unresolved items in `HARD-QUESTIONS.md`), don't silently guess a resolution for a business-rule ambiguity — pick the most conservative interpretation, implement it, and leave a clear comment plus a note back to the human.
- Prefer small, reviewable commits scoped to one resource or one concern at a time (e.g., "Add leases overlap validation" not "Phase 3").

## 4. Code Conventions

- **Naming:** snake_case for SQL columns/tables (already fixed by the schema), camelCase for JS variables/JSON keys, kebab-case for file names in `routes/`/`controllers`/`models` (e.g., `leases.js` is fine since it's a single word; multi-word resources would be `maintenance-requests.js` if ever needed — currently all resource names are single words).
- **Error handling:** every controller function either returns a success response or calls `next(err)` — never swallow an error silently, never `console.log` an error as the only handling.
- **Response shape:** always match the API contract in `ARCHITECTURE.md §5` / the original build prompt exactly — same field names, same casing (camelCase in JSON responses even though the DB column is snake_case — map explicitly in the model or controller layer).
- **Comments:** explain *why*, not *what*, especially around the lease-overlap logic and the balance-due calculation — these are the two places a future maintainer (human or AI) is most likely to "simplify" incorrectly.

## 5. Testing Expectations

- Any new business rule (anything in `ARCHITECTURE-ESSENTIALS.md §Non-negotiable business rules`) needs a corresponding unit or integration test in the same commit/PR that introduces it — not "added later."
- Before marking a phase done, run the full test suite, not just the new tests.

## 6. What To Do When Stuck

- If a requirement in `docs/` seems to conflict with itself, check `HARD-QUESTIONS.md` first — it may already be resolved there.
- If it's genuinely unresolved, don't guess silently: implement the most conservative/safe interpretation, add a `// TODO(human):` comment explaining the ambiguity, and surface it explicitly in your response to the human.

---

*(Note: `CLAUDE.md` in this repository root is identical to this file, provided for tools that look for that filename specifically. Keep both in sync if you edit either.)*
