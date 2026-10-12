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
- **Tenant Ledger module** — `services/tenantLedger.ts`. The single home for
  the move-in-aware tenancy-window math (which months a tenant owed rent,
  expected vs paid, per-tenant balances, and the portfolio occupancy view).
  Every surface that shows a balance — tenant card, dashboard, ledger page,
  arrears, reminders, statement PDFs, M-Pesa allocation — reads through it,
  so no two figures can disagree.
- **Statement** — a tenant's full-year billing/payment summary PDF.
- **Monthly Financial Report** — the operator's one-page year-to-date PDF.
- **Business identity** — the single `business_branding` record (legal name,
  registration number, contacts, logo) that brands receipts, PDFs, emails and
  the app chrome. One save updates the whole system.

## Messaging

- **Outbound Message module** — `services/outboundMessage.ts`. The single home
  for the channel-agnostic half of sending: the auto-send gate
  (`autoSendEnabled`) and the post-commit dispatch seam
  (`dispatchAfterCommit`) that email and SMS both enter through. A provider
  outage or a disabled flag can never fail the request that queued a message.
- **Post-payment dispatch module** — `services/postPaymentDispatch.ts`. The
  one orchestration every payment flow (rent, water, and the M-Pesa paths
  that reuse them) uses to tell a tenant about a recorded payment:
  `notifyPaymentRecorded` prepares the SMS and email rows ON the payment's
  transaction (a pool connection cannot yet see the seconds-old receipt),
  returns the two channels' delivery facts — `{ queued, autoSend }` for SMS,
  `{ queued, autoSend, reason }` for email — computed from what it actually
  did, and hands back a `dispatch()` closure the flow calls strictly after
  commit. The flows report those fact objects verbatim in both the audit
  entry and the API response, so no record can drift from what was really
  prepared. A missing phone or email on file degrades to "nothing queued"
  (email carries the canonical `reason: 'no email on file'`), never an error;
  a provider failure leaves a retryable row and never touches the payment.
- **Outbound Email module** — `emailService.ts` plus the pure compositions in
  `utils/emailTemplates.ts`. Owns the email lifecycle exactly once; callers
  compose content and delegate. Cross-module callers queue through
  `queuePreparedEmail`, the one persist point.
- **Email notification record** — one row in `email_notifications`: a faithful
  copy (subject, html, text, attachments) of what was sent, kept for the
  accountability principle. History pages render these rows; they are records,
  not a queue API.
- **Retry sweep** — `services/retrySweep.ts`. The one parameterized sweep
  behind both channels' automatic retries: it claims due rows (`FOR UPDATE
  SKIP LOCKED`, batch 20), re-sends them through the channel's own send and
  contains per-row errors by reverting to `FAILED` with the reason appended.
  `smsRetryJob` binds it to `sms_notifications` claiming `FAILED`;
  `emailRetryJob` binds it to `email_notifications` claiming `FAILED` +
  `ERRONEOUS` — a transient `FAILED` row gets a `next_retry_at` deadline
  the sweep honors; a row that exhausts its budget keeps `FAILED` with no
  deadline — visibly "gave up", still sendable manually. Email adds the
  terminal `ERRONEOUS` outcome for a rejected ADDRESS (no mailbox, refused
  domain): no retry can help, so it is recorded without a deadline for the
  operator to fix and re-send. Send transitions stay per channel on purpose
  (SMS carries provider cost and delivery reports; email classifies permanent
  vs transient via `isTerminalEmailFailure`).
- **Tenant reminder module** — `services/reminderService.ts`. One home for
  "tell this tenant what they owe": resolves the live ledger figures once,
  then queues an SMS row, queues a statement email, or composes a WhatsApp
  click-to-chat link the operator sends. Keeps smsService and emailService
  channel-only — before it existed, smsService reached into emailService for
  the reminder's email twin.
- **Provider adapter** — the swappable sender behind the lifecycle
  (`emailProvider.ts`, `smsProvider.ts`): mock / SMTP / Brevo for email,
  mock / Africa's Talking / Twilio for SMS. Self-tests (`sendTestEmail`,
  `sendTestSms`) verify the adapter without touching history.
- **Kind** (email) — receipt, portal credentials, data-request letter, monthly
  report, statement, campaign. Each kind is a thin `prepareFor*` adapter:
  resolve data → one pure template → `queueEmail`.
- **Campaign** — one composed message sent to many active tenants with
  `{{name}}` / `{{unit}}` placeholders.
