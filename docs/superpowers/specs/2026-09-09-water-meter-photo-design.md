# Water Meter Photo Billing Design

**Status:** Approved for planning

## Goal

Allow a property manager to photograph a water meter, identify the unit and active tenant from the meter serial number, read the current meter value, and preview the resulting water bill and balance before saving the reading.

## Existing Behavior

The Water Meter page currently requires the manager to select a water-enabled unit and enter the current reading manually. The backend derives the previous reading, consumption, bill, tenant, paid amount, and balance from existing unit, tenant, reading, and payment records.

There is currently no serial-number field on `units`, no image-upload endpoint, and no OCR integration.

## Proposed User Flow

1. An administrator assigns a unique meter serial number to a water-enabled unit.
2. On the Water Meter page, the manager chooses **Scan Meter Photo** and takes or uploads a photo containing the serial number and current reading.
3. The backend sends the image through the configured OCR adapter and normalizes the extracted serial number and reading.
4. The backend matches the serial number to the unit and its active tenant.
5. The system calculates the previous reading, consumption, water bill, total paid, and outstanding balance using the existing billing rules.
6. The UI displays the extracted values and billing preview for confirmation.
7. Only after confirmation does the system create the normal water-meter reading record.

## Architecture

### Meter identity

Add a unique nullable `meter_serial_number` to `units`. Serial numbers are stored as normalized uppercase values with surrounding whitespace removed. A unit can be configured without a serial number until it is ready for photo scanning. Matching must be exact after normalization; fuzzy matching is not used for billing identity.

### OCR boundary

Create an OCR adapter behind a small backend service interface. The water route must not depend directly on a vendor SDK. The adapter accepts an image upload and returns the serial number, current reading, and confidence/details when available. Provider configuration belongs in environment variables, and the system must return a clear configuration error when scanning is requested without a configured provider.

### Preview and save

Use a preview endpoint or preview service operation that performs identity lookup and calculation without inserting a reading. The existing `createReading` path remains the authoritative save path. The confirmed request must include the matched unit and extracted reading, and server-side validation must repeat the serial/unit match so the client cannot change the identity between preview and save.

### Billing reuse

Reuse `computeWaterBill`, automatic previous-reading lookup, and the existing water-payment aggregation. Do not duplicate bill arithmetic in the frontend or OCR adapter.

## Error Handling

- Unknown serial number: show that the meter is not registered and do not calculate a bill.
- Serial number mapped to a non-water-enabled unit: reject the scan.
- No active tenant: show the unit but require the manager to resolve occupancy before saving.
- Missing or low-confidence reading: allow manual correction in the preview, subject to normal validation.
- Reading below the previous value: use the existing validation message and do not save.
- Existing reading for the same unit and billing month: use the existing duplicate-reading conflict.
- Unsupported, oversized, or malformed image: reject before OCR with a clear upload error.
- OCR provider unavailable: report a temporary scan failure without creating billing data.

## Security and Privacy

- Require the same authenticated water-management permission as the existing water routes.
- Enforce file type and size limits and never build SQL from OCR output.
- Store the image only if an audit or review requirement is confirmed; otherwise process it transiently and retain only extracted values and audit metadata.
- Do not expose OCR provider credentials to the frontend.
- Audit serial-number assignment, scan preview, and confirmed reading creation.

## Testing

- Database migration/schema test for serial uniqueness and normalization behavior.
- Backend unit tests for serial matching, unknown serials, inactive tenants, OCR normalization, and preview calculations.
- Route tests for upload validation, authentication, provider failures, and duplicate readings.
- Frontend tests for camera/file selection, preview display, manual correction, confirmation, and error states.
- Regression tests confirming manual reading entry and existing balance calculations remain unchanged.

## Scope Exclusions

- Automatic billing without manager confirmation.
- Fuzzy serial-number matching.
- A new payment workflow; existing water-payment records remain the source of paid amounts.
- Retrofitting the legacy client or the other rental-management projects in this workspace.