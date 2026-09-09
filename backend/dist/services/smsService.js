"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMessage = buildMessage;
exports.prepareForReceipt = prepareForReceipt;
exports.listSms = listSms;
exports.sendSmsNotification = sendSmsNotification;
exports.backfillSms = backfillSms;
const db_1 = require("../config/db");
const types_1 = require("../types");
const businessRules_1 = require("../utils/businessRules");
const httpError_1 = require("../utils/httpError");
const money_1 = require("../utils/money");
const smsProvider_1 = require("./smsProvider");
// Builds the SMS text for a receipt (spec §34 examples).
function buildMessage(receipt, opts) {
    const monthName = types_1.MONTH_NAMES[receipt.billing_month - 1];
    const base = {
        tenantName: opts.tenantName,
        unitNumber: opts.unitNumber,
        monthName,
        year: receipt.billing_year,
        receiptNumber: receipt.receipt_number,
        balance: (0, money_1.n)(receipt.balance),
        currency: opts.currency,
    };
    if (receipt.receipt_type === 'WATER') {
        return (0, businessRules_1.waterReceiptMessage)({ ...base, waterPaid: (0, money_1.n)(receipt.water_amount) });
    }
    if (receipt.receipt_type === 'COMBINED') {
        return (0, businessRules_1.combinedReceiptMessage)({
            ...base,
            rentPaid: (0, money_1.n)(receipt.rent_amount),
            waterPaid: (0, money_1.n)(receipt.water_amount),
            totalPaid: (0, money_1.n)(receipt.total_amount),
        });
    }
    return (0, businessRules_1.rentReceiptMessage)({ ...base, rentPaid: (0, money_1.n)(receipt.rent_amount) });
}
// Creates a PENDING sms_notifications row for a receipt (called inside the
// payment transaction via the injected `exec`).
async function prepareForReceipt(receipt, exec = db_1.poolExec) {
    const tenant = await exec.query(`SELECT t.full_name, t.phone_number, u.unit_number, s.currency
     FROM tenants t
     JOIN units u ON u.id = t.unit_id
     JOIN settings s ON s.id = 1
     WHERE t.id = $1`, [receipt.tenant_id]);
    const row = tenant.rows[0];
    if (!row || !row.phone_number)
        return; // no phone → nothing to notify
    const message = buildMessage(receipt, {
        tenantName: row.full_name,
        unitNumber: row.unit_number,
        currency: row.currency,
    });
    await exec.query(`INSERT INTO sms_notifications (receipt_id, tenant_id, phone_number, message, status)
     VALUES ($1, $2, $3, $4, 'PENDING')`, [receipt.id, receipt.tenant_id, row.phone_number, message]);
}
async function listSms(filters) {
    const where = [];
    const params = [];
    if (filters.status) {
        params.push(filters.status);
        where.push(`s.status = $${params.length}`);
    }
    if (filters.tenantId) {
        params.push(filters.tenantId);
        where.push(`s.tenant_id = $${params.length}`);
    }
    if (filters.q) {
        params.push(`%${filters.q}%`);
        where.push(`(s.message ILIKE $${params.length} OR t.full_name ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count FROM sms_notifications s ${whereSql}`, params);
    const total = Number(totalRow?.count ?? 0);
    const offset = (filters.page - 1) * filters.limit;
    const rows = await (0, db_1.query)(`SELECT s.*, t.full_name AS tenant_name, u.unit_number
     FROM sms_notifications s
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id
     ${whereSql}
     ORDER BY s.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, filters.limit, offset]);
    return {
        rows,
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
}
// Simulated send: marks a PENDING message as SENT (or FAILED). When real
// credentials exist, smsProvider.sendSms performs the actual delivery.
async function sendSmsNotification(id) {
    const row = await (0, db_1.queryOne)('SELECT id, phone_number, message, status FROM sms_notifications WHERE id = $1', [id]);
    if (!row)
        throw (0, httpError_1.notFound)('SMS notification not found.');
    const result = await (0, smsProvider_1.sendSms)({
        phoneNumber: row.phone_number,
        message: row.message,
        apiKey: process.env.SMS_API_KEY || '',
        username: process.env.SMS_USERNAME || '',
    });
    if (result.ok) {
        await (0, db_1.query)(`UPDATE sms_notifications
       SET status = 'SENT', provider_message_id = $2, sent_at = NOW()
       WHERE id = $1`, [id, result.providerMessageId ?? null]);
    }
    else {
        await (0, db_1.query)(`UPDATE sms_notifications
       SET status = 'FAILED', failure_reason = $2
       WHERE id = $1`, [id, result.failureReason ?? 'Unknown provider error']);
    }
    return (0, db_1.queryOne)('SELECT * FROM sms_notifications WHERE id = $1', [id]);
}
// Backfill for seeded receipts: creates PENDING SMS rows for any receipt
// that has none yet.
async function backfillSms() {
    const receipts = await (0, db_1.query)(`SELECT r.* FROM receipts r
     WHERE NOT EXISTS (SELECT 1 FROM sms_notifications s WHERE s.receipt_id = r.id)`);
    let created = 0;
    for (const receipt of receipts) {
        await prepareForReceipt(receipt);
        created += 1;
    }
    return created;
}
//# sourceMappingURL=smsService.js.map