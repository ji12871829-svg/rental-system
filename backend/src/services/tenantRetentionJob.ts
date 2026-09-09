// Automated retention sweep for moved-out tenants (Kenya DPA 2019 storage-
// limitation principle / GDPR art. 5(1)(e)).
//
// N years (settings.retention_years, 0 = disabled) after a tenant's LAST
// financial activity, the sweep anonymises their personal data by calling
// eraseTenantPersonalData — the exact code path a manual erasure uses, so
// redaction scope, the privacy-register entry (requester "Automated retention
// policy") and the audit trail are identical to a hand-run erasure.
//
// "Last financial activity" = the most recent of the tenant's rent payments,
// water payments, meter readings and receipts (by their own dates, not row
// creation time). A tenant with no financial rows is judged by move_out_date.
//
// Safety properties:
//  - ACTIVE tenants are never eligible (eraseTenantPersonalData refuses them
//    anyway — defence in depth).
//  - One erasure failure skips that tenant; the sweep continues.
//  - Idempotent: once anonymised, the tenant's identity no longer matches the
//    eligibility query, so it is never swept twice.
//  - NODE_ENV=test opts out at startTenantRetentionJob; the sweep itself is
//    fully unit/integration-testable via runRetentionSweep().
import { pool } from '../config/db';
import { getSettings } from './settingsService';
import { eraseTenantPersonalData } from './privacyService';

const SWEEP_BATCH = 10;

export interface SweepResult {
  checked: number;
  anonymized: number;
  failures: { tenantId: number; error: string }[];
}

/**
 * Anonymise every eligible moved-out tenant. Returns what happened so the
 * caller (server loop or tests) can log/report it.
 */
export async function runRetentionSweep(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, anonymized: 0, failures: [] };

  const settings = await getSettings();
  if (settings.retention_years <= 0) return result; // 0 = feature disabled

  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - settings.retention_years);
  const cutoffDate = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  // Eligible = moved out, still carrying personal data (name not yet erased),
  // and no financial activity newer than the cutoff. The activity date is the
  // latest of all linked financial rows; tenants with none are judged by
  // move_out_date. NOT LIKE 'Erased tenant%' keeps previously anonymised rows
  // out (idempotency, even if a future code path re-opens them).
  const eligible = await pool.query<{ id: number }>(
    `SELECT t.id
     FROM tenants t
     LEFT JOIN LATERAL (
       SELECT GREATEST(
         (SELECT MAX(rp.payment_date) FROM rent_payments rp WHERE rp.tenant_id = t.id),
         (SELECT MAX(wp.payment_date) FROM water_payments wp WHERE wp.tenant_id = t.id),
         (SELECT MAX(wr.reading_date) FROM water_meter_readings wr WHERE wr.tenant_id = t.id),
         (SELECT MAX(r.payment_date) FROM receipts r WHERE r.tenant_id = t.id)
       ) AS last_activity
     ) fa ON true
     WHERE t.status = 'MOVED_OUT'
       AND t.full_name NOT LIKE 'Erased tenant%'
       AND COALESCE(fa.last_activity, t.move_out_date) IS NOT NULL
       AND COALESCE(fa.last_activity, t.move_out_date) <= $1
     LIMIT $2`,
    [cutoffDate, SWEEP_BATCH]
  );
  result.checked = eligible.rows.length;

  for (const { id } of eligible.rows) {
    try {
      await eraseTenantPersonalData(id, {
        requester: 'Automated retention policy',
        reason: `Moved out with no financial activity for ${settings.retention_years} years (retention_years setting).`,
        performedBy: null,
        userId: null,
      });
      result.anonymized += 1;
    } catch (err) {
      // One bad tenant must not block the rest of the sweep.
      result.failures.push({ tenantId: id, error: (err as Error).message });
    }
  }
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the daily retention loop (no-op in the test environment). Idempotent. */
export function startTenantRetentionJob(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (timer) return;
  const intervalMs = 24 * 60 * 60 * 1000;
  timer = setInterval(() => {
    runRetentionSweep()
      .then((r) => {
        if (r.checked > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[retention] sweep: ${r.checked} eligible, ${r.anonymized} anonymised, ${r.failures.length} failures.`
          );
        }
      })
      .catch((err) =>
        // eslint-disable-next-line no-console
        console.error('[retention] sweep failed:', (err as Error).message)
      );
  }, intervalMs);
  // eslint-disable-next-line no-console
  console.log('Tenant retention job: running daily — moved-out tenants are anonymised after the configured retention years.');
}

export function stopTenantRetentionJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
