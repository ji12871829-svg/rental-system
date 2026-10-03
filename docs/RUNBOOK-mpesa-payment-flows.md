# Runbook — how M-Pesa rent payments arrive

After the PayHero poller was removed, rent money reaches the ledger through
exactly three paths. All three converge on the same posting engine
(`backend/src/services/mpesaService.ts` + `rentAllocation.ts`), the same
`mpesa_transactions` audit trail, and the same receipt SMS/email pipeline.

```
 A. Tenant pays Paybill/Till ──► Daraja C2B confirm ──► /api/mpesa/c2b/confirm ─┐
 B. Staff records cash/bank/… ────────────────► POST /api/rent/payments        ─┤
 C. Manager sends STK prompt ─► tenant's phone ─► /api/mpesa/stk/callback ─────┤
                                                                               │
                                     match (unit ref, else sender phone)       ▼
                                     allocate across oldest arrears     rent_payments
                                     receipt SMS (+ queued email)       + receipts
```

---

## Transaction lifecycle (`mpesa_transactions.status`)

| Status | Meaning |
|---|---|
| `RECEIVED` | Callback or STK initiation stored; matching not finished yet |
| `MATCHED` | Tenant identified, posting in progress |
| `POSTED` | Money is in the ledger; linked `rent_payment_id` / `water_payment_id` |
| `UNMATCHED` | No tenant identified (bad/blank reference, unknown phone, water disabled) |
| `AMBIGUOUS` | Reference or phone matched more than one active tenant |
| `FAILED` | STK prompt rejected/cancelled, or staff ignored the row in review |

Provider replays of an already-`POSTED` transaction are detected by
transaction/checkout id and answered with `DUPLICATE` — money is never posted
twice.

---

## Path A — Daraja C2B callback (automatic)

**What happens.** The tenant pays the Paybill/Till from their phone. Safaricom
POSTs a confirmation to `/api/mpesa/c2b/confirm` (and an advisory to
`/api/mpesa/c2b/validate`, which always accepts). The app parses the payload,
stores a `source = 'C2B'` row with status `RECEIVED`, and tries to match.

**Account reference conventions** (what the tenant types into the paybill
"account number" field):

| Reference | Kind | Matching behaviour |
|---|---|---|
| `15` | Rent | Active tenant in unit 15 |
| `15-WATER` | Water | Active tenant in unit 15, posted to their water balance |
| *(blank)* | Rent | Legal — falls back to sender-phone matching (below) |
| anything else | Rent | Normalized and tried as a unit number |

Matching cascade, in order:

1. **Unit reference** → the single active tenant currently in that unit.
2. **Sender phone** (rent only, when the reference names no unit): the MSISDN
   the money came from is normalized (`07…`, `2547…`, `+2547…` all match) and
   compared against active tenants' phone numbers. Only an unambiguous single
   match posts automatically.
3. **Nothing conclusive** → the row is parked `UNMATCHED` (or `AMBIGUOUS` for
   multiple candidates) — it never guesses.

**When it matches.** The row moves to `MATCHED`, then posts:

- **Rent** — allocated across the tenant's oldest arrears months (same engine
  as manual entry), each slice generating its own receipt + prepared receipt
  SMS. The audit entry records how the tenant was identified (unit reference
  vs. sender phone).
- **Water** — posted to the unit's water balance with a receipt (SMS only).
  Water is refused (`UNMATCHED`) for units where water billing is disabled.

**When it doesn't.** An operator alert email is queued immediately (once per
transaction — provider replays never re-email), and the stale-unmatched
escalation job re-alerts every 5 minutes for any C2B row still in the queue
after **60 minutes**.

**Manual review queue.** Staff see all `UNMATCHED` / `AMBIGUOUS` / `FAILED`
C2B rows under **M-Pesa Review** (`GET /api/mpesa/review`), each with a
suggested tenant (by sender phone) and suggested kind (rent vs. water, based
on the unit's water balance). From there:

- **Resolve** — pick tenant + kind; rent reuses the oldest-arrears allocation
  unless "allocate" is turned off to force the transaction's own month.
- **Ignore** — marks the row `FAILED` ("Ignored by staff review"); use for
  personal payments to the paybill that are not rent. Posted rows cannot be
  ignored.

**Security.** These endpoints are hit by Safaricom and are gated by the
`MPESA_CALLBACK_TOKEN` shared secret plus a shortcode check. See
[RUNBOOK-mpesa-callback-gate.md](RUNBOOK-mpesa-callback-gate.md) — the gate
only enforces once the token is configured, and `verify-live` CI fails until
it is.

---

## Path B — staff manual entry

**What happens.** Staff record a payment directly in **Rent Collection** →
record payment (`POST /api/rent/payments`). Method is one of `CASH`, `M_PESA`,
`BANK`, `OTHER`, with an optional reference and notes. Money that physically
arrived outside the paybill (cash at the office, bank transfer, paybill
reconciliation done by hand) enters here.

This path writes a `rent_payments` row **without** touching
`mpesa_transactions` — there is no callback to store — and immediately runs
the same receipt SMS/email pipeline as the automatic path (receipt PDF, receipt SMS,
prepared receipt email with honest delivery reporting for tenants without a
phone/email on file). Unless `SMS_AUTO_SEND=false` / `EMAIL_AUTO_SEND=false`
was set, both dispatch themselves right after the payment transaction
commits — staff enter the payment and the tenant's receipt SMS (rent: also
the PDF receipt email) goes out on its own; anything left `PENDING`
(provider outage, auto-send disabled) is sent manually from SMS history /
Receipts. Audit entries attribute the entry to the staff user.

