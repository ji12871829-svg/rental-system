// Clerk → local-staff auto-mapping webhook.
//
// Without this endpoint, a new Clerk user must be mapped to a local staff
// account by hand (INSERT into user_external_ids — see the Clerk runbook).
// With CLERK_WEBHOOK_SIGNING_SECRET set, Clerk's `user.created` events are
// verified with the standard-webhooks signature scheme and the mapping is
// created automatically, by VERIFIED email only:
//
//   * the Clerk account's primary verified email must match an existing
//     ACTIVE staff user — nothing is ever created on the local side, so the
//     webhook cannot become a staff-account-creation vector;
//   * CLERK_SECRET_KEY is also required: the mapping is only meaningful
//     while the sign-in bridge is live, and both knobs come from the same
//     Clerk instance;
//   * role/status always stay local (users table decides, as everywhere).
//
// Responses follow webhook convention: 2xx acknowledges (Clerk stops
// retrying), 4xx means "we refuse, do not retry" (verification failure,
// feature disabled), and unexpected errors are 500 so Clerk retries later.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { verifyWebhook } from '@clerk/backend/webhooks';
import type { UserWebhookEvent } from '@clerk/backend';
import { z } from 'zod';
import { env } from '../config/env';
import { query, queryOne } from '../config/db';
import { logAudit } from '../services/auditService';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth, adminOnly } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { conflict, notFound } from '../utils/httpError';

// Admin-facing review of Clerk sign-ups the webhook could not map. These
// routes share the webhook router so every piece of the mapping pipeline is
// in one file, but they sit BEHIND requireAuth+adminOnly — only the POST /
// webhook itself is deliberately unauthenticated (svix-signature verified).
// Note: CSRF exempts only the exact path /api/webhooks/clerk, so the admin
// routes keep full double-submit protection; none of them set cookies.
const router = Router();

// Admin-facing review of Clerk sign-ups the webhook could not map. These
// routes share the webhook router so every piece of the mapping pipeline is
// in one file, but each carries its own requireAuth+adminOnly guard — a
// router-wide use() would also guard the POST / webhook, whose only
// authentication IS the svix signature. Note: CSRF exempts only the exact
// path /api/webhooks/clerk, so the admin routes keep full double-submit
// protection.
const adminGuard = [requireAuth, adminOnly] as const;

// Local users matching this role set are linkable. Property managers and
// admins are staff; STAFF-role accounts are the least-privileged accounts —
// mapping those automatically is safe by the same argument.
const LINKABLE_ROLES = ['ADMIN', 'PROPERTY_MANAGER', 'STAFF'] as const;

