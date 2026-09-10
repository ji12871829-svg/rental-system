# Water Meter Photo Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Let an authenticated manager upload a meter photo, identify the registered unit and tenant from the meter serial number, preview the calculated water bill and balance, and confirm the normal reading record.

**Architecture:** Store a normalized serial number on `units`. Add a backend OCR adapter boundary with a Google Cloud Vision REST implementation selected by configuration, plus a deterministic manual/unconfigured error path. Add preview and confirmation endpoints that reuse the existing `waterService` billing rules; the frontend supplies the image and displays the server preview before saving.

**Tech Stack:** Express + TypeScript, PostgreSQL, Zod, Multer, Google Cloud Vision REST API, React + Vite + Tailwind, Jest + Supertest.

## Global Constraints

- Exact serial matching after trimming whitespace and uppercasing; no fuzzy matching for billing identity.
- OCR output is never trusted directly by the client; preview and confirmation validate identity and readings on the server.
- Existing manual reading entry and `computeWaterBill` behavior must remain unchanged.
- Images are processed transiently and are not persisted by this feature.
- Uploads require authentication, image MIME validation, and a 5 MB maximum size.
- The OCR API key remains backend-only in environment configuration.

---

### Task 1: Add meter serial storage and unit API support

**Files:**
- Modify: `database/schema.sql`
- Modify: `backend/src/types.ts`
- Modify: `backend/src/services/unitService.ts`
- Modify: `backend/src/routes/units.ts`
- Test: `backend/tests/unit/unitSerial.test.ts`

**Interfaces:**
- Unit create/update input accepts `meterSerialNumber?: string | null`.
- Unit list/detail responses expose `meter_serial_number`.
- Database column is nullable and unique, allowing setup before a unit is connected to a meter.

- [ ] **Step 1: Add the database column and unique index**

Add `meter_serial_number VARCHAR(80)` to `units`, then add a unique index over `UPPER(BTRIM(meter_serial_number))` with a predicate excluding null and blank values. Keep the column nullable so existing seed data remains valid.

- [ ] **Step 2: Extend unit validation and service writes**

Normalize a supplied serial with `trim().toUpperCase()`, convert an empty value to null, validate the length, and include it in create/update SQL. Translate unique violations to a stable `DUPLICATE_METER_SERIAL` conflict.

- [ ] **Step 3: Add service tests**

Mock database calls and verify normalization, null handling, and duplicate conflict mapping without changing unrelated unit behavior.

- [ ] **Step 4: Run the focused backend checks**

Run `npm run typecheck` and `npm test -- --runInBand tests/unit/unitSerial.test.ts` from `backend`. Expected result: all existing tests plus the new serial tests pass.

### Task 2: Build the OCR adapter and scan preview service

**Files:**
- Modify: `backend/src/config/env.ts`
- Create: `backend/src/services/meterOcrService.ts`
- Modify: `backend/src/services/waterService.ts`
- Test: `backend/tests/unit/meterOcrService.test.ts`
- Test: `backend/tests/unit/waterService.test.ts`

**Interfaces:**
- `extractMeterFields(image: Buffer, mimeType: string): Promise<{ serialNumber: string | null; currentReading: number | null; confidence: number | null }>`.
- `previewPhotoReading(input, userId): Promise<WaterPhotoPreview>` returns matched unit, active tenant, extracted values, bill, total paid, and balance without inserting a reading.

- [ ] **Step 1: Define OCR configuration and adapter types**

Add `OCR_PROVIDER` and `GOOGLE_VISION_API_KEY` to environment configuration. Support `google-vision` and `none`; the latter returns a clear `OCR_NOT_CONFIGURED` error instead of pretending scanning succeeded.

- [ ] **Step 2: Implement Google Vision REST extraction**

Base64-encode the in-memory image and call the Vision `DOCUMENT_TEXT_DETECTION` endpoint with the backend key. Normalize OCR text by extracting a serial candidate from labeled serial/meter-number lines and a numeric reading candidate from labeled reading/index lines. Return null for missing fields and reject provider/network failures as a scan error.

- [ ] **Step 3: Implement server-side preview calculation**

Match the normalized serial against `UPPER(BTRIM(u.meter_serial_number))`, require a water-enabled unit, load the active tenant, load the previous chronological reading, call `computeWaterBill`, and aggregate water payments for the requested billing month/year. Return a preview object with explicit `needsConfirmation` and field-confidence information. Do not insert a reading.

- [ ] **Step 4: Add unit tests**

