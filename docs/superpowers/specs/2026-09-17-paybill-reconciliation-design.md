# PayBill Reconciliation Design

## Goal

Add one landlord-owned PayBill payment channel that is visible to both staff and tenants, while automatically matching confirmed M-Pesa payments to the correct tenant and payment type.

The existing STK Push flow remains available. PayBill is an additional manual payment route for tenants who prefer to initiate payment from the M-Pesa menu.

## Agreed Account References

- Rent: the tenant's unit number, for example `A-204`.
- Water: the tenant's unit number followed by `-WATER`, for example `A-204-WATER`.

Unit numbers are the system's source of truth. The application must normalize comparison values without changing the displayed unit number, using trimming and case-insensitive matching.

## Configuration

Add a landlord payment configuration with:

- PayBill number.
- PayBill business or account name.
- Enabled/disabled status.
- Optional tenant-facing instructions.

The configuration is edited by administrators or property managers in Settings. It is returned to authenticated staff and authenticated tenant portal users, but secrets or provider credentials are never sent to the frontend.

The UI must validate the PayBill number as digits only and display a confirmation before saving changes. Empty PayBill configuration disables PayBill instructions without affecting STK Push or existing payment records.

## Tenant Portal

The Payments page shows the active PayBill details in a dedicated payment panel:

- PayBill number.
- Business name.
- The logged-in tenant's rent reference, such as `A-204`.
- The logged-in tenant's water reference, such as `A-204-WATER`, when water billing is enabled.
- Copy actions for each value.
- A warning that the reference must be used exactly and that the tenant must not use a phone number or personal name.

The panel shows the current rent and water balances where available. It does not allow the tenant to edit the reference. If PayBill is disabled, the panel is hidden and the existing STK Push experience remains unchanged.

## Staff Surface

Settings is the single source of truth for the PayBill number and business name. Staff payment screens show the configured PayBill instructions where useful, but staff must continue to record only confirmed or verifiable payments.

Add a review surface for unmatched or ambiguous PayBill transactions. Each review item includes the transaction ID, amount, date, account reference, phone number when supplied, provider payload, and reason it was not posted. Staff can resolve an item by selecting the intended tenant and payment type, or mark it ignored with an audit trail.

## Callback and Reconciliation Flow

1. Safaricom sends a C2B confirmation callback to the existing M-Pesa callback endpoint.
2. The callback parser validates the transaction ID, amount, account reference, and transaction date.
3. The system stores the raw callback and deduplicates by provider transaction ID.
4. The account reference is parsed:
   - A known unit reference means rent.
   - A known unit reference ending in `-WATER` means water.
5. The system looks up one active tenant for the normalized unit number.
6. A valid rent reference creates a rent payment marked `M_PESA`.
7. A valid water reference creates a water payment marked `M_PESA`.
8. The M-Pesa transaction is marked `POSTED` and linked to the created payment.
9. Receipt generation and existing notification behavior run through the same payment services used by staff-entered payments.

The existing STK callback flow remains rent-only unless explicitly extended later. Its current unit-number matching behavior is preserved.

## Error and Safety Rules

- Never post a callback with an unknown unit reference automatically.
- Never post a callback when the reference maps to multiple active tenants.
- Never post a water reference for a tenant or unit without water billing enabled.
- Never post the same provider transaction twice.
- Preserve failed and unmatched callbacks for review; do not discard them after returning an accepted callback response.
- Do not trust the callback phone number as the tenant identity. The account reference is authoritative, with the phone number retained for audit and review.
- Amounts must be positive and provider transaction IDs must be present.
- Manual resolution must require an explicit staff user and write an audit event containing the original reference, selected tenant, payment type, and payment ID.

## Data Model

Extend the existing business configuration storage with PayBill fields, or add a dedicated singleton payment configuration table if the current schema cannot safely accommodate typed fields. Keep the configuration singleton scoped to the property because this deployment uses one landlord PayBill for all units.

Extend the existing `mpesa_transactions` record with a payment kind or related payment ID as needed so both rent and water postings can be traced back to the original callback. Preserve the existing `rent_payment_id` field for compatibility and add a water payment link rather than changing its meaning.

Use a migration that is safe on an existing production database and leaves all existing transactions unchanged.

## API Shape

- Authenticated configuration endpoint for staff and tenant-safe read-only payment instructions.
- C2B callback endpoint for PayBill confirmations.
- Authenticated staff endpoints to list, inspect, resolve, or ignore unmatched transactions.
- Existing portal payment endpoints remain compatible.

Responses should distinguish `POSTED`, `UNMATCHED`, `AMBIGUOUS`, `DUPLICATE`, and `FAILED` states. Callback responses must remain compatible with Safaricom's expected confirmation shape.

## Testing

Add focused tests for:

- Rent reference parsing.
- Water reference parsing.
- Case and whitespace normalization.
- Unknown, duplicate, ambiguous, and water-disabled references.
- Correct creation of rent versus water payments.
- Configuration validation and tenant-safe response shaping.
- Staff resolution audit records.
- Callback idempotency.

Run backend type checks, frontend type checks, unit tests, production builds, and the live verification suite before deployment.

## Non-Goals

- No separate PayBill per landlord or property in this iteration.
- No automatic payment allocation across multiple months.
- No tenant-edited account references.
- No replacement of STK Push.
- No handling of landlord withdrawals, statements, or reconciliation with the landlord's bank account.