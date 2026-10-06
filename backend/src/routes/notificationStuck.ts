import { Router } from 'express';
import { query } from '../config/db';
import { managerOrAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

function lastFailure(at: Date | null, reason: string | null): { at: string; reason: string } | null {
  if (!at) return null;
  return {
    at: at.toISOString(),
    reason: (reason ?? 'Unknown failure').slice(0, 300),
  };
}

router.get('/notification-stuck', managerOrAdmin, asyncHandler(async (_req, res) => {
  const [smsRows, emailRows] = await Promise.all([
    query<{ pending: string; failed: string; erroneous: string; lastFailureAt: Date | null; lastFailureReason: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'PENDING')::text AS pending,
         COUNT(*) FILTER (WHERE status = 'FAILED')::text AS failed,
         COUNT(*) FILTER (WHERE status = 'ERRONEOUS')::text AS erroneous,
         (SELECT created_at FROM (
            SELECT created_at, failure_reason, ROW_NUMBER() OVER (ORDER BY COALESCE(sent_at, created_at) DESC) AS rn
            FROM sms_notifications
            WHERE status = 'FAILED' AND created_at >= date_trunc('month', NOW())
          ) sub WHERE sub.rn = 1) AS "lastFailureAt",
         (SELECT failure_reason FROM (
            SELECT created_at, failure_reason, ROW_NUMBER() OVER (ORDER BY COALESCE(sent_at, created_at) DESC) AS rn
            FROM sms_notifications
            WHERE status = 'FAILED' AND created_at >= date_trunc('month', NOW())
          ) sub WHERE sub.rn = 1) AS "lastFailureReason"
       FROM sms_notifications`,
      [],
    ),
    query<{ pending: string; failed: string; erroneous: string; lastFailureAt: Date | null; lastFailureReason: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'PENDING')::text AS pending,
         COUNT(*) FILTER (WHERE status = 'FAILED')::text AS failed,
         COUNT(*) FILTER (WHERE status = 'ERRONEOUS')::text AS erroneous,
         (SELECT created_at FROM (
            SELECT created_at, failure_reason, ROW_NUMBER() OVER (ORDER BY COALESCE(sent_at, created_at) DESC) AS rn
            FROM email_notifications
            WHERE status IN ('FAILED', 'ERRONEOUS') AND created_at >= date_trunc('month', NOW())
          ) sub WHERE sub.rn = 1) AS "lastFailureAt",
         (SELECT failure_reason FROM (
            SELECT created_at, failure_reason, ROW_NUMBER() OVER (ORDER BY COALESCE(sent_at, created_at) DESC) AS rn
            FROM email_notifications
            WHERE status IN ('FAILED', 'ERRONEOUS') AND created_at >= date_trunc('month', NOW())
          ) sub WHERE sub.rn = 1) AS "lastFailureReason"
       FROM email_notifications`,
      [],
    ),
  ]);

  const sms = smsRows[0];
  const email = emailRows[0];

  res.json({
    data: {
      sms: {
        pending: Number(sms?.pending ?? 0),
        failed: Number(sms?.failed ?? 0),
        erroneous: Number(sms?.erroneous ?? 0),
        lastFailure: lastFailure(sms?.lastFailureAt ?? null, sms?.lastFailureReason ?? null),
      },
      email: {
        pending: Number(email?.pending ?? 0),
        failed: Number(email?.failed ?? 0),
        erroneous: Number(email?.erroneous ?? 0),
        lastFailure: lastFailure(email?.lastFailureAt ?? null, email?.lastFailureReason ?? null),
      },
    },
  });
}));

export default router;
