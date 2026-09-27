# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user (confirmed): an owner-landlord who self-manages a single apartment property (currently Olbano Plaza, Kenya) without a property-management background. They operate the system directly — rent collection, water billing, expenses, tenant messaging and reporting all run through them, usually from a phone. The UI may assume landlord-domain fluency (rent, arrears, deposits, water meters) but not software expertise: dashboards must answer "who has paid, who owes, what came in" at a glance.

Second audience: tenants, who use the self-service portal to see their balance, pay rent via M-Pesa, follow their water bill and download receipts/statements. Tenants see only their own data.

Third audience: helpers — agent/admin staff accounts, created only after an administrator approves them, for landlords who delegate parts of the operation.

## Product Purpose

RPMS replaces exercise books and scattered spreadsheets with one live system of record for a single rental property: rent ledger and arrears, metered water billing, M-Pesa rent collection with automatic reconciliation and numbered receipts, expenses, monthly reports, and email/S messaging to tenants. Success means the landlord never chases a payment or argues a water bill: money and meters speak to the ledger, and every tenant can see their own truth at any hour.

## Positioning

M-Pesa collection on autopilot (confirmed differentiator): tenants pay by STK push or PayBill, payments reconcile against the rent ledger the moment they land, and a numbered receipt goes out by email and SMS without anyone touching the books. This kills the classic Kenyan landlord's month-end ("I sent but it didn't reflect") in a way a generic property spreadsheet or a foreign PMS cannot truthfully copy. Metered per-unit water billing is the supporting claim: consumption computed per unit ends end-of-month arguments.

## Operating Context

- Kenya market: KSh currency, M-Pesa as the dominant payment rail (STK push via Daraja-compatible API; PayBill; callback reconciliation), +254 phone formats, wa.me/WhatsApp as a normal business channel.
- Single-property scope: one property with floors/units, not a multi-property portfolio. Reports are monthly (income statement, collection performance, arrears ageing, water consumption, expense breakdowns).
- The operator's day: morning arrears glance, mid-month pushes to unpaid units, month-end reconciliation and statements; water readings recorded when the meter reader walks the building.
- Paper habits it replaces: exercise-book ledgers, end-of-month water arguments, WhatsApp receipt-chasing.

## Capabilities and Constraints

- Staff app (auth-gated): dashboard, units, tenants, rent collection, water (meter readings / payments / supply in one page), tenant ledger, monthly summary, expenses, arrears, receipts, SMS notifications, tenant email campaigns, M-Pesa review queue (blank-reference and likely-water payment matching), users and audit logs (admin-only), privacy register (admin-only), settings.
- Tenant portal (separate auth, separate layout): balance and payment history, pay rent, own water bill, statements and receipts.
- Public marketing shell: landing page, registration (tenant self-claim via email on file; landlord/agent accounts created inactive until admin approval), unified staff/tenant sign-in, four legal pages.
- Technical constraints: Express + PostgreSQL backend, React SPA with route-level code splitting, white-label branding engine (see Brand Commitments), M-Pesa credentials/callback handled server-side.
- Deliberately absent (copy must not promise them): mobile apps, caretaker portals, multi-property portfolios.

## Brand Commitments

- White-label per operator (confirmed): "RPMS" is the engine; each operator sets their own business name, legal name, address, contacts and logo via Settings, and it flows through the staff app, tenant portal, emails, PDFs and the landing page. "Olbano Plaza" is the current operator's identity, not the product's.
- Honest-copy commitment: the marketing surface only claims what the system genuinely does today.

## Evidence on Hand

- Live reference data in the dev database (units, room types, rents) powers the public pricing section — real numbers from the rent ledger, not invented plans.
- Photos in `frontend/public/photos/` (keys-move-in, unit-viewing) and building imagery in `frontend/public/building/` — the actual property.
- No testimonials, press, case studies or customer logos exist; future work must not fabricate any.

## Product Principles

1. The ledger is the truth. Every screen, portal view, receipt and report is a projection of the same live balances — never a separate number.
2. Reconciliation is invisible. Payments, meters and receipts should flow into the record without the landlord acting as the bookkeeper.
3. Tenants see their own truth. Self-service beats phone calls; data boundaries between tenants are absolute.
4. Built for one landlord's phone. Assume a single operator, a single property, and a small screen — depth only where the daily job needs it.
5. Say only what is true. Copy claims today's real behavior, in the landlord's own vocabulary (arrears, units, readings, receipts).

## Accessibility & Inclusion

- Public phone-first surfaces (landing, portal, sign-in) must work one-handed on small Android phones: 44px touch targets, contrast ≥4.5:1 for meaningful text/icons, form errors announced and associated via `aria-describedby`.
- Dark mode is a first-class theme across the app; hardcoded-light marketing surfaces must still honor the toggle's controls (header contrast, form controls) even though their canvas stays light.
