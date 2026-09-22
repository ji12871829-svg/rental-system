import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, queryOne } from '../config/db';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { STAFF_JWT_AUDIENCE } from '../middleware/portalAuth';
import { loginLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { unauthorized } from '../utils/httpError';
import { asyncHandler } from '../utils/asyncHandler';
import { logAudit } from '../services/auditService';
import { isTest } from '../config/env';
import { prepareForStaffRequest, sendEmailNotification } from '../services/emailService';
import { clearAuthCookies, setAuthCookies, readCookies, SESSION_COOKIE } from '../utils/authCookies';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await queryOne<{
      id: number; name: string; email: string; phone: string | null;
      password_hash: string; role: 'ADMIN' | 'PROPERTY_MANAGER' | 'STAFF'; status: string;
    }>(
      'SELECT id, name, email, phone, password_hash, role, status FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw unauthorized('Invalid email or password.');
    }
    if (user.status !== 'ACTIVE') {
      throw unauthorized('Account is inactive. Contact the administrator.');
    }
    const token = jwt.sign(
      { sub: user.id, role: user.role, name: user.name, email: user.email },
      env.jwtStaffSecret,
      {
        expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
        // Disjoint audiences: staff tokens and tenant-portal tokens share a
        // signing secret, so the audience claim is what keeps the two auth
        // domains apart. requireAuth verifies with this exact audience.
        audience: STAFF_JWT_AUDIENCE,
      }
    );
    await logAudit({
      userId: user.id,
      action: 'LOGIN',
      entity: 'users',
      entityId: user.id,
    });
    setAuthCookies(res, token);
    res.json({
      data: {
        // Retained for existing API clients during the cookie migration. The
        // browser client uses the HttpOnly cookie and ignores this value.
        token,
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
      },
    });
  })
);

// Sliding-session renewal: issues a fresh lease for the same session without
// a re-login. The keepalive client calls this proactively (~30 min before
// expiry); it also accepts a token up to GRACE past expiry so a tab that
// slept through the deadline self-heals on its next use. Anything older is a
// real expiry and forces a fresh login. Access is still gated by the ACTIVE
// user check below and on every request — the grace only smooths renewal.
const REFRESH_GRACE_SECONDS = 24 * 60 * 60;

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = readCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) throw unauthorized('No session to refresh.');

    let payload: { sub: number; exp?: number };
    try {
      // Audience pinned even under ignoreExpiration — a portal token (or any
      // wrong-audience token) must not ride the grace window into a fresh
      // staff session for whatever users.id its sub collides with.
      // ignoreExpiration is safe only because the staff key AND audience are
      // both pinned here — the grace path must stay unreachable for any
      // token minted outside the staff population.
      payload = jwt.verify(token, env.jwtStaffSecret, { ignoreExpiration: true, audience: STAFF_JWT_AUDIENCE }) as unknown as { sub: number; exp?: number };
    } catch {
      throw unauthorized('Invalid session.');
    }
    const expiredAgoSeconds = Date.now() / 1000 - (payload.exp ?? 0);
    if (expiredAgoSeconds > REFRESH_GRACE_SECONDS) {
      throw unauthorized('Session expired. Please sign in again.');
    }

    const user = await queryOne<
      { id: number; name: string; email: string; role: 'ADMIN' | 'PROPERTY_MANAGER' | 'STAFF'; status: string }
    >('SELECT id, name, email, role, status FROM users WHERE id = $1', [payload.sub]);
    if (!user || user.status !== 'ACTIVE') {
      throw unauthorized('Account is no longer active.');
    }

    const fresh = jwt.sign(
      { sub: user.id, role: user.role, name: user.name, email: user.email },
      env.jwtStaffSecret,
      {
        expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
        audience: STAFF_JWT_AUDIENCE,
      }
    );
    setAuthCookies(res, fresh);
    res.json({ data: { user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
  })
);

router.post('/logout', requireAuth, (_req, res) => {
  clearAuthCookies(res);
  res.json({ data: { message: 'Logged out.' } });
});

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: req.user });
}));

// ---------------------------------------------------------------------------
// Public landlord/agent signup ("Create account" on the landing page).
//
// Two regimes, decided by whether any staff user exists:
//
//   * Empty users table (fresh install) → the first signup IS the operator:
//     created as an ACTIVE ADMIN and signed in immediately. There are no
//     seeded credentials anywhere in this system, so this is the one door
//     that opens without an existing account.
//   * Any user exists → this is a REQUEST, not an account: an INACTIVE
//     PROPERTY_MANAGER row that no one can sign in with until an existing
//     admin activates it in Settings → Users. Self-serve onboarding stays
//     open while every staff login remains admin-vouched — an attacker can
//     at worst create inert rows, never a working session.
// ---------------------------------------------------------------------------
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(150),
  email: z.string().email(),
  phone: z.string().trim().max(30).optional(),
  // Min 8 (no MFA yet — the sheet would prefer 15, but the staff creators
  // share the same policy), max 128 so bcrypt cost can't be weaponized.
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
});