// The primary verified email of a Clerk user, if any. Clerk can hold many
// emails; only the primary one marked verified counts — unverified addresses
// must never link a local account (anyone can CLAIM an unverified email).
function primaryVerifiedEmail(data: {
  primary_email_address_id?: string | null;
  email_addresses?: { id: string; email_address: string; verification?: { status?: string } | null }[];
}): string | null {
  const list = data.email_addresses ?? [];
  const primary = list.find((e) => e.id === data.primary_email_address_id);
  if (primary && primary.verification?.status === 'verified') return primary.email_address.toLowerCase();
  // Fallback: a verified email even if not marked primary (Clerk keeps the
  // flag in sync in practice; this covers payloads where it lags).
  const anyVerified = list.find((e) => e.verification?.status === 'verified');
  return anyVerified ? anyVerified.email_address.toLowerCase() : null;
}

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    // Fail closed: without both knobs the endpoint refuses every call, so a
    // half-configured deployment can never accept unverified mappings. 401
    // (not 404) matches the Clerk session bridge's posture.
    if (!env.clerkWebhookSigningSecret || !env.clerkSecretKey) {
      res.status(401).json({ error: 'UNCONFIGURED', message: 'Clerk webhooks are not configured on this deployment.', details: {} });
      return;
    }

    // The signature covers the exact bytes on the wire, not a
    // re-stringified req.body — the shared JSON parser snapshots them for
    // this path (its `verify` hook in app.ts).
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Missing request body.', details: {} });
      return;
    }

    // Signature verification (svix / standard-webhooks headers). A tampered
    // or replayed request never reaches the mapping logic.
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(','));
    }
    let event: UserWebhookEvent;
    try {
      event = (await verifyWebhook(new Request(`${req.protocol}://${req.get('host')}/api/webhooks/clerk`, {
        method: 'POST',
        headers,
        // web-standard Request accepts BufferSource bodies (Uint8Array);
        // Buffer's typing against the DOM lib needs the explicit copy.
        body: new Uint8Array(raw),
      }), { signingSecret: env.clerkWebhookSigningSecret })) as UserWebhookEvent;
    } catch (err) {
      console.warn('[clerk-webhook] signature verification failed:', err instanceof Error ? err.message : err);
      res.status(400).json({ error: 'INVALID_SIGNATURE', message: 'Webhook verification failed.', details: {} });
      return;
    }

    // Only user lifecycle events carry the email/identity data this
    // integration needs. Everything else is acknowledged and ignored —
    // returning 200 for unhandled types prevents Clerk retry storms.
    if (event.type !== 'user.created' && event.type !== 'user.updated') {
      res.status(200).json({ data: { ignored: event.type } });
      return;
    }

    const clerkUserId = event.data.id;
    const email = primaryVerifiedEmail(event.data);

    // An update that carries no verified email cannot change mapping state —
    // acknowledge without touching the table.
    if (event.type === 'user.updated' && !email) {
      res.status(200).json({ data: { ignored: 'no verified email' } });
      return;
    }

    const existing = await queryOne<{ user_id: number }>(
      `SELECT user_id FROM user_external_ids WHERE provider = 'clerk' AND external_id = $1`,
      [clerkUserId],
    );
    if (existing) {
      // Already mapped — idempotent replay (Clerk retries on flaky networks)
      // must not double-insert or error.
      res.status(200).json({ data: { mapped: existing.user_id, alreadyMapped: true } });
      return;
    }

    // Never create local accounts from the webhook: link only an existing
    // ACTIVE staff user whose email matches Clerk's verified address.
    const local = email
      ? await queryOne<{ id: number }>(
          `SELECT id FROM users WHERE email = $1 AND status = 'ACTIVE' AND role = ANY($2::text[])`,
          [email, [...LINKABLE_ROLES]],
        )
      : null;

    if (!local) {
      // Not an error: the runbook's dashboard provisioning remains the path
      // for users without a verified-email match (or non-staff roles). The
      // refusal IS recorded in the audit trail — a claimed-but-unverified
      // email or an unknown one is exactly what an admin reviewing access
      // needs to see. userId stays null so the trail shows "system" (no
      // local user is implicated). Only the decision's fields are logged —
      // never Clerk's full user object.
      await logAudit({
        action: 'CLERK_LINK_REFUSED',
        entity: 'users',
        newValue: {
          provider: 'clerk',
          external_id: clerkUserId,
          email,
          event: event.type,
          reason: email ? 'no matching active staff user' : 'no verified email',
        },
      });
      res.status(200).json({ data: { mapped: null, reason: email ? 'no matching active staff user' : 'no verified email' } });
      return;
    }

    await query(
      `INSERT INTO user_external_ids (user_id, provider, external_id)
       VALUES ($1, 'clerk', $2) ON CONFLICT DO NOTHING`,
      [local.id, clerkUserId],
    );
    // The auto-mapping replaces a manual dashboard/SQL step — it belongs in
    // the same trail an admin already checks for LOGIN/USER_ changes. Replay
    // acknowledgments (alreadyMapped) and ignored event types are NOT logged:
    // Clerk retries and profile edits would otherwise flood the trail.
    await logAudit({
      userId: local.id,
      action: 'CLERK_LINKED',
      entity: 'users',
      entityId: local.id,
      newValue: { provider: 'clerk', external_id: clerkUserId, email, event: event.type },
    });
    res.status(201).json({ data: { mapped: local.id } });
  }),
);

