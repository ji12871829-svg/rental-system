"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.updateSettings = updateSettings;
const db_1 = require("../config/db");
const money_1 = require("../utils/money");
const auditService_1 = require("./auditService");
// The one and only source of truth for reporting_year / currency / water_rate.
async function getSettings() {
    const existing = await (0, db_1.queryOne)('SELECT * FROM settings WHERE id = 1');
    if (existing)
        return existing;
    await (0, db_1.query)(`INSERT INTO settings (id, reporting_year, currency, water_rate)
     VALUES (1, 2026, 'KSh', 200)
     ON CONFLICT (id) DO NOTHING`);
    const row = await (0, db_1.queryOne)('SELECT * FROM settings WHERE id = 1');
    if (!row)
        throw new Error('Settings row could not be created.');
    return row;
}
async function updateSettings(input, userId) {
    const before = await getSettings();
    const updated = await (0, db_1.withTransaction)(async (client) => {
        const res = await client.query(`UPDATE settings
       SET reporting_year = COALESCE($1, reporting_year),
           currency       = COALESCE($2, currency),
           water_rate     = COALESCE($3, water_rate)
       WHERE id = 1
       RETURNING *`, [
            input.reportingYear ?? null,
            input.currency ?? null,
            input.waterRate ?? null,
        ]);
        return res.rows[0];
    });
    await (0, auditService_1.logAudit)({
        userId,
        action: 'SETTINGS_UPDATED',
        entity: 'settings',
        entityId: 1,
        oldValue: {
            reportingYear: before.reporting_year,
            currency: before.currency,
            waterRate: (0, money_1.n)(before.water_rate),
        },
        newValue: {
            reportingYear: updated.reporting_year,
            currency: updated.currency,
            waterRate: (0, money_1.n)(updated.water_rate),
        },
    });
    return updated;
}
//# sourceMappingURL=settingsService.js.map