**Tip:** if a C2B payment is stuck in review and the tenant needs their
receipt urgently, resolving it in M-Pesa Review (Path A) is better than
double-entering it here — a manual entry for the same money will duplicate the
posting, because the review row links to its own payment when resolved.

---

## Path C — manager STK prompt (staff-initiated push)

**What happens.** From Rent Collection, staff press **"Send M-Pesa Prompt"**
(`POST /api/rent/stk-push`, body: `tenantId` + `amount`). The app initiates a
Daraja STK Push to the **tenant's** phone with the account reference preset to
their unit number, and stores a `source = 'STK'` row with status `RECEIVED`.
The tenant approves on their phone; Safaricom reports the outcome to
`/api/mpesa/stk/callback`, which posts it through the same match/allocation
engine as Path A.

Guardrails before the prompt is even sent: the tenant must be `ACTIVE` and
have a phone number on file; otherwise the request fails with a clear error.

**Outcomes:**

| Tenant's phone shows… | Result |
|---|---|
| Approved & money moved | Callback posts the payment → `POSTED`, receipts flow |
| Cancelled / timed out / wrong PIN | `markStkFailure` → status `FAILED` with Daraja's reason |

This is the Daraja-native replacement for the removed tenant-portal PayHero
STK card: the prompt is always **sent by staff**, never self-service. The
tenant portal stays read-only about payments-in-flight — its payment timeline
(`GET /api/portal/payment-status`) derives `CONFIRMING → MATCHED → POSTED /
NEEDS_REVIEW` stages from `mpesa_transactions`, so a tenant who was prompted
can watch the approval land without the portal being able to trigger one.

**Edge case:** STK payments use the unit-number reference, so they match in
practice. If one somehow lands `UNMATCHED` (e.g. the tenant moved out between
prompt and callback), it will **not** appear in the review queue — the queue
only lists `source = 'C2B'`. Reconcile it via manual entry (Path B) after
verifying the money in the M-Pesa statement, and ignore/resolve the STK row
at the database level if needed.

---

## Operations checklist

- Env vars for all three paths: `docs/DEPLOY.md` §8 (`MPESA_PROVIDER=daraja`,
  consumer key/secret, shortcode, passkey, `MPESA_CALLBACK_URL`,
  `MPESA_BASE_URL`).
- Register the **tokenized** C2B URLs in the Daraja portal and keep
  `MPESA_CALLBACK_URL` tokenized so STK callbacks arrive pre-authorized:
  see [RUNBOOK-mpesa-callback-gate.md](RUNBOOK-mpesa-callback-gate.md).
- Until Daraja credentials are configured, `MPESA_PROVIDER=mock` keeps the
  callback endpoints functional for local testing with hand-crafted payloads.
- Watch the operator-alert mailbox: an alert means real money is sitting in
  the review queue unposted. The escalation job re-reminds every 5 minutes
  after 60 minutes stuck.
- Receipt delivery is automatic unless opted out: `SMS_AUTO_SEND` /
  `EMAIL_AUTO_SEND` default to **on** and dispatch the receipt SMS (and, for
  rent, the PDF receipt email) right after each posting commits — all three
  payment paths included. Set either to `false` to hold messages for manual
  sending from SMS history / Receipts. Mock providers record without
  delivering; real delivery additionally needs `SMS_PROVIDER=africastalking`
  (+ credentials) and `EMAIL_PROVIDER=brevo|smtp` (+ credentials) — see
  `docs/DEPLOY.md` §4.

## Useful debug queries

```sql
-- What is sitting in the review queue right now?
SELECT id, status, amount, account_reference, phone_number, error_message, created_at
FROM mpesa_transactions
WHERE source = 'C2B' AND status IN ('UNMATCHED', 'AMBIGUOUS', 'FAILED')
ORDER BY created_at DESC;

-- Recent STK prompts and their outcomes
SELECT id, checkout_request_id, amount, phone_number, status, error_message, created_at
FROM mpesa_transactions WHERE source = 'STK' ORDER BY created_at DESC LIMIT 20;

-- Confirm a posting landed and which payment it created
SELECT m.id, m.status, m.rent_payment_id, m.water_payment_id, r.amount, r.payment_date
FROM mpesa_transactions m
LEFT JOIN rent_payments r ON r.id = m.rent_payment_id
ORDER BY m.created_at DESC LIMIT 20;
```
