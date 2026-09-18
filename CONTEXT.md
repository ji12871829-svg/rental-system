# Olbano Plaza — domain glossary

The vocabulary this codebase uses. Architecture discussions and code comments
should use these terms exactly; new modules get named here when they introduce
a concept worth keeping.

## People

- **Staff user** — an internal account (ADMIN, PROPERTY_MANAGER or STAFF role)
  that signs in to the staff app. Lives in `users`.
- **Tenant** — the renter of a unit. Has a contact email and optionally a
  phone. Lives in `tenants`. Never signs in as a staff user.
- **Portal login email** — the tenant's credential address for the tenant
  portal (`tenant_portal_access`), which may differ from their contact email.
  Credential mail is always sent here, not to the contact address.

## Property & money

- **Unit** — a rentable property unit. **Reading** — a monthly water meter
  reading for a unit. **Receipt** — proof of a recorded payment (RENT, WATER
  or COMBINED), rendered as a printable PDF.
- **Statement** — a tenant's full-year billing/payment summary PDF.
- **Monthly Financial Report** — the operator's one-page year-to-date PDF.
- **Business identity** — the single `business_branding` record (legal name,
  registration number, contacts, logo) that brands receipts, PDFs, emails and
  the app chrome. One save updates the whole system.

## Messaging

- **Outbound Email module** — `emailService.ts` plus the pure compositions in
  `utils/emailTemplates.ts`. Owns the email lifecycle exactly once; callers
  compose content and delegate.
- **Email notification record** — one row in `email_notifications`: a faithful
  copy (subject, html, text, attachments) of what was sent, kept for the
  accountability principle. History pages render these rows; they are records,
  not a queue API.
- **Queue/send lifecycle** — `PENDING` (queued by `queueEmail`, the single
  persist point) → provider → `SENT` (with message id) or `FAILED` (with the
  provider's reason). SMS mirrors the same lifecycle in `smsService.ts`.
- **Provider adapter** — the swappable sender behind the lifecycle
  (`emailProvider.ts`, `smsProvider.ts`): mock / SMTP / Brevo for email,
  mock / Africa's Talking / Twilio for SMS. Self-tests (`sendTestEmail`,
  `sendTestSms`) verify the adapter without touching history.
- **Kind** (email) — receipt, portal credentials, data-request letter, monthly
  report, statement, campaign. Each kind is a thin `prepareFor*` adapter:
  resolve data → one pure template → `queueEmail`.
- **Campaign** — one composed message sent to many active tenants with
  `{{name}}` / `{{unit}}` placeholders.
