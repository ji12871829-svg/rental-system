import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';
import { query, queryOne } from '../config/db';
import { PORTAL_JWT_AUDIENCE, requireTenant } from '../middleware/portalAuth';
import { loginLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { badRequest, conflict, unauthorized } from '../utils/httpError';
import {
  PORTAL_COOKIE,
  clearPortalCookies,
  readCookies,
  setPortalCookies,
} from '../utils/authCookies';
import {
  getPortalIdentity,
  getPortalPaymentInstructions,
  getPortalPayments,
  getPortalReceipts,
  getPortalSummary,
  getPortalWaterReadings,
  portalLogin,
  portalStatementPdf,
} from '../services/tenantPortalService';
import { logAudit } from '../services/auditService';

const router = Router();

// ---------------------------------------------------------------------------
// Tenant-side portal (mounted at /api/portal)
// ---------------------------------------------------------------------------

const portalLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Self-service signup: a tenant whose record already exists (staff entered
// them with an email) claims portal access with that email. The unit field
// is optional and only used to disambiguate the rare case of several ACTIVE
// tenants sharing one email — it never grants anything by itself.
const portalRegisterSchema = z.object({
  email: z.string().email(),
  // Max length cap: bcrypt at cost 12 on unbounded input is a DoS vector
  // (OWASP Authentication Cheat Sheet — password length limits). 128 is
  // generous for passphrases while bounding the hash work.
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  unit: z.string().trim().max(20).optional(),
});

// One-time dummy hash so every early-exit path in /register can burn the
// same bcrypt cost as the success path — without it, response timing would
// separate "email has a tenancy" from "email does not", an enumeration
// oracle (OWASP: avoid quick-exit timing discrepancies).
const TIMING_DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-password', env.bcryptSaltRounds);

// Public: tenant login. Same rate limiter and audit treatment as staff login.
// Public: tenant self-registration ("Create account" on the landing page).
// Requires the email to match an ACTIVE staff-entered tenant record without
// existing portal access — it claims access, it never creates tenancies.
router.post('/register', loginLimiter, validateBody(portalRegisterSchema), asyncHandler(async (req, res) => {
  const { email, password, unit } = req.body as z.infer<typeof portalRegisterSchema>;
  const normalized = email.toLowerCase();

  const candidates = await query<{ id: number; tenant_id: number; full_name: string; unit_number: string | null }>(
    `SELECT t.id, t.id AS tenant_id, t.full_name, u.unit_number
     FROM tenants t
     LEFT JOIN units u ON u.id = t.unit_id
     WHERE lower(t.email) = $1 AND t.status = 'ACTIVE'
     ORDER BY t.created_at DESC`,
    [normalized],
  );
  if (candidates.length === 0) {
    // Burn the same bcrypt cost as the success path before answering, so
    // probing emails by response time learns nothing.
    await bcrypt.compare(password, TIMING_DUMMY_HASH).catch(() => false);
    // Deliberately not a 404-style "email unknown" hint beyond what the flow
    // already implies — the page explains tenants must be added by staff.
    throw badRequest('No active tenancy was found for this email. Ask your property manager to add you as a tenant with this email address first.');
  }
  if (candidates.length > 1 && unit) {
    const wanted = unit.trim().toLowerCase();
    const match = candidates.find((c) => (c.unit_number ?? '').toLowerCase() === wanted);
    if (match) candidates.unshift(match);
  }
  const tenant = candidates[0];

  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM tenant_portal_access WHERE tenant_id = $1 OR email = $2',
    [tenant.tenant_id, normalized],
  );
  if (existing) {
    // Same timing treatment for the "already claimed" path.
    await bcrypt.compare(password, TIMING_DUMMY_HASH).catch(() => false);
    throw conflict('Portal access has already been set up for this email. Sign in instead.', 'PORTAL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
  await query(
    `INSERT INTO tenant_portal_access (tenant_id, email, password_hash, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [tenant.tenant_id, normalized, passwordHash],
  );
  await logAudit({
    userId: null,
    action: 'PORTAL_SELF_REGISTER',
    entity: 'tenant_portal_access',
    entityId: tenant.tenant_id,
    newValue: { email: normalized },
  });

  // Straight into the portal — the account is real the moment it is created.
  const token = jwt.sign(
    { sub: tenant.tenant_id, email: normalized, name: tenant.full_name },
    env.jwtPortalSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'], audience: PORTAL_JWT_AUDIENCE }
  );
  setPortalCookies(res, token);
  res.status(201).json({ data: { name: tenant.full_name, email: normalized } });
}));

router.post('/login', loginLimiter, validateBody(portalLoginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body as z.infer<typeof portalLoginSchema>;
  const result = await portalLogin(email, password);
  const token = jwt.sign(
    { sub: result.tenantId, email: result.email, name: result.name },
    env.jwtPortalSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'], audience: PORTAL_JWT_AUDIENCE }
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

router.get('/payment-instructions', requireTenant, asyncHandler(async (req, res) => {
  res.json({ data: await getPortalPaymentInstructions(req.tenant!.tenantId) });
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

// Payments are now "send money" only: the tenant copies the PayBill/account
// details from /payment-instructions and sends the money from M-Pesa. The
// office-side reconciliation paths (C2B callback auto-match, or manual entry
// by staff with the M-Pesa reference) post the actual payment — a tenant can
// still never post one directly.

// Sliding-session renewal for the tenant portal — same grace semantics as
// staff /api/auth/refresh: keepalive renews before expiry; a tab that slept
// past its lease gets one last chance within the grace window, then a real
// re-login. requireTenant re-checks the portal row + tenant status on every
// request, so revocation always wins over grace.
const REFRESH_GRACE_SECONDS = 24 * 60 * 60;

router.post('/refresh', asyncHandler(async (req, res) => {
  const token = readCookies(req.headers.cookie)[PORTAL_COOKIE];
  if (!token) throw unauthorized('No portal session to refresh.');

  let payload: { sub: number; email?: string; name?: string; exp?: number; aud?: string };
  try {
    // ignoreExpiration is safe only because the portal key AND audience are
    // both checked here — the grace path must stay unreachable for any
    // token minted outside the portal population.
    payload = jwt.verify(token, env.jwtPortalSecret, { ignoreExpiration: true }) as unknown as { sub: number; email?: string; name?: string; exp?: number; aud?: string };
    if (payload.aud !== PORTAL_JWT_AUDIENCE) throw new Error('wrong audience');
  } catch {
    throw unauthorized('Invalid portal session.');
  }
  if (!payload.email || !payload.name) {
    throw unauthorized('Invalid portal session.');
  }
  const expiredAgoSeconds = Date.now() / 1000 - (payload.exp ?? 0);
 if (expiredAgoSeconds > REFRESH_GRACE_SECONDS) {
    throw unauthorized('Portal session expired. Please sign in again.');
  }

  // Same checks as login — a disabled access row or moved-out tenant cannot
  // ride the grace window back into the portal.
  const row = await queryOne<{ status: string; tenant_status: string }>(
    `SELECT a.status, t.status AS tenant_status
     FROM tenant_portal_access a
     JOIN tenants t ON t.id = a.tenant_id
     WHERE a.tenant_id = $1`,
    [payload.sub]
  );
  if (!row || row.status !== 'ACTIVE' || row.tenant_status !== 'ACTIVE') {
    throw unauthorized('This portal account is no longer active.');
  }

  const fresh = jwt.sign(
    { sub: payload.sub, email: payload.email, name: payload.name },
    env.jwtPortalSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'], audience: PORTAL_JWT_AUDIENCE }
  );
  setPortalCookies(res, fresh);
  res.json({ data: { ok: true } });
}));

// Identity is needed by the shell after login; kept last for readability.
router.get('/identity', requireTenant, asyncHandler(async (req, res) => {
  res.json({ data: await getPortalIdentity(req.tenant!.tenantId) });
}));

export default router;
