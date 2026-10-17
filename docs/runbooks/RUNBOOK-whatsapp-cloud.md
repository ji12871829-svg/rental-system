# WhatsApp Cloud API — production runbook (Render)

Turns the WhatsApp delivery built for reminders and the Final Notice on inside
the deployed Render service. Local development steps live in this doc's intro;
production is a Render dashboard + Meta dashboard job, no rebuilds required.

Local (.env reference, never committed):

```
WHATSAPP_TOKEN=<access token>          # empty → click-to-chat (wa.me links) only
WHATSAPP_PHONE_NUMBER_ID=<number id>
WHATSAPP_API_VERSION=v25.0
WHATSAPP_TEMPLATE_REMINDER=<template name>       # BALANCE_DUE / OVERDUE sends
WHATSAPP_TEMPLATE_FINAL_NOTICE=<template name>   # FINAL_NOTICE sends
WHATSAPP_TEMPLATE_LANG=en
```

## 1. How mode selection works (no config file changes)

| Condition | Behavior |
|---|---|
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` empty | Click-to-chat only — every compose produces a `wa.me` link the operator opens and sends manually. Preview never enqueues. |
| Both set (template env empty) | **Live direct sends**, free-form. Each send must fall inside a 24-hour customer-service window opened by the tenant's last incoming message. |
| Both set **and** the purpose's template name set | Live direct sends as the **registered approved template** — no 24-hour window applies. Parameters are persisted per row (`template_params`) and replayed verbatim by manual re-send and the retry sweep. |

Either template env may be set alone; the other purpose keeps free-form sends.

## 2. Render environment variables

Set in Render Dashboard → the `rpms` service → Environment (no other changes):

| Key | Value | Notes |
|---|---|---|
| `WHATSAPP_TOKEN` | non-expiring System User token (step 4) | Read at call time; rotating it needs only a paste + service restart |
| `WHATSAPP_PHONE_NUMBER_ID` | from the API Setup / production number | See step 3 for test-number vs real-number IDs |
| `WHATSAPP_API_VERSION` | `v25.0` | Pinned; `v21.0` default also works |
| `WHATSAPP_TEMPLATE_REMINDER` | `olbano_rent_statement` | Registered on WABA `967804475850336` (2026-10-17, UTILITY/en) |
| `WHATSAPP_TEMPLATE_FINAL_NOTICE` | `olbano_final_notice_letter` | Same WABA, UTILITY/en |
| `WHATSAPP_TEMPLATE_LANG` | `en` | Template language sent with every template payload |

Verification after saving: `GET /api/whatsapp/config` →
`{"provider":"cloud","live":true,"apiVersion":"v25.0","templates":{"reminder":"olbano_rent_statement","finalNotice":"olbano_final_notice_letter","language":"en"}}`.
The boot log prints the equivalent WhatsApp line.

## 3. Test number vs real number

| | Test number (`+1 555 …`) | Production number (Meta Step 2) |
|---|---|---|
| Recipients | max **5 allowlisted**, verified by SMS/WhatsApp code | any tenant with a phone number |
| 24-hour window | applies to free-form; templates bypass it | same |
| Cost | free (sanctioned test number) | per Meta conversation pricing |
| Use | localhost testing | everything real |

Moving to the real number: WhatsApp use case → **Step 2. Production setup** →
add the business number (display name e.g. "Olbano Plaza", verify by phone
call/SMS code) → the **new Phone Number ID** replaces the test one in Render.
Templates registered on the WABA (like today's two) carry over — registration
is WABA-level, not per number.

Test-number allowlists live under **Step 1 → Manage phone number list** (cap 5);
adding a new recipient requires the code Meta texts/calls that phone.

## 4. Permanent access token (do this before real sends)

The API Setup "Generate token" button mints a token that expires within hours
on a new app. Production needs one that does not expire:

1. Meta for Developers → **Business settings → Users → System users** →
   **Add** (admin type).
2. Assign the asset **WhatsApp Business Account** (`967804475850336`) with
   full control.
3. Generate a token with scopes: `whatsapp_business_messaging`,
   `whatsapp_business_management` (add `business.management` when a script
   needs template CRUD later). Mark it **non-expiring**.
4. Paste into Render's `WHATSAPP_TOKEN` → Save changes → Render restarts the
   service (env changes trigger a restart; no manual action needed).

## 5. In-app business settings (replicate dev values)

Branding page (drives receipts, legal pages and the reminder composition):

| Field | Value |
|---|---|
| Contact email | `ji12871829@gmail.com` |
| Contact phone | `0706719042` — office line, also template `{{6}}` |
| Send Money phone | `0743799002` — M-Pesa send-money line, also template `{{5}}` |
| Paybill number/name | empty, PayBill **off** (wording contract: "Send Money" only) |
| Payment channels | `M-Pesa, cash or bank transfer` |

Settings page: currency `KSh`, reporting year `2026`, water rate `200.00`.

## 6. First production send (proof)

1. `/api/whatsapp/config` shows the whole template block (section 2).
2. Tenants page → a real tenant with balance → **Reminder → WhatsApp** →
   Compose → Send (the press itself is the live send).
3. WhatsApp History page: the row should read **SENT** with the template name
   in its `template_kind`; the Meta panel (API Setup → Check test webhooks, or
   Business Manager message logs) shows the corresponding `messages` event.

Failure codes worth knowing (classified ERRONEOUS, terminal):

- `131030` — recipient not allowlisted (test number) → verify the phone in
  Step 1's list, or move to the production number.
- `132xxx` — template mismatch (content collision between the registered
  template and the sent parameters) → keep the registered body byte-equal to
  the parameter mapping; check `WHATSAPP_TEMPLATE_LANG` matches the registered
  language.

## 7. What is deliberately NOT configured

- **Webhooks** — the app does not subscribe to inbound WhatsApp events;
  delivery state comes from the Graph send response. Meta's webhook field in
  API Setup can stay unconfigured.
- **Auto-send** — WhatsApp delivery happens only on the operator's press
  (compose previews are windowless; the scheduler never dispatches WhatsApp).
- **Email Final Notice** — refuses by rule (`zod` refinement + service guard);
  the escalation letter travels by SMS or WhatsApp only.
