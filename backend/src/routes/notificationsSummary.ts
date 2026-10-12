import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();
router.use(requireAuth);

// --- Summary + recent feed ----------------------------------------------------

// Unread = needs attention: PENDING (never sent), FAILED (transient, retrying),
// ERRONEOUS (address rejected — terminal, but still something to review).
// Terminal SENT rows are excluded because they are genuinely read/delivered.
//
// UnreadBadge is the shallow number shown in the topbar bell. The full recent
// list keeps its own per-item read flag so the panel can dim items the user
// has opened, without re-fetching the badge each time.
interface UnreadCounts {
  sms: { unread: number; pending: number; failed: number; erroneous: number };
  email: { unread: number; pending: number; failed: number; erroneous: number };
}

function summarize(rows: { channel: 'SMS' | 'EMAIL'; status: string }[]): UnreadCounts {
  const sms = { unread: 0, pending: 0, failed: 0, erroneous: 0 };
  const email = { unread: 0, pending: 0, failed: 0, erroneous: 0 };
  for (const r of rows) {
    const target = r.channel === 'SMS' ? sms : email;
    if (r.status === 'PENDING') { target.unread += 1; target.pending += 1; }
    else if (r.status === 'FAILED') { target.unread += 1; target.failed += 1; }
    else if (r.status === 'ERRONEOUS') { target.unread += 1; target.erroneous += 1; }
  }
  return { sms, email };
}

router.get('/notifications-summary', asyncHandler(async (_req, res) => {
  // One row per recent notification across both channels, newest first.
  // Terminal SENT rows are included in the feed (they still render as history),
  // but they do not count toward the unread badge.
  const rows = await query<{ channel: 'SMS' | 'EMAIL'; id: number; status: string; subject: string | null; recipient: string; created_at: string | null; failure_reason: string | null; provider_message_id: string | null }>(
    // sms_notifications has no `recipient`/`subject` column (subject is an
    // email-only concept); the frontend falls back to "SMS message" when
    // subject is null, and recipient is always the phone_number.
    `SELECT 'SMS' AS channel, id, status, NULL::text AS subject, phone_number AS recipient, created_at, failure_reason, NULL::text AS provider_message_id
     FROM sms_notifications
     UNION ALL
     SELECT 'EMAIL' AS channel, id, status, subject, email_address AS recipient, created_at, failure_reason, provider_message_id
     FROM email_notifications
     ORDER BY created_at DESC
     LIMIT 20`,
    [],
  );

  const counts = summarize(rows as { channel: 'SMS' | 'EMAIL'; status: string }[]);
  const totalUnread = counts.sms.unread + counts.email.unread;

  // Enrich the feed: email rows carry a tenant name; SMS rows carry the
  // recipient phone. Keep the shape flat so the frontend maps one list.
  const feed = rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    status: r.status,
    unread: (r.status === 'PENDING' || r.status === 'FAILED' || r.status === 'ERRONEOUS') ? true : false,
    subject: r.subject,
    recipient: r.recipient,
    createdAt: r.created_at,
    failureReason: r.failure_reason,
    providerMessageId: r.provider_message_id,
  }));

  res.json({ data: { unread: totalUnread, unreadCounts: counts, feed } });
}));

// --- Mark all read -------------------------------------------------------------

// Marks every non-terminal notification as SENT regardless of channel, so the
// unread badge clears. Terminal ERRONEOUS rows are left alone (they are
// already terminal and re-sending is a separate manual action in history).
const markAllReadSchema = z.object({ channels: z.array(z.enum(['SMS', 'EMAIL'])).min(1).max(2).optional() });

router.patch('/notifications-summary/mark-all-read', requireAuth, managerOrAdmin, asyncHandler(async (req, res) => {
  const { channels = ['SMS', 'EMAIL'] } = markAllReadSchema.parse(req.body ?? {});
  let cleared = 0;

  if (channels.includes('SMS')) {
    const smsResult = await query(
      `UPDATE sms_notifications SET status = 'SENT' WHERE status IN ('PENDING', 'FAILED') RETURNING 1`,
      [],
    );
    cleared += smsResult.length;
  }
  if (channels.includes('EMAIL')) {
    const emailResult = await query(
      `UPDATE email_notifications SET status = 'SENT' WHERE status IN ('PENDING', 'FAILED') RETURNING 1`,
      [],
    );
    cleared += emailResult.length;
  }

  res.json({ data: { cleared } });
}));

export default router;