// Deduplicated review list: one row per refused Clerk identity, with the
// latest refusal's email/reason/timestamp and whether it has SINCE been
// linked (a later event mapped it, or an admin pre-provisioned by hand).
// Linked rows are returned too — they answer "did anything ever come of that
// sign-up?" — the UI splits the two groups. system-attributed refusals only:
// by definition, a refused sign-up has no local user to attribute to.
router.get('/signups', ...adminGuard, asyncHandler(async (_req, res) => {
  const rows = await query<{
    external_id: string;
    email: string | null;
    reason: string;
    refused_at: string;
    refusals: string;
    linked_user_id: number | null;
    linked_user_name: string | null;
    linked_user_email: string | null;
    linked_at: string | null;
  }>(
    `SELECT DISTINCT ON (a.new_value->>'external_id')
       a.new_value->>'external_id' AS external_id,
       a.new_value->>'email'       AS email,
       a.new_value->>'reason'      AS reason,
       a.created_at                AS refused_at,
       (SELECT COUNT(*)::int FROM audit_logs r
         WHERE r.action = 'CLERK_LINK_REFUSED'
           AND r.new_value->>'external_id' = a.new_value->>'external_id') AS refusals,
       x.user_id AS linked_user_id,
       u.name    AS linked_user_name,
       u.email   AS linked_user_email,
       x.created_at AS linked_at
     FROM audit_logs a
     LEFT JOIN user_external_ids x
       ON x.provider = 'clerk' AND x.external_id = a.new_value->>'external_id'
     LEFT JOIN users u ON u.id = x.user_id
     WHERE a.action = 'CLERK_LINK_REFUSED' AND a.user_id IS NULL
     ORDER BY a.new_value->>'external_id', a.created_at DESC`,
  );
  res.json({ data: rows });
}));

// The fix-it action: create the mapping the webhook could not. The admin
// picks the staff user whose email the sign-up was claimed under — typically
// a typo'd or renamed address, or a role outside the auto-link set.
const linkSchema = z.object({
  userId: z.coerce.number().int().positive(),
  // Optional context for the audit row: the refusal reason being resolved.
  refusalReason: z.string().max(100).optional(),
});
router.post(
  '/signups/:externalId/link',
  ...adminGuard,
  validateBody(linkSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const externalId = z.string().min(1).max(255).parse(req.params.externalId);

    const staff = await queryOne<{ id: number; email: string }>(
      `SELECT id, email FROM users WHERE id = $1 AND status = 'ACTIVE'
         AND role = ANY($2::text[])`,
      [req.body.userId, ['ADMIN', 'PROPERTY_MANAGER', 'STAFF']],
    );
    if (!staff) throw notFound('Staff user not found (or not ACTIVE / linkable).');

    const dupe = await queryOne("SELECT 1 FROM user_external_ids WHERE provider = 'clerk' AND external_id = $1", [externalId]);
    if (dupe) throw conflict('This Clerk identity is already mapped.', 'ALREADY_MAPPED');
    const dupeUser = await queryOne("SELECT 1 FROM user_external_ids WHERE provider = 'clerk' AND user_id = $1", [staff.id]);
    if (dupeUser) throw conflict('This staff user already has a Clerk identity mapped.', 'USER_ALREADY_MAPPED');

    await query(
      `INSERT INTO user_external_ids (user_id, provider, external_id)
       VALUES ($1, 'clerk', $2)`,
      [staff.id, externalId],
    );
    // Admin-attributed (the refusing webhook rows are system-attributed).
    await logAudit({
      userId: req.user!.userId,
      action: 'CLERK_LINKED',
      entity: 'users',
      entityId: staff.id,
      newValue: { provider: 'clerk', external_id: externalId, event: 'admin_link' },
      oldValue: { refused_reason: req.body.refusalReason ?? null },
    });
    res.status(201).json({ data: { mapped: staff.id } });
  }),
);

export default router;
