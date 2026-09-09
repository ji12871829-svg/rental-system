// controllers/maintenance.js — maintenance request lifecycle.
const maintenanceModel = require('../models/maintenance');
const unitsModel = require('../models/units');
const tenantsModel = require('../models/tenants');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');
const { MAINTENANCE_TRANSITIONS, isTransitionAllowed } = require('../utils/transitions');
const { notFound, unprocessable } = require('../utils/httpError');

function mapRequest(m) {
  return {
    id: m.id,
    unitId: m.unit_id,
    unitNumber: m.unit_number,
    tenantId: m.tenant_id,
    tenantName: m.tenant_name,
    description: m.description,
    status: m.status,
    priority: m.priority,
    assignedVendor: m.assigned_vendor,
    cost: m.cost,
    createdAt: m.created_at,
    resolvedAt: m.resolved_at,
  };
}

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const filters = {
      status: req.query.status || undefined,
      unitId: req.query.unitId ? Number(req.query.unitId) : undefined,
      priority: req.query.priority || undefined,
    };
    const [rows, total] = await Promise.all([
      maintenanceModel.list({ limit, offset, ...filters }),
      maintenanceModel.count(filters),
    ]);
    return res.json(buildPaginationResponse(rows.map(mapRequest), total, page, limit));
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const request = await maintenanceModel.getById(Number(req.params.id));
    if (!request) throw notFound('Maintenance request not found.');
    return res.json(mapRequest(request));
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body;
    const unit = await unitsModel.getById(b.unitId);
    if (!unit) throw notFound('Unit not found.');
    // tenant_id optional (vacant-unit walkthroughs — HARD-QUESTIONS Q8).
    if (b.tenantId) {
      const tenant = await tenantsModel.getById(b.tenantId);
      if (!tenant) throw notFound('Tenant not found.');
    }
    const request = await maintenanceModel.create({
      unit_id: b.unitId,
      tenant_id: b.tenantId,
      description: b.description,
      priority: b.priority,
    });
    const full = await maintenanceModel.getById(request.id);
    return res.status(201).json(mapRequest(full));
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const existing = await maintenanceModel.getById(id);
    if (!existing) throw notFound('Maintenance request not found.');

    const fields = {};
    const b = req.body;

    if (b.status !== undefined) {
      // State machine: open → in_progress → resolved, or open/in_progress →
      // cancelled. resolved/cancelled are terminal; no reopening (rule 7).
      if (!isTransitionAllowed(MAINTENANCE_TRANSITIONS, existing.status, b.status)) {
        throw unprocessable('INVALID_STATUS_TRANSITION',
          `Cannot change status from '${existing.status}' to '${b.status}'.`);
      }
      fields.status = b.status;
      if (b.status === 'resolved') fields.resolved_at = new Date(); // rule 7: stamp on resolve
    }
    if (b.priority !== undefined) fields.priority = b.priority;
    if (b.assignedVendor !== undefined) fields.assigned_vendor = b.assignedVendor;
    if (b.cost !== undefined) fields.cost = b.cost;

    if (Object.keys(fields).length === 0) {
      throw unprocessable('EMPTY_UPDATE', 'Provide at least one of status, priority, assignedVendor, cost.');
    }

    const updated = await maintenanceModel.update(id, fields);
    const full = await maintenanceModel.getById(id);
    return res.json(mapRequest(full));
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update };
