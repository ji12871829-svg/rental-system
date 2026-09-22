import { Router } from 'express';
import { z } from 'zod';
import { adminOnly, managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings } from '../services/settingsService';
import { createTenant, deleteTenant, getTenant, listTenants, moveOutTenant, transferTenant, updateTenant } from '../services/tenantService';
import { disablePortalAccess, getPortalAccess, issuePortalAccess } from '../services/tenantPortalService';
import {
  buildDataRequestLetter,
  eraseTenantPersonalData,
  exportTenantPersonalData,
  exportTenantPersonalDataCsv,
} from '../services/privacyService';
import { prepareForDataRequestLetter, prepareForPortalCredentials, sendEmailNotification } from '../services/emailService';
import { renderDataLetterEmail, renderDataLetterPdf, dataEnclosureName, dataLetterPdfName } from '../utils/dataRequestLetter';

const router = Router();
router.use(requireAuth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.enum(['ACTIVE', 'MOVED_OUT']).optional(),
  unitId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listTenants({ page: q.page, limit: q.limit, status: q.status, unitId: q.unitId, q: q.q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const createSchema = z.object({
  unitId: z.number().int().positive().nullable().optional(),
  fullName: z.string().min(2),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  securityDeposit: z.number().min(0).optional(),
  notes: z.string().optional(),
});

router.post('/', managerOrAdmin, validateBody(createSchema), asyncHandler(async (req, res) => {
  const row = await createTenant(req.body as any, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get('/:id', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const row = await getTenant(Number(req.params.id), settings.reporting_year);
  res.json({ data: row });
}));

const updateSchema = z.object({
  unitId: z.number().int().positive().nullable().optional(),
  fullName: z.string().min(2).optional(),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  securityDeposit: z.number().min(0).optional(),
  notes: z.string().optional(),
});

router.put('/:id', managerOrAdmin, validateParams(paramsSchema), validateBody(updateSchema), asyncHandler(async (req, res) => {
  const row = await updateTenant(Number(req.params.id), req.body as any, req.user!.userId);
  res.json({ data: row });
}));

const transferSchema = z.object({ newUnitId: z.number().int().positive() });
router.post('/:id/transfer', managerOrAdmin, validateParams(paramsSchema), validateBody(transferSchema), asyncHandler(async (req, res) => {
  const row = await transferTenant(Number(req.params.id), (req.body as any).newUnitId, req.user!.userId);
  res.json({ data: row });
}));

const moveOutSchema = z.object({ moveOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
router.post('/:id/move-out', managerOrAdmin, validateParams(paramsSchema), validateBody(moveOutSchema), asyncHandler(async (req, res) => {
  const row = await moveOutTenant(Number(req.params.id), (req.body as any).moveOutDate, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/:id', adminOnly, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteTenant(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

// --- Tenant portal access (manager/admin) ------------------------------------
// Credentials for the tenant-facing self-service portal. Issuing is
// idempotent — it rotates the password and re-enables a disabled account, so
// "forgot password" and "grant access" are the same action. Disabling is
// soft (the row stays for the audit trail) and takes effect on the tenant's
// very next request.
const portalAccessSchema = z.object({
  // Both optional: omit them and the route issues access with the tenant's
  // own email and a generated one-time password (the common case — one click
  // from the Tenants page). Passing them allows a custom login or password.
  email: z.string().email().optional(),
  // Minimum length only — complexity rules just push tenants toward
  // predictable patterns; the portal is rate-limited and staff-issued.
  password: z.string().min(8, 'Password must be at least 8 characters.').optional(),
  // Default true: the generated one-time password is emailed to the tenant
  // automatically. Only skipped when staff choose "share it myself" — or
  // when a custom password is supplied (staff already knows it).
  deliverEmail: z.boolean().optional(),
});

router.post('/:id/portal-access', managerOrAdmin, validateParams(paramsSchema), validateBody(portalAccessSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof portalAccessSchema>;
  const row = await issuePortalAccess(
    Number(req.params.id),
    req.user!.userId,
    body.email,
    body.password
  );

  // Credential delivery: the generated one-time password goes straight to
  // the tenant's login email so it never needs manual sharing. A custom
  // password (staff-chosen) is deliberately not emailed — the issuer already
  // has it. Delivery is recorded in email_notifications with the same
  // PENDING/SENT/FAILED lifecycle as every other email; a failure never
  // undoes the access grant, but IS reported back so staff can fall back to
  // showing the password or resending from the email history.
  let credentialsEmailed: 'sent' | 'pending' | 'failed' | 'skipped' = 'skipped';
  const shouldDeliver = (body.deliverEmail ?? true) && row.generatedPassword !== undefined;
  if (shouldDeliver) {
    try {
      const pending = await prepareForPortalCredentials({
        tenantId: row.tenant_id,
        tenantName: row.tenantName,
        loginEmail: row.email,
        password: row.generatedPassword!,
      });
      try {
        const sent = await sendEmailNotification(pending.id);
        credentialsEmailed = sent.status === 'SENT' ? 'sent' : 'failed';
      } catch {
        credentialsEmailed = 'pending'; // row stays PENDING — resend from history
      }
    } catch (err) {
      credentialsEmailed = 'failed';
      console.error(`[portal] credential email failed for tenant ${row.tenant_id}: ${(err as Error).message}`);
    }
  }

  res.status(201).json({
    data: {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      status: row.status,
      lastLoginAt: row.last_login_at,
      // Present only when the server generated the password. Never stored in
      // plaintext — shown once to the issuing staff user and gone.
      temporaryPassword: row.generatedPassword,
      credentialsEmailed,
    },
  });
}));

router.get('/:id/portal-access', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const row = await getPortalAccess(Number(req.params.id));
  res.json({ data: row ? { id: row.id, tenantId: row.tenant_id, email: row.email, status: row.status, lastLoginAt: row.last_login_at, createdAt: row.created_at } : null });
}));

router.delete('/:id/portal-access', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await disablePortalAccess(Number(req.params.id), req.user!.userId);
  res.json({ data: { message: 'Portal access disabled.' } });
}));

// --- Data-subject rights (Kenya DPA 2019 / GDPR) — admin only ----------------

// Every request must state who requested it and why — the privacy register
// (privacy_requests table, GET /api/privacy-requests) records the trail.
const registerMetaSchema = z.object({
  requester: z.string().min(2).max(120),
  reason: z.string().min(2).max(500),
});

// The email variant always delivers an already-generated letter — it reuses
// that letter's register reference, so no requester/reason is needed (and no
// duplicate register entry is written).
const emailLetterSchema = z.object({
  registerRef: z.string().regex(/^DSAR-\d+$/),
});

// Right of access / portability: everything the system holds about one
// tenant, as a downloadable JSON bundle. GET with a body is unusual, so the
// requester/reason travel as query parameters here.
router.get('/:id/data-export', adminOnly, validateParams(paramsSchema), validateQuery(registerMetaSchema), asyncHandler(async (req, res) => {
  const bundle = await exportTenantPersonalData(Number(req.params.id), {
    requester: req.query.requester as string,
    reason: req.query.reason as string,
    performedBy: req.user!.userId,
  });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tenant-${req.params.id}-personal-data.json"`);
  res.json(bundle);
}));

// Same data as the JSON export, flattened to a filterable CSV spreadsheet.
router.get('/:id/data-export.csv', adminOnly, validateParams(paramsSchema), validateQuery(registerMetaSchema), asyncHandler(async (req, res) => {
  const csv = await exportTenantPersonalDataCsv(Number(req.params.id), {
    requester: req.query.requester as string,
    reason: req.query.reason as string,
    performedBy: req.user!.userId,
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tenant-${req.params.id}-personal-data.csv"`);
  res.send(csv);
}));

// Formal data-request response letter: the same export bundle, plus the
// register reference and the business identity for the letterhead. Returns
// JSON (the frontend renders the printable letter and offers the bundle as
// the downloadable enclosure). The register entry is written here — once.
router.post('/:id/data-request-letter', adminOnly, validateParams(paramsSchema), validateBody(registerMetaSchema), asyncHandler(async (req, res) => {
  const letter = await buildDataRequestLetter(Number(req.params.id), {
    requester: (req.body as { requester: string }).requester,
    reason: (req.body as { reason: string }).reason,
    performedBy: req.user!.userId,
  });
  res.json({ data: letter });
}));

// Emails the data-request response letter (server-rendered email body with
// the export summary) with the tenant's complete JSON data export attached
// as the data file. Pass registerRef from a previously generated letter to
// reuse its register entry — otherwise a new entry is written (exactly once
// per letter). The send is synchronous: PENDING → SENT/FAILED within the request.
router.post('/:id/data-request-letter/email', adminOnly, validateParams(paramsSchema), validateBody(emailLetterSchema), asyncHandler(async (req, res) => {
  const tenantId = Number(req.params.id);
  const body = req.body as { registerRef: string };
  const letter = await buildDataRequestLetter(
    tenantId,
    null,
    body.registerRef
  );

  const tenantEmail = (letter.bundle.subject as { email?: string | null }).email ?? null;
  if (!tenantEmail) {
    res.status(422).json({
      error: 'TENANT_NO_EMAIL',
      message: 'This tenant has no email address on file. Print the letter instead, or add an email to the tenant record.',
      details: {},
    });
    return;
  }

  const rendered = renderDataLetterEmail(letter);
  // The formal letter as a printable PDF — attached alongside the JSON data
  // file so the emailed response is a professional document, not just HTML.
  const letterPdfBytes = await renderDataLetterPdf(letter);
  const prepared = await prepareForDataRequestLetter({
    tenantId,
    tenantName: String((letter.bundle.subject as { full_name?: string }).full_name ?? 'data subject'),
    tenantEmail,
    registerRef: letter.registerRef,
    generatedAt: letter.generatedAt,
    responseDays: letter.responseDays,
    letterHtml: rendered.html,
    enclosureName: dataEnclosureName(tenantId),
    enclosureJson: JSON.stringify(letter.bundle, null, 2),
    letterPdf: {
      name: dataLetterPdfName(letter.registerRef),
      base64: Buffer.from(letterPdfBytes).toString('base64'),
    },
  });
  const sent = await sendEmailNotification(prepared.id);
  res.status(201).json({
    data: {
      registerRef: letter.registerRef,
      emailId: sent.id,
      emailStatus: sent.status,
      failureReason: sent.failure_reason ?? null,
      sentTo: sent.email_address,
    },
  });
}));

// Right to erasure: anonymise personal identifiers (financial records are
// retained and the tenancy must already have ended).
router.post('/:id/erase-personal-data', adminOnly, validateParams(paramsSchema), validateBody(registerMetaSchema), asyncHandler(async (req, res) => {
  const result = await eraseTenantPersonalData(Number(req.params.id), {
    ...req.body as { requester: string; reason: string },
    userId: req.user!.userId,
  });
  res.json({ data: result });
}));

export default router;