Mock `fetch` for successful OCR, malformed provider responses, missing fields, and provider failure. Mock database and billing dependencies for unknown serials, non-water units, no tenant, below-previous readings, and a correct bill/balance preview.

- [ ] **Step 5: Run focused service tests**

Run `npm test -- --runInBand tests/unit/meterOcrService.test.ts tests/unit/waterService.test.ts`. Expected result: all cases pass.

### Task 3: Add authenticated preview and confirmation routes

**Files:**
- Modify: `backend/src/routes/water.ts`
- Modify: `backend/src/services/waterService.ts`
- Modify: `backend/src/app.ts` if upload middleware registration is required there
- Modify: `backend/package.json`
- Test: `backend/tests/integration/waterPhoto.test.ts`

**Interfaces:**
- `POST /api/water/readings/photo-preview` accepts multipart field `photo` plus `readingDate`, `billingMonth`, and `billingYear` and returns the preview.
- `POST /api/water/readings/photo-confirm` accepts the preview token/identity fields and creates the same reading record as manual entry.

- [ ] **Step 1: Add the multipart dependency and upload limits**

Install Multer and configure a memory-storage upload with a one-file, 5 MB limit. Accept only `image/jpeg`, `image/png`, and `image/webp`; reject missing or invalid files before OCR.

- [ ] **Step 2: Add Zod schemas and preview route**

Validate ISO date and billing month/year, require authentication through the existing router middleware, call `previewPhotoReading`, and return structured errors for upload, OCR, matching, and billing failures.

- [ ] **Step 3: Add confirmation route with revalidation**

Accept the matched unit ID, normalized serial, current reading, date, and billing period. Re-query the serial-to-unit mapping, reject changed identity, then call `createReading` so duplicate protection, previous-reading behavior, audit logging, and bill arithmetic stay centralized.

- [ ] **Step 4: Add integration tests**

Cover unauthenticated access, invalid MIME/oversized upload, successful preview, unknown serial, successful confirmation, serial mismatch between preview and confirmation, and duplicate billing-period conflict. Mock the OCR adapter and database fixtures using the project’s existing integration setup.

- [ ] **Step 5: Run route and type validation**

Run `npm run typecheck` and `npm run test:integration -- waterPhoto.test.ts`. Expected result: the new route tests and existing integration suite pass.

### Task 4: Add the scan workflow to the Water Meter page

**Files:**
- Modify: `frontend/src/pages/WaterMeter.tsx`
- Modify: `frontend/src/lib/api.ts` only if it lacks multipart support

**Interfaces:**
- The page keeps the existing manual **Record Reading** flow unchanged.
- The new scan modal submits `FormData` to `/api/water/readings/photo-preview`, shows the matched tenant/unit and bill preview, and submits confirmation to `/api/water/readings/photo-confirm`.

- [ ] **Step 1: Add the scan entry point and capture control**

Add a camera-capable file input using `accept="image/*"` and `capture="environment"`. Show selected-image state, upload progress state, and a retry action without storing the image in application state longer than necessary.

- [ ] **Step 2: Add preview and correction fields**

Display serial, unit, tenant, extracted current reading, previous reading, consumption, rate, bill, paid amount, and balance. Allow correction of the current reading when OCR misses it, but keep the serial and matched unit read-only in the confirmation step.

- [ ] **Step 3: Add confirmation and error states**

Require an explicit confirmation before saving. Surface unknown serials, no active tenant, low-confidence/missing reading, duplicate period, and provider errors with actionable text. On success, close the modal, refresh the reading table, and show the returned bill message.

- [ ] **Step 4: Run the frontend checks**

Run the frontend package’s typecheck/build command from `frontend`. Expected result: no TypeScript or build errors, with manual reading entry still available.

### Task 5: Document configuration and verify end to end

**Files:**
- Modify: `backend/.env.example`
- Modify: `README.md`
- Test: backend unit/integration suites and frontend build

- [ ] **Step 1: Document OCR setup**

Document `OCR_PROVIDER=google-vision`, `GOOGLE_VISION_API_KEY`, allowed image types, the 5 MB limit, and the fact that photos are processed in memory and not stored in `README.md`.

- [ ] **Step 2: Run the complete verification set**

Run backend `npm test`, backend `npm run build`, and the frontend build. Confirm that manual readings, photo preview, photo confirmation, balance calculation, and duplicate protection all work with a configured OCR mock/provider.

- [ ] **Step 3: Review the final diff**

Check that no OCR key, uploaded image, generated build output, or unrelated project changes are included.