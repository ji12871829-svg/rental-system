# Runbook — PayHero auto-collection (tenants "just send money")

**What this turns on:** tenants pay the property's M-Pesa paybill/till exactly
as they always have — no portal, and even a wrong or missing account
reference is fine. The backend polls PayHero, identifies the tenant, books the
money onto their **oldest rent arrears first**, and **auto-sends the receipt
SMS**. Zero operator touch per payment.

## Prerequisites

1. A PayHero account (app.payhero.co.ke) with your paybill/till registered as
   a **payment channel** (PayHero dashboard → Payment Channels; note the
   channel's numeric id).
2. An API key: dashboard → **API Keys** → Add new → copy the **username** and
   **password**.
3. Outbound SMS configured and live (`SMS_PROVIDER=africastalking` or
   `twilio` with working credentials — see the SMS section of
   `backend/.env.example`).

## Environment variables (Render → backend service → Environment)

```
PAYHERO_API_USERNAME=<from the API Keys page>
PAYHERO_API_PASSWORD=<from the API Keys page>
PAYHERO_CHANNEL_ID=<numeric channel id>
PAYHERO_POLL_SECONDS=60        # optional, default 60, floor 30
SMS_AUTO_SEND=true             # REQUIRED for automatic receipt SMS
```

Restart the service after saving. On boot the log shows:

```
PayHero poll job: running every 60s.
```

(With credentials unset you'll instead see
`PayHero poll job: disabled (…)` — the app behaves exactly as before.)

## How a payment flows

1. Tenant sends money to the paybill (account reference optional).
2. Within one poll interval the backend pulls the collection from PayHero.
3. Tenant identification, in order:
   - account reference matches an active tenant's unit number (exact),
   - otherwise the **sender's phone number** is matched against active
     tenants' phone numbers (07…/2547…/+2547… all normalize to the same
     value). Only an unambiguous single match is accepted.
4. The amount is allocated **oldest unpaid rent month first**, split into one
   posted payment per month when it clears several at once. Surplus beyond
   every unpaid month rides on the payment's own month as a visible credit.
5. Each slice creates its own receipt number and receipt SMS; the SMS row
   auto-sends because `SMS_AUTO_SEND=true`.
6. Anything unidentifiable (no unit match, no single phone match) lands in
   **M-Pesa review** as `UNMATCHED` for the normal manual review flow —
   money is never guessed onto the wrong tenant.

Water payments (`<unit>-WATER` references) always require a correct unit
reference and are never phone-matched — a metered bill belongs to one unit.

## Tenant-portal STK push ("Pay with M-Pesa")

Once the poller is on, tenants can also pay from their portal: the Payments
page offers **Pay with M-Pesa**, which sends an STK prompt to the phone
number on their tenant record for the amount they enter (prefilled with the
current rent balance).

- **No extra credentials**: the push uses the same `PAYHERO_API_USERNAME` /
  `PAYHERO_API_PASSWORD` / `PAYHERO_CHANNEL_ID` as the poller.
- **Completion is reconciled, not assumed**: when the tenant enters their
  PIN, the money arrives as an ordinary paybill collection and the poller
  posts it (match → oldest-arrears allocation → receipt → auto-SMS). The
  portal button only initiates — it never posts money itself.
- **Optional**: set `PAYHERO_STK_CALLBACK_URL` (public https URL) so PayHero
  can notify the backend the moment a push completes. Without it, completion
  is picked up by the next poll (≤60s) — the button stays "pending" until
  then either way.
- **Throttled**: 3 pushes per tenant per 10 minutes (Safaricom prompts are a
  real cost and a spam vector). Amounts are capped at KSh 1,000,000.
- **Hidden when unavailable**: without PayHero credentials — or when the
  tenant record has no phone number — the button does not render; the
  send-money instructions remain the only path.

## Operator email alert on unmatched payments

When a collection cannot be matched (or matches ambiguously), the backend
emails the operator address (Business branding → general email) with the
amount, reference, sender phone and reason. It is informational only:

- fires **once** per transaction — provider replays never re-alert;
- skips silently when no operator email is configured (the review page is
  still the source of truth);
- delivery follows the email provider (`mock` records only; `smtp` sends).

## Stale-unmatched escalation (60-minute reminder)

The instant alert can be missed; the escalation pass re-emails the operator
about any payment still sitting UNMATCHED/AMBIGUOUS after **60 minutes**.

- Runs every 5 minutes alongside the other background jobs (`Stale-unmatched
  alert job` line at boot); escalates **once per transaction** — a
  `stale_alerted_at` stamp (migration 007) prevents duplicates across
  restarts.
- Resolving the payment silences its escalation permanently (resolved rows
  are never selected).
- Subject prefix `STILL UNRESOLVED:` with the queue age, so it is
  distinguishable from the first alert in a busy inbox.
- If the operator email is unset, nothing is stamped and nothing sends — the
  review page remains the source of truth.

## Rolling back

Remove (or blank) `PAYHERO_API_USERNAME` / `PAYHERO_API_PASSWORD` and
restart. The poller disables itself; nothing else in the app changes. Any
payments already posted stay posted — they are ordinary ledger records.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| `PayHero poll job: disabled` in the log | Credentials not set / service not restarted |
| No `[payhero] ingest:` lines despite payments | PayHero dashboard: are the collections visible there? If not, it's a PayHero/channel issue, not RPMS |
| `ingest … UNMATCHED` growing | Tenants' phones in RPMS don't match the sending numbers — fix the tenant phone records; the M-Pesa review page lists each one |
| SMS rows stuck `PENDING` in SMS Notifications | `SMS_AUTO_SEND` not `true`, or SMS provider not live — rows can still be sent manually |
| Poll errors in the log (`[payhero] poll failed`) | Check `PAYHERO_BASE_URL` override and PayHero API status; the job retries next interval |
