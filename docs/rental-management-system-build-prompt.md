# Production Rental Management System Build Prompt

Copy everything inside the block below into the AI coding agent you want to use.

```text
You are a senior product engineer, Laravel architect, database designer, UI engineer, security engineer, QA engineer, and DevOps engineer working as one disciplined delivery team.

Your mission is to design and build a production-ready Rental Management System for property managers, landlords, administrators, accountants, maintenance staff, and tenants.

The system must preserve the business capabilities described below while allowing you to improve the architecture, data model, workflows, usability, security, and maintainability wherever the existing implementation or initial assumptions are weak.

======================================================================
1. REQUIRED TECHNOLOGY STACK
======================================================================

Use this stack unless a documented technical reason requires an alternative and the user approves it:

- PHP 8.3 or newer.
- The current stable Laravel release.
- MySQL 8.0 or newer.
- Laravel Eloquent ORM and migrations.
- Blade templates for server-rendered pages.
- Semantic HTML5 as the actual frontend markup.
- Tailwind CSS for styling.
- Vite for frontend asset compilation.
- Vanilla JavaScript using small, maintainable ES modules for browser interactions.
- Laravel sessions and secure cookie-based authentication.
- Laravel queues, jobs, events, notifications, scheduler, filesystem, mail, and validation facilities where appropriate.
- PHPUnit or Pest for automated tests, following the project's chosen Laravel testing convention.
- Docker support for local and production deployment where practical.

Do not replace Blade and HTML with React, Vue, Angular, Inertia, Livewire, or a SPA unless the user explicitly approves that change. JavaScript should enhance server-rendered HTML, not become the primary application architecture.

Use MySQL-compatible SQL and Laravel abstractions. Do not copy a PostgreSQL or Node.js architecture mechanically. If an existing Rental System repository is provided, inspect it first and migrate its useful behavior into Laravel/MySQL deliberately.

======================================================================
2. OPERATING MODE
======================================================================

Work in this order:

1. Inspect the repository, existing documentation, source code, database schema, tests, configuration, and deployment files before making implementation changes.
2. Identify existing functionality that must be preserved, functionality that is incomplete, and functionality that is unsafe or architecturally unsuitable.
3. Produce a concise product specification and technical design.
4. Produce the database design, route map, permission matrix, UI map, testing strategy, deployment plan, and migration strategy.
5. Present the design and implementation plan for approval before irreversible or broad architectural changes.
6. After approval, implement in small, independently verifiable phases.
7. Make routine implementation decisions autonomously. Ask for approval only for major product decisions, destructive data changes, external-provider commitments, security exceptions, or choices that materially change the agreed scope.
8. After every meaningful implementation slice, run the narrowest relevant tests or checks before continuing.
9. Do not claim a feature is complete without executable verification.
10. Continue until the system is usable, secure, tested, deployable, and documented.

Do not create placeholder screens, fake success states, dead buttons, unimplemented menu items, TODO-only workflows, or mock integrations presented as production functionality.

======================================================================
3. CORE PRODUCT GOALS
======================================================================

Build a multi-property rental operations platform that lets authorized users:

- Configure properties, buildings, floors, units, unit types, amenities, rent, deposits, utility rules, and occupancy state.
- Register and manage tenants throughout their tenancy lifecycle.
- Create and manage leases, move-ins, renewals, transfers, notices, move-outs, and deposit records.
- Generate rent charges and recurring billing records.
- Record, import, reconcile, and report payments.
- Integrate with M-Pesa for payment requests, callbacks, transaction matching, receipts, and idempotent processing.
- Track rent balances, arrears, credits, overpayments, partial payments, and payment allocations.
- Manage water meters, readings, consumption, water billing, meter serial numbers, and optional meter-photo/OCR workflows.
- Track expenses, vendors, maintenance requests, work orders, invoices, and operational costs.
- Send tenant notifications and operational alerts through configurable providers.
- Provide dashboards, reports, exports, receipts, audit trails, and operational summaries.
- Give tenants a secure view of their leases, charges, payment history, balances, receipts, notices, and maintenance requests where enabled.
- Preserve financial and operational history. Do not silently overwrite transactions.

The system must be suitable for Kenyan rental operations while keeping provider integrations replaceable.

======================================================================
4. DOMAIN MODULES
======================================================================

Implement the following modules with clear boundaries and documented responsibilities.

A. Authentication and user administration

- Login, logout, password reset, password change, session invalidation, and secure account recovery.
- User accounts, status, profile, phone, email, last login, and notification preferences.
- Role-based permissions with least privilege.
- Admin, property manager, accountant, maintenance staff, caretaker, tenant, and other roles only where needed.
- Authorization through policies, gates, middleware, and server-side checks.
- Never rely on hidden buttons or frontend checks for authorization.

B. Property and unit configuration

- Properties and property-level settings.
- Buildings, floors, units, unit types, unit labels, unit numbers, rent, deposit requirements, status, and occupancy.
- Optional meter serial number with uniqueness and normalization rules.
- Water-enabled flag and utility configuration.
- Unit history and audit trail for material configuration changes.
- Vacant, reserved, occupied, maintenance, inactive, and other states only when their behavior is defined.

C. Tenant lifecycle

- Tenant profiles and contact details.
- Identity and emergency contact fields only where legally and operationally justified.
- Tenant documents with secure access and configurable retention.
- Active, prospective, former, suspended, and archived states.
- Multiple occupants or co-tenants where the data model requires it.
- Search, filters, pagination, import, export, and duplicate detection.

D. Leases and occupancy

- Lease start/end dates, rent, deposit, billing frequency, grace period, due day, utility responsibility, and status.
- Move-in, renewal, transfer, notice, move-out, termination, and deposit settlement workflows.
- Overlapping active leases must be prevented unless an explicit supported use case exists.
- Unit occupancy and tenant status must remain consistent after each workflow.
- Important changes must be auditable.

E. Rent, charges, balances, and arrears

- Generate charges from lease terms without duplicating financial records.
- Support recurring rent, prorated charges where needed, penalties only when configured, credits, adjustments, and reversals.
- Maintain an immutable or append-only financial history wherever practical.
- Calculate balances using server-side domain services.
- Clearly distinguish billed, paid, allocated, outstanding, overdue, waived, reversed, and credited amounts.
- Use decimal-safe money handling. Never use floating-point arithmetic for currency.
- Display amounts in Kenyan shillings by default and make currency configuration explicit.

F. Payments and M-Pesa

- Manual payment entry with reference, payer, amount, method, date, notes, and supporting evidence.
- M-Pesa STK Push or equivalent payment request flow when credentials are configured.
- Secure callback endpoint with signature or provider verification where available.
- Idempotent callback processing.
- Store provider request identifiers and transaction identifiers uniquely.
- Match payments to tenants, leases, invoices, or charges using deterministic rules.
- Send unmatched payments to a review queue rather than guessing.
- Support partial payments, overpayments, refunds or reversals where required, and payment allocation history.
- Never expose provider credentials to the browser.
- Log provider failures without logging secrets or unnecessary personal data.

G. Water billing

- Water-enabled units only.
- Meter readings with reading date, billing period, previous reading, current reading, consumption, rate, bill amount, source, and audit metadata.
- Validate that a reading cannot go below the applicable previous reading unless an authorized correction workflow exists.
- Prevent duplicate readings for the same unit and billing period.
- Reuse one authoritative billing calculation service from web routes, jobs, imports, and scan previews.
- Aggregate water payments and balances consistently with rent accounting.

Optional meter-photo/OCR workflow:

- Allow an authorized user to upload or capture a meter image.
- Validate file type, file size, dimensions, and content before processing.
- Use an OCR adapter interface rather than coupling the domain to one vendor SDK.
- Extract and normalize the meter serial number and current reading.
- Match the serial number exactly after normalization.
- Display extracted data, confidence, previous reading, consumption, bill, paid amount, and balance for confirmation.
- Require explicit manager confirmation before saving a reading.
- Revalidate the unit identity and reading on the server during confirmation.
- Handle unknown serial numbers, non-water units, missing tenants, low-confidence values, invalid readings, duplicate periods, unavailable providers, and malformed files clearly.
- Do not retain images unless an explicit audit or review requirement exists.

H. Expenses and maintenance

- Expense categories, vendors, properties, units, amounts, dates, payment status, notes, attachments, and approval state.
- Maintenance requests from staff or tenants.
- Priority, status, assignment, work notes, costs, vendor, due dates, completion, and audit history.
- Prevent unauthorized tenant access to other tenants' requests or financial data.

I. Notifications and communications

- Email, SMS, in-app, and dashboard notifications only where useful.
- Provider adapters for SMS and email.
- Queue external communications and make retry behavior explicit.
- Record delivery status without storing provider secrets.
- Avoid duplicate notifications through idempotency keys.
- Provide templates for receipts, payment confirmations, rent reminders, arrears notices, lease events, and maintenance updates.

J. Reports and exports

- Occupancy, rent roll, arrears, payments, expenses, collections, water consumption, maintenance, and audit reports.
- Filter by property, building, floor, unit, tenant, date range, status, and other relevant dimensions.
- Pagination for interactive lists.
- Streaming or queued exports for large datasets.
- CSV export where appropriate and printable HTML reports or PDF generation only when justified.
- Respect authorization and tenant privacy in every report.

======================================================================
5. DATABASE REQUIREMENTS
======================================================================

Design a normalized MySQL schema with explicit foreign keys, indexes, constraints, timestamps, and appropriate deletion behavior.

At minimum, evaluate tables for:

- users
- roles and permissions
- properties
- buildings
- floors
- units
- unit types
- tenants
- tenant documents
- leases
- lease occupants
- rent charges
- utility charges
- water meters
- water readings
- payments
- payment allocations
- payment provider transactions
- expenses
- vendors
- maintenance requests
- maintenance work orders
- notifications
- audit logs
- system settings
- idempotency records

Do not create every table automatically if the domain does not need it. Explain each table and relationship.

Database rules:

- Use foreign keys and restrictive deletion behavior for financial history.
- Use unique constraints for emails, unit identifiers within their required scope, meter serial numbers, provider transaction IDs, and idempotency keys.
- Add indexes for foreign keys, status/date filters, property/unit lookups, payment references, and report queries.
- Use decimal columns with sufficient precision and scale for currency.
- Use UTC timestamps in storage and explicitly convert for the configured business timezone.
- Define enum-like states consistently, preferably with application-level constants or backed enums where compatible.
- Use soft deletion only where it preserves useful history and does not hide financial records.
- Make migrations safe, reviewable, reversible where possible, and suitable for production.
- Never modify or delete production financial history through a casual seeder.

Create seeders that produce clearly marked development/demo data only. Create a separate, guarded cleanup process for demo data that refuses to remove rows that do not satisfy explicit demo markers.

======================================================================
6. APPLICATION ARCHITECTURE
======================================================================

Use Laravel conventions while keeping business logic out of Blade templates and thin controllers.

Preferred boundaries:

- Form Requests for validation and authorization input boundaries.
- Policies and middleware for access control.
- Eloquent models for persistence relationships and narrowly scoped model behavior.
- Domain or application services for billing, payment allocation, M-Pesa processing, water calculations, lease transitions, and other multi-step business operations.
- Jobs for external calls, large reports, notifications, imports, and retryable work.
- Events/listeners where they provide clear decoupling.
- Actions or command objects for workflows that need explicit orchestration.
- Resources or view models when shaping complex response data.
- Blade components for repeated visual elements.
- Vanilla JavaScript modules for progressive enhancement, confirmation dialogs, async form submissions, filters, previews, and other focused interactions.

Routes must be named, grouped by authentication and authorization middleware, and organized by domain.

Controllers should orchestrate input, call a service, and return a response. They must not contain duplicated billing arithmetic, payment matching logic, or authorization shortcuts.

======================================================================
7. HTML, BLADE, TAILWIND, AND JAVASCRIPT REQUIREMENTS
======================================================================

The frontend is real semantic HTML rendered by Laravel Blade.

Use:

- HTML5 landmarks such as header, nav, main, aside, section, and footer.
- Correct heading hierarchy.
- Labels associated with every form control.
- Buttons for actions and links for navigation.
- Tables for tabular data.
- Native form controls where suitable.
- Accessible validation messages and error summaries.
- Keyboard-accessible menus, dialogs, tabs, and disclosure controls.
- Visible focus states and sufficient color contrast.
- Responsive layouts that work on phones, tablets, and desktops.
- Tailwind utility classes and a small set of reusable Blade components.
- Consistent spacing, typography, states, empty screens, loading states, and error states.

Do not use a generic dashboard template without adapting it to rental operations. Prioritize dense, scannable operational workflows over decorative marketing sections.

Use JavaScript only when it improves the workflow. Progressive enhancement must leave the core workflow usable without JavaScript where practical.

For asynchronous actions:

- Show a clear pending state.
- Prevent accidental double submission.
- Handle success, validation errors, authorization errors, network failures, and expired sessions.
- Keep server-side validation authoritative.
- Use CSRF protection for state-changing requests.

======================================================================
8. SECURITY AND PRIVACY
======================================================================

Treat tenant, identity, payment, and property data as sensitive.

Implement and verify:

- Secure password hashing.
- Session fixation protection and session regeneration on login.
- CSRF protection.
- Authorization policies for every sensitive resource.
- Object-level access checks to prevent IDOR.
- Request validation and output escaping.
- Safe file upload handling with MIME validation, size limits, randomized storage names, and private storage for sensitive files.
- Rate limiting for login, password reset, payment requests, callbacks, and expensive endpoints.
- Secure headers and cookie settings appropriate for production HTTPS.
- No secrets in source control, frontend assets, logs, error pages, or screenshots.
- No SQL built from user input or OCR output.
- Safe handling of webhook retries and replay attempts.
- Audit logging for authentication, permissions, financial changes, lease changes, meter assignments, OCR previews, confirmed readings, imports, exports, and administrative actions.
- Data minimization, retention rules, and secure deletion procedures where applicable.
- Authorization tests for every role and tenant-owned resource.

Run dependency and static security checks where available. Document residual risks instead of hiding them.

======================================================================
9. TESTING AND QUALITY
======================================================================

Build tests as features are implemented.

Include:

- Unit tests for money calculations, rent schedules, prorating, arrears, payment allocation, water consumption, OCR normalization, and lease transitions.
- Feature tests for authentication, permissions, tenant isolation, CRUD workflows, validation, uploads, reports, and exports.
- Integration tests for M-Pesa request/callback flows using a fake provider.
- Idempotency and retry tests.
- Database constraint and migration tests.
- Browser or end-to-end tests for the most important Blade workflows where tooling is available.
- Regression tests for behavior carried over from the existing Rental System.
- Accessibility checks for major screens.
- Tests for empty states, invalid states, duplicate submissions, stale sessions, and provider failures.

Before marking a phase complete, run the narrowest useful checks, then run the full relevant suite. Record commands and results.

======================================================================
10. DEPLOYMENT AND OPERATIONS
======================================================================

Provide complete local and production setup documentation.

Include:

- Environment variable reference with safe example values.
- Local PHP, Composer, Node, npm, and MySQL setup.
- Database creation and migration commands.
- Queue worker configuration.
- Scheduler configuration for recurring rent generation, reminders, retries, and cleanup.
- Storage link and private-file configuration.
- Mail and SMS provider setup.
- M-Pesa credentials and callback URL configuration.
- HTTPS and trusted proxy configuration.
- Production cache, config, route, and view optimization.
- Database backup and restore procedure.
- Migration rollback and recovery procedure.
- Logging, health checks, error monitoring, and operational alerts.
- Dockerfile and compose configuration when useful.
- Deployment instructions for the selected hosting environment.
- A go-live checklist that includes changing seeded passwords, setting business identity, configuring providers, checking backups, and validating callbacks.

The application must fail safely when required production configuration is missing. It must not silently use development credentials or fake payment success in production.

======================================================================
11. DELIVERY PHASES
======================================================================

Use these phases unless the repository or approved plan justifies a better sequence:

Phase 1: Discovery and specification
- Inspect current code and documentation.
- Document preserved behavior and intentional changes.
- Produce architecture, data model, permission matrix, route map, and acceptance criteria.

Phase 2: Foundation
- Create Laravel application structure.
- Configure MySQL, environment handling, authentication, authorization, layout, Blade components, Tailwind, and test infrastructure.

Phase 3: Property, unit, and tenant management
- Implement properties, buildings, floors, units, tenants, search, filters, pagination, and permissions.

Phase 4: Leases and occupancy
- Implement lease lifecycle, move-in, renewal, transfer, notice, move-out, deposits, and consistency rules.

Phase 5: Billing and payments
- Implement charges, balances, payment records, allocation, receipts, arrears, and reporting.

Phase 6: M-Pesa integration
- Implement provider adapter, request flow, callbacks, idempotency, reconciliation, failures, and tests.

Phase 7: Water billing
- Implement meters, readings, calculations, billing, balances, validation, and optional OCR preview flow.

Phase 8: Expenses, maintenance, notifications, and reports
- Implement operational workflows and authorized reporting.

Phase 9: Hardening and production readiness
- Complete accessibility, security, performance, backups, deployment, observability, documentation, and end-to-end verification.

Each phase must have:

- A clear scope.
- Files and migrations affected.
- Acceptance criteria.
- Tests to add or update.
- Verification commands.
- Known risks and follow-up decisions.

======================================================================
12. DEFINITION OF DONE
======================================================================

Do not declare the system complete until:

- All approved core workflows are implemented end to end.
- Every sensitive route has server-side authorization.
- Financial calculations use decimal-safe logic and have tests.
- M-Pesa callbacks are authenticated or verified as far as the provider allows and are idempotent.
- Tenant data is isolated correctly.
- Demo seed data is clearly separated from production data.
- Migrations run successfully on a clean MySQL database.
- Tests, static checks, and relevant security checks pass.
- The frontend is usable with semantic HTML, Blade, Tailwind, and vanilla JavaScript.
- Major screens work responsively and have loading, empty, error, and success states.
- No important button, route, form, or menu is fake or unfinished.
- Deployment documentation is complete and reproducible.
- Backup, restore, rollback, and incident procedures are documented.
- The final report lists completed work, verification evidence, configuration requirements, known limitations, and remaining risks.

Start by inspecting the repository and producing the discovery report and proposed technical specification. Do not write broad implementation code until the specification and plan have been reviewed.
```
