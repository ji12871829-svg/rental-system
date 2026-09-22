// Clerk → RPMS session bridge.
//
// The staff tab of /login renders Clerk's hosted sign-in when the publishable
// key is configured. Clerk then holds the session in ITS cookies — but the
// whole staff app (api.ts cookies, CSRF pair, keepalive refresh, role guards)
// speaks the legacy rpms_session JWT. Rather than teach every route two
// dialects, this one endpoint exchanges a VERIFIED Clerk session for exactly
// what POST /api/auth/login would have set: a staff JWT (aud 'staff_api')
// in the same HttpOnly cookie.
//
// Verification is NOT trusted from the browser: getAuth() re-validates the
// Clerk session server-side against CLERK_SECRET_KEY. The local users row —
// mapped in user_external_ids — still decides role and ACTIVE status; Clerk
// proves identity only. Unmapped or inactive users get 401 and stay logged
// out, exactly as with the password form.
import { Router } from 'express';
import { getAuth } from '@clerk/express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { queryOne } from '../config/db';
import { STAFF_JWT_AUDIENCE } from '../middleware/portalAuth';
import { asyncHandler } from '../utils/asyncHandler';
import { logAudit } from '../services/auditService';
import { setAuthCookies } from '../utils/authCookies';
import { unauthorized } from '../utils/httpError';

const router = Router();

// Mounted at /api/auth/clerk (app.ts) → full path /api/auth/clerk/session.
router.post(
  '/session',
  asyncHandler(async (req, res) => {
    if (!env.clerkSecretKey) {
      // Keys not configured → the bridge is closed; the legacy form is the
      // only door (matches the inert-clerkAuth contract).
      throw unauthorized('Clerk sign-in is not configured on this deployment.');
    }
    // clerkMiddleware() (mounted in app.ts) has already parsed cookies;
    // getAuth verifies the session against the secret key. Anything
    // missing/invalid → userId undefined → 401 below.
    const { userId } = getAuth(req);
    if (!userId) throw unauthorized('No active Clerk session.');

    const mapped = await queryOne<{
      id: number; name: string; email: string; role: 'ADMIN' | 'PROPERTY_MANAGER' | 'STAFF'; status: string;
    }>(
      `SELECT u.id, u.name, u.email, u.role, u.status
         FROM user_external_ids x JOIN users u ON u.id = x.user_id
        WHERE x.provider = 'clerk' AND x.external_id = $1`,
      [userId]
    );
    if (!mapped || mapped.status !== 'ACTIVE') {
      // Generic message — does not reveal whether the email mapped at all
      // (same no-enumeration posture as POST /api/auth/login).
      throw unauthorized('This account is not enabled for app access. Contact the administrator.');
    }

    const token = jwt.sign(
      { sub: mapped.id, role: mapped.role, name: mapped.name, email: mapped.email },
      env.jwtStaffSecret,
      {
        expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
        audience: STAFF_JWT_AUDIENCE,
      }
    );
    await logAudit({ userId: mapped.id, action: 'LOGIN', entity: 'users', entityId: mapped.id });
    setAuthCookies(res, token);
    res.json({
      data: {
        user: { id: mapped.id, name: mapped.name, email: mapped.email, role: mapped.role },
      },
    });
  })
);

export default router;
