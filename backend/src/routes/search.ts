import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();
router.use(requireAuth);

const searchQuery = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

// Global search — mirrors the xampp RMS /api/search endpoint shape
// (dashboard.php lines 501-540): one query, four sectioned result buckets
// (properties, tenants, units, invoices/receipts), each capped, returned as
// a flat envelope the topbar dropdown can render as sectioned items.
//
// Deep-link targets (local app, list-based — no detail pages):
//   property → /units                      (the property's units live here)
//   tenant   → /tenant-ledger?tenant=<id>  (opens that tenant's ledger)
//   unit     → /arrears?unit=<unitNumber>  (the arrears page filters by unit)
//   receipt  → /receipts                  (receipt history list — no detail page yet)
//
// items carry { id, label, sub, to } so the dropdown can render one consistent
// row per result without knowing each section's column shape.

interface SearchItem {
  id: number;
  label: string;
  sub: string;
  to: string;
}

router.get('/search', asyncHandler(async (req, res) => {
  const { q, limit = 5 } = searchQuery.parse(req.query);
  const like = `%${q}%`;

  // Four buckets in parallel. Each is a cheap indexed ILIKE scan with a
  // hard cap so a typo can never blow up the response.
  const [properties, tenants, units, receipts] = await Promise.all([
    query<{ id: number; name: string; address: string | null }>(
      `SELECT id, name, address FROM properties WHERE name ILIKE $1 ORDER BY name ASC LIMIT $2`,
      [like, limit],
    ),
    query<{ id: number; full_name: string; phone_number: string | null; unit_number: string | null }>(
      `SELECT t.id, t.full_name, t.phone_number, u.unit_number
       FROM tenants t
       LEFT JOIN units u ON u.id = t.unit_id
       WHERE t.full_name ILIKE $1 OR t.phone_number ILIKE $1 OR t.email ILIKE $1 OR u.unit_number ILIKE $1
       ORDER BY t.full_name ASC
       LIMIT $2`,
      [like, limit],
    ),
    query<{ id: number; unit_number: string; monthly_rent: number; property_name: string | null; tenant_name: string | null }>(
      `SELECT u.id, u.unit_number, u.monthly_rent, p.name AS property_name, t.full_name AS tenant_name
       FROM units u
       JOIN properties p ON p.id = u.property_id
       LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
       WHERE u.unit_number ILIKE $1 OR p.name ILIKE $1
       ORDER BY u.unit_number ASC
       LIMIT $2`,
      [like, limit],
    ),
    query<{ id: number; receipt_number: string; receipt_type: string; total_amount: number; tenant_name: string | null }>(
      `SELECT r.id, r.receipt_number, r.receipt_type, r.total_amount, t.full_name AS tenant_name
       FROM receipts r
       JOIN tenants t ON t.id = r.tenant_id
       WHERE r.receipt_number ILIKE $1 OR t.full_name ILIKE $1
       ORDER BY r.payment_date DESC, r.id DESC
       LIMIT $2`,
      [like, limit],
    ),
  ]);

  const propertiesItems: SearchItem[] = properties.map((p) => ({
    id: p.id,
    label: p.name,
    sub: p.address ?? '',
    to: '/units',
  }));

  const tenantsItems: SearchItem[] = tenants.map((t) => ({
    id: t.id,
    label: t.full_name,
    sub: [t.unit_number, t.phone_number].filter(Boolean).join(' · ') ?? '',
    to: `/tenant-ledger?tenant=${t.id}`,
  }));

  const unitsItems: SearchItem[] = units.map((u) => ({
    id: u.id,
    label: u.unit_number,
    sub: [u.property_name ?? '', u.tenant_name ? `Tenant: ${u.tenant_name}` : ''].filter(Boolean).join(' · ') ?? '',
    to: `/arrears?unit=${encodeURIComponent(u.unit_number)}`,
  }));

  const receiptsItems: SearchItem[] = receipts.map((r) => ({
    id: r.id,
    label: r.receipt_number,
    sub: [r.receipt_type, `KES ${Number(r.total_amount).toLocaleString()}`, r.tenant_name ? `Tenant: ${r.tenant_name}` : ''].filter(Boolean).join(' · ') ?? '',
    to: '/receipts',
  }));

  res.json({ data: { properties: propertiesItems, tenants: tenantsItems, units: unitsItems, receipts: receiptsItems } });
}));

export default router;
