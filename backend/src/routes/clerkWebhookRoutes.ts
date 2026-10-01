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
import { env } from '../config/env';
import { query, queryOne } from '../config/db';
import { logAudit } from '../services/auditService';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

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

export default router;
