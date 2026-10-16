# Runbook — textbee webhook (delivery reports + tenant replies)

**When you need this:** the SMS history shows `SENT` but never `DELIVERED`,
or tenants reply to confirmations ("I PAID") and the replies go nowhere.
The code (route + parser + inbox) ships in the app; these steps supply its
configuration — one secret, one dashboard subscription.

## How it works (30-second version)

- textbee cannot log in, so it proves itself with an **HMAC-SHA256 signature**
  (`X-Signature` header over the raw body) cut with the subscription secret.
  The server compares timing-safely; anything else is logged and dropped.
- The endpoint is `POST /api/sms/textbee-webhook` and **always answers 200**
  (textbee retries non-2xx for up to 30 days; a forged body never becomes
  valid, so it is dropped, not retried).
- `MESSAGE_DELIVERED` / `MESSAGE_FAILED` feed the existing delivery pipeline:
  the row whose `provider_message_id` + recipient match gets `DELIVERED` /
  `FAILED_ON_NETWORK`. Send status is never mutated (no double-billing).
  `MESSAGE_SENT` and `UNKNOWN_STATE` are ignored by design (row already SENT;
  unknown may still have arrived).
- `MESSAGE_RECEIVED` (a tenant replying to your SIM) lands in **sms_inbox**,
  visible on the SMS page under Received, sender resolved to the tenant where
  the number matches. Retried deliveries deduplicate on their idempotency key.
- Without `TEXTBEE_WEBHOOK_SECRET` the endpoint accepts nothing (fail closed,
  including dev).

---

## Step 1 — Generate the secret

Anywhere you trust:

```bash
openssl rand -hex 32
```

64 hex chars. It lives in exactly two places after this: the textbee
dashboard subscription and the server env. Never in code or chat logs.

## Step 2 — Create the subscription

In the textbee dashboard (Webhooks → Create), or via API:

```bash
curl -X POST https://api.textbee.dev/api/v1/webhooks \
  -H "x-api-key: $TEXTBEE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Olbano Plaza prod",
    "deliveryUrl": "https://rpms-gakt.onrender.com/api/sms/textbee-webhook",
    "signingSecret": "<secret from step 1>",
    "events": ["MESSAGE_DELIVERED", "MESSAGE_FAILED", "MESSAGE_RECEIVED"]
  }'
```

Select **only** the events the system uses (delivery tracking + inbox).
`MESSAGE_SENT` and `UNKNOWN_STATE` are accepted by the endpoint but
deliberately ignored — subscribing to them only multiplies deliveries.

For tenant replies to arrive at all, also turn on **Receive SMS**
("Forward incoming SMS to backend") in the phone app's SMS settings.

## Step 3 — Set the server secret

Render dashboard → rpms → Environment → add:

```
TEXTBEE_WEBHOOK_SECRET=<secret from step 1>
```

Save (the service restarts). Local dev: same key in `backend/.env`
(the test suite clears it via `tests/setup-env.ts` and sets its own).

## Step 4 — Verify

1. Send yourself a test SMS from the SMS page (or `POST /api/sms/test`).
2. textbee dashboard → Webhooks → Deliveries: the `MESSAGE_SENT` /
   `MESSAGE_DELIVERED` attempts should show HTTP 200.
3. SMS history row for that message should gain `DELIVERED` once the
   carrier confirms (carriers don't always report — `SENT` stays the proof
   of dispatch; `DELIVERED` is a bonus).
4. Reply to the SIM from your own phone → the text appears under
   SMS → Received, resolved to your tenant row if the number matches.

## Rotating the secret

Generate a new one (Step 1), PATCH the subscription's `signingSecret`,
update the Render env var, save. Deliveries signed with the old secret
drop (logged) until both sides match — rotate off-hours.

## Troubleshooting

- **Deliveries show non-200:** the endpoint only non-200s on crashes —
  check Render logs for `[sms]`. A 404 means the path is wrong.
- **200s but no status change:** the `smsBatchId` didn't match any row
  (old message, or sent before this deploy stored batch ids), or the
  recipient didn't normalize to the stored number. Server logs the drop
  reason only for bad signatures; unmatched batches are normal noise.
- **Replies missing:** Receive SMS off in the app, the phone offline
  (uploads on reconnect; >48 h late uploads store without an event —
  they still appear if you re-check), or the subscription lacks
  `MESSAGE_RECEIVED`.
- **Free-tier cold starts:** Render may take ~50 s to wake; textbee's
  retries cover it as long as the endpoint answers 200 once warm.
