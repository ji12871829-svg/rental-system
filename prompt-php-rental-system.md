Build a rental property management system for a different property/brand, modeled on the operational behavior of this existing system (/c/Users/Admin/Desktop/Rental System), but implemented on this stack:

- Frontend: plain HTML, CSS, and JavaScript — no framework
- Backend: PHP
- Database: MySQL
- Development environment: XAMPP

What to carry over from the existing system
-----------------------------------------
Keep the same domain behavior and the same discipline around the core machinery. The new stack is different, but the surrounding architecture should follow the same patterns:

- Domain model: properties -> floors -> units (type, monthly rent, water-enabled flag, occupancy status); tenants (contact email, optional phone, move-in/out dates, status, unit link); a separate tenant portal credential table so portal logins are not stored on the tenant row; rent payments, water meter readings + water bills, water payments, water purchases; M-Pesa-style transactions with receipt matching and a review queue for unmatched payments; receipts (rent / water / combined) with unique receipt numbers; expenses with an approval gate, recurring expenses, vendors, maintenance requests and work orders; SMS/email notification history tables that act as sent records, not a live queue API; settings singleton for reporting year, currency and water rate; business identity singleton that brands receipts, PDFs, emails and app chrome; audit log; privacy/export/erase register; and message templates with defaults plus overrides.
- Ledger discipline: move-in-aware arrears and balance math should live in one place and be the single source every balance view reads from — tenant card, dashboard, ledger, arrears, reminders, statements and allocation all read through it so figures cannot disagree.
- Money is serious: store money as DECIMAL(12,2); never hard-code rents, bills or rates in application code — read them from the DB settings/unit rows at runtime.
- Messaging discipline: a provider outage or a disabled auto-send flag must never fail the request that queued a message. Receipts/payment notifications get prepared first, then dispatched after the DB commit. Retries must be one reusable mechanism for both SMS and email, with terminal failures (e.g. bad email address) recorded as "give up, fix and resend manually" rather than retried forever.
- Channel separation: SMS-only and email-only sending logic should stay channel-only; anything that sends both (e.g. a reminder with an SMS plus an email twin) should be orchestrated in its own module, not by one channel reaching into the other.
- Safety nets: water billing should only ever apply to water-enabled units, enforced both in app logic and at the DB level; tenant portal must never grant staff roles or staff API access; public vacancy/marketing listings must expose only marketing fields, never tenant identity.
- First-run behavior: with an empty users table, the first account created through the app's registration flow becomes the admin; later registrations become approval requests handled in users/admin.
- PDF outputs: receipts, tenant statements and the operator's monthly financial report should still be real printable PDFs, generated server-side.
- Auditability: important mutations write audit rows; notification history rows are faithful copies of what was actually sent (subject, body, attachments), kept for accountability.

What changes because of the new stack
------------------------------------
- Frontend is HTML/CSS/JS, so use server-rendered pages or a lightweight JS UI as appropriate, but keep the same screens and flows: dashboard, units, tenants, rent collection, water billing, receipts, M-Pesa/payment review, SMS and email history, reminders, settings/branding, audit and privacy register, tenant portal.
- Auth is PHP sessions/JWT or your preferred PHP approach, but keep the same separation between staff app and tenant portal — a token/credential from one side must not be usable on the other.
- DB is MySQL, so adapt the schema style (e.g. AUTO_INCREMENT, DECIMAL, ENUM or lookup tables, DATETIME/TIMESTAMP) but keep the same constraints and the same singleton settings/branding rows.
- Deployment/run loop is XAMPP locally; document the httpd.conf/VirtualHost, .env/config, MySQL import and PHP built-in or Apache setup so another developer can spin it up.

Scope of the new system
-----------------------
Create a complete, runnable rental system for a different property/brand that reuses the behavioral patterns above. Only change the domain inputs and branding — property name, units, rent levels, water billing choices, payment channels in use, business identity — not the surrounding machinery. If you drop a feature from the original (for example M-Pesa, maintenance, or expenses), say so explicitly; do not silently change the messaging/retry/ledger discipline to compensate.
