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
    res.json({
      data: {
        token,
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
      },
    });
  })
);

router.post('/logout', requireAuth, (_req, res) => {
  // Stateless JWT — logout is client-side token discard. Endpoint exists for
  // API symmetry and future token-denylist support.
  res.json({ data: { message: 'Logged out.' } });
});

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: req.user });
}));

export default router;