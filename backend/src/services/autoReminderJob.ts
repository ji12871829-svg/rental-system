// Scheduled rent reminders — the automatic half of the Reminder module.
//
// One hourly tick decides (from Africa/Nairobi wall clock — the estate's own
// calendar, not the server's UTC day) whether a batch is due:
//   - Due-soon nudge: the LAST day of each month from 10:00 EAT — "{Next
//     month} rent is due" to every active tenant with a phone
//     (SMS_RENT_DUE_SOON / rentDueSoonMessage).
//   - Overdue chase: the 5th of each month from 09:00 EAT — the existing
//     firm Overdue Notice to every active tenant whose ledger shows arrears.
// Idempotency is DB-driven, not timer-driven: each batch writes rows tagged
// template_kind ('AUTO_DUE_SOON' / 'AUTO_OVERDUE') and the sweep refuses to
// run a batch whose tag already has a row since the window opened — restarts,
// redeploys and Render's free-instance sleeps can never double-send. Both
// windows stay open until midnight, so an hour slept through is caught by the
// next wake. Gated by settings.auto_reminders_enabled; no-op under
// NODE_ENV=test like every job in index.ts.
import { query, queryOne } from '../config/db';
import { dispatchAutoSend } from './smsService';
import { prepareReminder } from './reminderService';
import { getSettings } from './settingsService';
import { tenantBalances } from './tenantLedger';

let timer: ReturnType<typeof setInterval> | null = null;

const EAT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/** The given instant in Africa/Nairobi wall-clock (UTC+3, no DST). */
export function eatWallClock(now: Date): Date {
  return new Date(now.getTime() + EAT_UTC_OFFSET_MS);
}

export interface ReminderPlan {
  dueSoon: boolean;
  overdue: boolean;
}

// Pure window rule: which batches this tick should attempt. The DB dedupe
// (not the window width) is what prevents double-sends.
export function reminderPlan(now: Date): ReminderPlan {
  const wall = eatWallClock(now);
  const day = wall.getUTCDate();
  const month = wall.getUTCMonth() + 1;
  const hour = wall.getUTCHours();
  // Last day of this month: Date.UTC(next month, day 0) rolls back to it.
  const lastDay = new Date(Date.UTC(wall.getUTCFullYear(), month, 0)).getUTCDate();
  return {
    dueSoon: day === lastDay && hour >= 10,
    overdue: day === 5 && hour >= 9,
  };
}

// The wall-clock instant the due-soon window opened (00:00 EAT of the batch
// day) as a real UTC timestamp — the dedupe horizon for "already sent?".
function dueSoonWindowStartUtc(now: Date): Date {
  const wall = eatWallClock(now);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - EAT_UTC_OFFSET_MS);
}

// Overdue batches run monthly, so their horizon is the whole EAT month.
function overdueWindowStartUtc(now: Date): Date {
  const wall = eatWallClock(now);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1) - EAT_UTC_OFFSET_MS);
}

async function batchAlreadyRan(kind: string, since: Date): Promise<boolean> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sms_notifications WHERE template_kind = $1 AND created_at >= $2`,
    [kind, since],
  );
  return Number(row?.count ?? 0) > 0;
}

export interface ScheduledReminderRun {
  dueSoonQueued: number;
  overdueQueued: number;
}

// One sweep. Returns what it queued (the job's log line and the tests read
// exactly this). Reminder rows are auto-dispatched immediately, same as the
// manual "Send Reminders" route does.
export async function runScheduledReminders(now: Date = new Date()): Promise<ScheduledReminderRun> {
  const counts: ScheduledReminderRun = { dueSoonQueued: 0, overdueQueued: 0 };
  const plan = reminderPlan(now);
  if (!plan.dueSoon && !plan.overdue) return counts;

  const settings = await getSettings();
  if (!settings.auto_reminders_enabled) return counts;

  // Active tenants with a phone — moved-out tenants never hear from the
  // scheduler, and phoneless ones have nothing to receive on.
  const tenants = await query<{ id: number }>(
    `SELECT id FROM tenants
     WHERE move_out_date IS NULL
       AND phone_number IS NOT NULL AND TRIM(phone_number) <> ''`,
  );

  if (plan.dueSoon && !(await batchAlreadyRan('AUTO_DUE_SOON', dueSoonWindowStartUtc(now)))) {
    for (const tenant of tenants) {
      const sent = await prepareReminder(tenant.id, 'DUE_SOON', 'SMS', {
        templateKind: 'AUTO_DUE_SOON',
        userId: null,
      });
      if (sent?.smsId) {
        dispatchAutoSend(sent.smsId);
        counts.dueSoonQueued += 1;
      }
    }
  }

  if (plan.overdue && !(await batchAlreadyRan('AUTO_OVERDUE', overdueWindowStartUtc(now)))) {
    const year = settings.reporting_year;
    const month = eatWallClock(now).getUTCMonth() + 1;
    for (const tenant of tenants) {
      // Arrears gate from the ledger module — the same figures the manual
      // reminder quotes, so the chase can never contradict the tenant card.
      const ledger = await tenantBalances(tenant.id, year, month);
      if (ledger.combinedBalance <= 0.009) continue;
      const sent = await prepareReminder(tenant.id, 'OVERDUE', 'SMS', {
        templateKind: 'AUTO_OVERDUE',
        userId: null,
      });
      if (sent?.smsId) {
        dispatchAutoSend(sent.smsId);
        counts.overdueQueued += 1;
      }
    }
  }

  return counts;
}

/** Start the hourly reminder sweep (no-op in the test environment). Idempotent. */
export function startAutoReminderJob(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;
  const intervalMs = 60 * 60 * 1000;
  timer = setInterval(() => {
    runScheduledReminders()
      .then((r) => {
        if (r.dueSoonQueued > 0 || r.overdueQueued > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[auto-reminders] sweep: ${r.dueSoonQueued} due-soon, ${r.overdueQueued} overdue queued.`
          );
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[auto-reminders] sweep failed:', err);
      });
  }, intervalMs);
}

export function stopAutoReminderJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
