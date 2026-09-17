import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';
import { requireTenant } from '../middleware/portalAuth';
import { loginLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  clearPortalCookies,
  setPortalCookies,
} from '../utils/authCookies';
import {
  getPortalIdentity,
  getPortalPayments,
  getPortalReceipts,
  getPortalSummary,
  getPortalWaterReadings,
  portalLogin,
  portalPayRent,
  portalStatementPdf,
} from '../services/tenantPortalService';
import { logAudit } from '../services/auditService';
import { badRequest } from '../utils/httpError';

const router = Router();

// ---------------------------------------------------------------------------
// Tenant-side portal (mounted at /api/portal)
// ---------------------------------------------------------------------------

const portalLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Public: tenant login. Same rate limiter and audit treatment as staff login.
router.post('/login', loginLimiter, validateBody(portalLoginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body as z.infer<typeof portalLoginSchema>;
  const result = await portalLogin(email, password);
  const token = jwt.sign(
    { sub: result.tenantId, email: result.email, name: result.name },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'], audience: 'tenant_portal' }
  );
  await logAudit({
    userId: null,
    action: 'TENANT_PORTAL_LOGIN',
    entity: 'tenant_portal_access',
    entityId: result.tenantId,
  });
  setPortalCookies(res, token);
  res.json({ data: { name: result.name, email: result.email } });
}));

router.post('/logout', (_req, res) => {
  clearPortalCookies(res);
  res.json({ data: { message: 'Logged out.' } });
});

router.get('/me', requireTenant, (req, res) => {
  res.json({ data: req.tenant });
});

// Everything below requires an active portal session; each handler scopes its
// queries by req.tenant.tenantId — there is no id parameter to tamper with.
router.get('/summary', requireTenant, asyncHandler(async (req, res) => {
  res.json({ data: await getPortalSummary(req.tenant!.tenantId) });
}));

router.get('/payments', requireTenant, asyncHandler(async (req, res) => {
  res.json({ data: await getPortalPayments(req.tenant!.tenantId) });
}));

router.get('/water', requireTenant, asyncHandler(async (req, res) => {
  res.json({ data: await getPortalWaterReadings(req.tenant!.tenantId) });
}));

router.get('/receipts', requireTenant, asyncHandler(async (req, res) => {
  res.json({ data: await getPortalReceipts(req.tenant!.tenantId) });
}));

// The tenant's own yearly statement — the same PDF the office can download.
router.get('/statement.pdf', requireTenant, asyncHandler(async (req, res) => {
  const { bytes, tenantName, year } = await portalStatementPdf(req.tenant!.tenantId);
  const safe = tenantName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'tenant';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="statement-${safe}-${year}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// The one tenant-initiated action: pay rent via M-Pesa STK Push to their own
// phone. The tenant never posts a payment directly — the provider callback
// confirms it, exactly like the office-initiated push.
const paySchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000),
});

router.post('/pay-rent', requireTenant, validateBody(paySchema), asyncHandler(async (req, res) => {
  const { amount } = req.body as z.infer<typeof paySchema>;
  try {
    const result = await portalPayRent(req.tenant!.tenantId, amount);
    res.status(202).json({ data: { ...result, message: 'Check your phone for the M-Pesa prompt and enter your PIN.' } });
  } catch (err) {
    // Provider errors (no phone, disabled unit, Daraja failure) surface as a
    // clean 400 rather than a 500.
    throw badRequest((err as Error).message);
  }
}));

// Identity is needed by the shell after login; kept last for readability.
router.get('/identity', requireTenant, asyncHandler(async (req, res) => {
  res.json({ data: await getPortalIdentity(req.tenant!.tenantId) });
}));

export default router;