// Same timing-equalizer trick as the tenant signup: duplicate-email and
// other early exits burn one bcrypt compare so probing by response time
// can't distinguish "email already registered" from "email is new".
const TIMING_DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-password', env.bcryptSaltRounds);

router.post(
  '/register',
  loginLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, phone, password } = req.body as z.infer<typeof registerSchema>;
    const normalized = email.toLowerCase();

    const existing = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = $1', [normalized]);
    if (existing) {
      // Burn the bcrypt cost, then answer with the SAME generic body and
      // status a successful request gets — the response must not confirm
      // whether the email already has an account (user enumeration via the
      // registration form is called out explicitly in the OWASP sheet).
      await bcrypt.compare(password, TIMING_DUMMY_HASH).catch(() => false);
      return res.status(201).json({
        data: {
          message: 'Request received. An administrator will review and activate your account, then you can sign in.',
        },
      });
    }

    const hash = await bcrypt.hash(password, env.bcryptSaltRounds);

    // Bootstrap decision: the first-ever signup becomes the ACTIVE admin and
    // gets a session; everyone after is an INACTIVE manager request. The
    // count is taken AFTER the duplicate-email check and BEFORE the insert;
    // the unique(email) constraint makes a double-submit race safe — the
    // loser hits the unique violation and surfaces as a 500, never two
    // admins.
    const userCount = await queryOne<{ count: string }>('SELECT count(*)::text AS count FROM users');
    const isFirstUser = (userCount?.count ?? '1') === '0';

    const inserted = await query(
      `INSERT INTO users (name, email, phone, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      isFirstUser
        ? [name, normalized, phone || null, hash, 'ADMIN', 'ACTIVE']
        : [name, normalized, phone || null, hash, 'PROPERTY_MANAGER', 'INACTIVE'],
    );
    await logAudit({
      userId: null,
      action: isFirstUser ? 'STAFF_SIGNUP_BOOTSTRAP' : 'STAFF_SIGNUP_REQUEST',
      entity: 'users',
      entityId: inserted[0].id,
      newValue: { email: normalized, name, role: isFirstUser ? 'ADMIN' : 'PROPERTY_MANAGER' },
    });

    // Notify the operator through the standard email queue so the request
    // never sits unnoticed in Users. Queued AFTER the audit log; dispatched
    // best-effort via setTimeout(0) so a provider outage can neither fail
    // the public signup (the account row already exists and is audited) nor
    // delay the response. In tests the queue happens but the provider call
    // is skipped (isTest mirrors dispatchAutoEmail) so assertions can run
    // on the PENDING row. A skipped queue (no branding contact email) is
    // silent — the Users page remains the fallback.
    //
    // The bootstrap signup (first user) skips this entirely: there is no
    // operator yet, and the account is already ACTIVE.
    if (!isFirstUser) {
      let staffRequestId: number | null = null;
      try {
        const prepared = await prepareForStaffRequest({ name, email: normalized, phone: phone ?? null });
        staffRequestId = prepared?.id ?? null;
      } catch (err) {
        console.error(`[auth] staff-request email queue failed: ${(err as Error).message}`);
      }
      if (staffRequestId != null && !isTest) {
        setTimeout(() => {
          sendEmailNotification(staffRequestId as number).catch((err) =>
            console.error(`[auth] staff-request email send failed: ${(err as Error).message}`),
          );
        }, 0);
      }
    }

    if (isFirstUser) {
      // The operator's account is live immediately — hand them their session
      // (same cookie shape as /login) so they land on the dashboard instead
      // of a dead end. No email goes out: there is nobody to notify.
      const token = jwt.sign(
        { sub: inserted[0].id, role: 'ADMIN', name, email: normalized },
        env.jwtStaffSecret,
        {
          expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
          audience: STAFF_JWT_AUDIENCE,
        }
      );
      await logAudit({ userId: inserted[0].id, action: 'LOGIN', entity: 'users', entityId: inserted[0].id });
      setAuthCookies(res, token);
      return res.status(201).json({
        data: {
          message: 'Welcome! Your administrator account is ready.',
          bootstrap: true,
          user: { id: inserted[0].id, name, email: normalized, role: 'ADMIN' },
        },
      });
    }

    res.status(201).json({
      data: {
        message: 'Request received. An administrator will review and activate your account, then you can sign in.',
      },
    });
  })
);

export default router;