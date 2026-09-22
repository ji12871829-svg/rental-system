// Public (unauthenticated) marketing endpoints backing the landing page.
//
// Deliberately tiny and read-mostly:
//
//   GET /api/public/units  — the operator's real unit roster, stripped to
//     marketing-safe fields (type, rent, occupancy). No tenant names, emails,
//     phones, unit ids or floor ids: the landing price table must never leak
//     who lives where or give attackers a unit inventory.
//
//   POST /api/public/demo-requests — "Request a demo" submissions. A request
//     confers nothing: it lands in demo_requests for the operator to read.
//     Throttled harder than login (abuse here is pure noise) and audited so
//     operators can see submissions in the activity trail.
//
// Both are mounted before the /api 404 guard and are exempt from CSRF the
// same way login is (no session exists yet / the GET mutates nothing).
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db';
import { logAudit } from '../services/auditService';
import { requestLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings } from '../services/settingsService';

const router = Router();

// Marketing price list: one row per unit TYPE with the price range and
// availability count. Grouped by type because the landing table sells
// "Bedsitter from KSh 8,000", not "Unit 4 = KSh 8,500, occupied by…".
// Only genuinely public columns are selected.
router.get('/units', asyncHandler(async (_req, res) => {
  const rows = await query<{ unit_type: string; min_rent: string; max_rent: string; total: string; vacant: string }>(
    `SELECT u.unit_type,
            MIN(u.monthly_rent)::text AS min_rent,
            MAX(u.monthly_rent)::text AS max_rent,
            COUNT(*)::text            AS total,
            COUNT(*) FILTER (WHERE u.occupancy_status = 'VACANT')::text AS vacant
     FROM units u
     GROUP BY u.unit_type
     ORDER BY MIN(u.monthly_rent) ASC`,
  );
  // The operator's display currency rides along so the landing table needs
  // no auth and no separate call (GET /api/settings requires a session).
  const { currency } = await getSettings();
  res.json({
    currency,
    data: rows.map((r) => ({
      unitType: r.unit_type,
      minRent: Number(r.min_rent),
      maxRent: Number(r.max_rent),
      total: Number(r.total),
      vacant: Number(r.vacant),
    })),
  });
}));

const demoRequestSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(150),
  email: z.string().email('Enter a valid email address.').max(255),
  phone: z.string().trim().max(30).optional(),
  propertyName: z.string().trim().max(200).optional(),
  unitsCount: z.enum(['', '1-5', '6-20', '21-50', '50+']).optional(),
  message: z.string().trim().max(2000).optional(),
});

router.post(
  '/demo-requests',
  requestLimiter,
  validateBody(demoRequestSchema),
  asyncHandler(async (req, res) => {
    const { name, email, phone, propertyName, unitsCount, message } = req.body as z.infer<typeof demoRequestSchema>;
    const normalized = email.toLowerCase();
    const ip = (req.ip ?? '').slice(0, 64) || null;

    const inserted = await query<{ id: number }>(
      `INSERT INTO demo_requests (name, email, phone, property_name, units_count, message, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [name, normalized, phone || null, propertyName || null, unitsCount || null, message || null, ip],
    );
    logAudit({
      userId: null,
      action: 'DEMO_REQUEST',
      entity: 'demo_requests',
      entityId: inserted[0]?.id ?? null,
      newValue: { name, email: normalized },
    }).catch((err) => console.error(`[public] demo-request audit failed: ${(err as Error).message}`));

    res.status(201).json({ data: { message: 'Request received. We will be in touch shortly.' } });
  }),
);

export default router;
