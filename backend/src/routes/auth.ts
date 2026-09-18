import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { queryOne } from '../config/db';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { unauthorized } from '../utils/httpError';
import { asyncHandler } from '../utils/asyncHandler';
import { logAudit } from '../services/auditService';
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
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
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
      payload = jwt.verify(token, env.jwtSecret, { ignoreExpiration: true }) as unknown as { sub: number; exp?: number };
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
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
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

export default router;