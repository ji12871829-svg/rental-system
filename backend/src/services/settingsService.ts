import { query, queryOne, withTransaction } from '../config/db';
import type { SettingsRow } from '../types';
import { n } from '../utils/money';
import { logAudit } from './auditService';

// The one and only source of truth for reporting_year / currency / water_rate.
export async function getSettings(): Promise<SettingsRow> {
  const existing = await queryOne<SettingsRow>('SELECT * FROM settings WHERE id = 1');
  if (existing) return existing;
  await query(
    `INSERT INTO settings (id, reporting_year, currency, water_rate)
     VALUES (1, 2026, 'KSh', 200)
     ON CONFLICT (id) DO NOTHING`
  );
  const row = await queryOne<SettingsRow>('SELECT * FROM settings WHERE id = 1');
  if (!row) throw new Error('Settings row could not be created.');
  return row;
}

export interface SettingsInput {
  reportingYear?: number;
  currency?: string;
  waterRate?: number;
  retentionYears?: number;
  // Property-owner communication (owner remittance templates).
  ownerName?: string | null;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  managementFeePercent?: number | null;
}

export async function updateSettings(
  input: SettingsInput,
  userId: number
): Promise<SettingsRow> {
  const before = await getSettings();
  const updated = await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE settings
       SET reporting_year = COALESCE($1, reporting_year),
           currency       = COALESCE($2, currency),
           water_rate     = COALESCE($3, water_rate),
           retention_years = COALESCE($4, retention_years),
           -- Owner fields: explicit null clears, omitted keeps (COALESCE
           -- pattern applied only when the key was present is handled by the
           -- route normalizing undefined → keep, null → clear).
           owner_name            = COALESCE($5, owner_name),
           owner_email           = COALESCE($6, owner_email),
           owner_phone           = COALESCE($7, owner_phone),
           management_fee_percent = COALESCE($8, management_fee_percent)
       WHERE id = 1
       RETURNING *`,
      [
        input.reportingYear ?? null,
        input.currency ?? null,
        input.waterRate ?? null,
        input.retentionYears ?? null,
        input.ownerName ?? null,
        input.ownerEmail ?? null,
        input.ownerPhone ?? null,
        input.managementFeePercent ?? null,
      ]
    );
    return res.rows[0] as SettingsRow;
  });

  await logAudit({
    userId,
    action: 'SETTINGS_UPDATED',
    entity: 'settings',
    entityId: 1,
    oldValue: {
      reportingYear: before.reporting_year,
      currency: before.currency,
      waterRate: n(before.water_rate),
      retentionYears: before.retention_years,
    },
    newValue: {
      reportingYear: updated.reporting_year,
      currency: updated.currency,
      waterRate: n(updated.water_rate),
      retentionYears: updated.retention_years,
    },
  });
  return updated;
}