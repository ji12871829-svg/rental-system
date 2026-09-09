"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listUnits = listUnits;
exports.getUnit = getUnit;
exports.createUnit = createUnit;
exports.updateUnit = updateUnit;
exports.deleteUnit = deleteUnit;
exports.unitFinancialHistory = unitFinancialHistory;
const db_1 = require("../config/db");
const httpError_1 = require("../utils/httpError");
const money_1 = require("../utils/money");
const auditService_1 = require("./auditService");
async function listUnits(filters) {
    const where = [];
    const params = [];
    if (filters.floorId) {
        params.push(filters.floorId);
        where.push(`u.floor_id = $${params.length}`);
    }
    if (filters.occupancyStatus) {
        params.push(filters.occupancyStatus);
        where.push(`u.occupancy_status = $${params.length}`);
    }
    if (filters.waterEnabled !== undefined) {
        params.push(filters.waterEnabled);
        where.push(`u.water_enabled = $${params.length}`);
    }
    if (filters.q) {
        params.push(`%${filters.q}%`);
        where.push(`(u.unit_number ILIKE $${params.length} OR u.unit_type ILIKE $${params.length} OR t.full_name ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count FROM units u
     LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     ${whereSql}`, params);
    const total = Number(totalRow?.count ?? 0);
    const offset = (filters.page - 1) * filters.limit;
    const rows = await (0, db_1.query)(`SELECT u.*, f.floor_number, f.name AS floor_name,
            t.id AS tenant_id, t.full_name AS tenant_name, t.phone_number
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     ${whereSql}
     ORDER BY (u.unit_number ~ '^[0-9]+$') DESC, (u.unit_number::int) ASC, u.unit_number ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, filters.limit, offset]);
    return {
        rows,
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
}
async function getUnit(id) {
    const row = await (0, db_1.queryOne)(`SELECT u.*, f.floor_number, f.name AS floor_name,
            t.id AS tenant_id, t.full_name AS tenant_name, t.phone_number,
            t.move_in_date, t.security_deposit
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     WHERE u.id = $1`, [id]);
    if (!row)
        throw (0, httpError_1.notFound)('Unit not found.');
    return row;
}
async function createUnit(input, userId) {
    const floor = await (0, db_1.queryOne)('SELECT id, property_id FROM floors WHERE id = $1', [input.floorId]);
    if (!floor)
        throw (0, httpError_1.notFound)('Floor not found.');
    const duplicate = await (0, db_1.queryOne)('SELECT id FROM units WHERE property_id = $1 AND unit_number = $2', [floor.property_id, input.unitNumber]);
    if (duplicate)
        throw (0, httpError_1.conflict)(`Unit ${input.unitNumber} already exists.`, 'DUPLICATE_UNIT');
    const inserted = await (0, db_1.query)(`INSERT INTO units
       (property_id, floor_id, unit_number, unit_type, monthly_rent, water_enabled, occupancy_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`, [floor.property_id, input.floorId, input.unitNumber, input.unitType, input.monthlyRent, input.waterEnabled, input.occupancyStatus ?? 'VACANT']);
    await (0, auditService_1.logAudit)({ userId, action: 'UNIT_CREATED', entity: 'units', entityId: inserted[0].id, newValue: input });
    return inserted[0];
}
// Room 12's rent (and any unit's) is editable — rent is stored data, never a
// code constant (spec §2).
async function updateUnit(id, input, userId) {
    const existing = await (0, db_1.queryOne)('SELECT * FROM units WHERE id = $1', [id]);
    if (!existing)
        throw (0, httpError_1.notFound)('Unit not found.');
    const updated = await (0, db_1.query)(`UPDATE units
     SET unit_type = COALESCE($2, unit_type),
         monthly_rent = COALESCE($3, monthly_rent),
         water_enabled = COALESCE($4, water_enabled),
         occupancy_status = COALESCE($5, occupancy_status),
         floor_id = COALESCE($6, floor_id),
         unit_number = COALESCE($7, unit_number)
     WHERE id = $1
     RETURNING *`, [
        id, input.unitType ?? null, input.monthlyRent ?? null,
        input.waterEnabled ?? null, input.occupancyStatus ?? null,
        input.floorId ?? null, input.unitNumber ?? null,
    ]);
    await (0, auditService_1.logAudit)({
        userId,
        action: 'UNIT_UPDATED',
        entity: 'units',
        entityId: id,
        oldValue: { monthlyRent: (0, money_1.n)(existing.monthly_rent), waterEnabled: existing.water_enabled, occupancyStatus: existing.occupancy_status },
        newValue: { monthlyRent: input.monthlyRent, waterEnabled: input.waterEnabled, occupancyStatus: input.occupancyStatus },
    });
    return updated[0];
}
async function deleteUnit(id, userId) {
    const existing = await (0, db_1.queryOne)('SELECT id, unit_number FROM units WHERE id = $1', [id]);
    if (!existing)
        throw (0, httpError_1.notFound)('Unit not found.');
    const references = await (0, db_1.queryOne)(`SELECT (SELECT COUNT(*) FROM tenants WHERE unit_id = $1) +
            (SELECT COUNT(*) FROM rent_payments WHERE unit_id = $1) +
            (SELECT COUNT(*) FROM water_payments WHERE unit_id = $1) +
            (SELECT COUNT(*) FROM water_meter_readings WHERE unit_id = $1) AS count`, [id]);
    if (Number(references?.count ?? 0) > 0) {
        throw (0, httpError_1.conflict)(`Unit ${existing.unit_number} has financial or tenant history and cannot be deleted. Deactivate it instead.`, 'UNIT_HAS_HISTORY');
    }
    await (0, db_1.query)('DELETE FROM units WHERE id = $1', [id]);
    await (0, auditService_1.logAudit)({ userId, action: 'UNIT_DELETED', entity: 'units', entityId: id });
}
// Financial history for the unit detail view.
async function unitFinancialHistory(id) {
    const unit = await (0, db_1.queryOne)('SELECT id, unit_number FROM units WHERE id = $1', [id]);
    if (!unit)
        throw (0, httpError_1.notFound)('Unit not found.');
    const rentCollected = (0, money_1.n)((await (0, db_1.queryOne)('SELECT COALESCE(SUM(amount), 0)::text AS v FROM rent_payments WHERE unit_id = $1', [id]))?.v);
    const waterBilled = (0, money_1.n)((await (0, db_1.queryOne)('SELECT COALESCE(SUM(water_bill), 0)::text AS v FROM water_meter_readings WHERE unit_id = $1', [id]))?.v);
    const waterCollected = (0, money_1.n)((await (0, db_1.queryOne)('SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments WHERE unit_id = $1', [id]))?.v);
    return {
        unitId: id,
        unitNumber: unit.unit_number,
        rentCollected,
        waterBilled,
        waterCollected,
        totalCollected: (0, money_1.round2)(rentCollected + waterCollected),
    };
}
//# sourceMappingURL=unitService.js.map