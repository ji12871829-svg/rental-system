// controllers/leases.js — business logic for leases. The overlap pre-check
// here exists so humans get a friendly 409; the DB EXCLUDE constraint is the
// race-condition safety net (AGENTS.md §2). Both sides use inclusive ranges.
const leasesModel = require('../models/leases');
const unitsModel = require('../models/units');
const tenantsModel = require('../models/tenants');
const paymentsModel = require('../models/payments');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');
// Overlap detection lives in the model (findOverlapping) — the controller calls
// it for the friendly 409; utils/dateOverlap.js backs the unit tests.
const { calculateCyclesElapsed } = require('../utils/calculateCyclesElapsed');
const { formatDate } = require('../utils/formatDate');
const { LEASE_TRANSITIONS, isTransitionAllowed } = require('../utils/transitions');
const { notFound, conflict, unprocessable } = require('../utils/httpError');

function mapLease(l) {
  return {
    id: l.id,
    unitId: l.unit_id,
    unitNumber: l.unit_number,
    tenantId: l.tenant_id,
    tenantName: l.tenant_name,
    startDate: formatDate(l.start_date),
    endDate: formatDate(l.end_date),
    monthlyRent: l.monthly_rent,
    depositAmount: l.deposit_amount,
    status: l.status,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const filters = {
      status: req.query.status || undefined,
      unitId: req.query.unitId ? Number(req.query.unitId) : undefined,
      tenantId: req.query.tenantId ? Number(req.query.tenantId) : undefined,
    };
    const [rows, total] = await Promise.all([
      leasesModel.list({ limit, offset, ...filters }),
      leasesModel.count(filters),
    ]);
    return res.json(buildPaginationResponse(rows.map(mapLease), total, page, limit));
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const lease = await leasesModel.getById(Number(req.params.id));
    if (!lease) throw notFound('Lease not found.');
    const paid = await paymentsModel.sumForLease(lease.id);
    // Balance due uses the shared cycles helper (HARD-QUESTIONS Q3) — the
    // billing window is start_date through min(today, end_date). Dates are
    // normalized to YYYY-MM-DD strings so the comparison is lexicographic.
    const today = new Date().toISOString().slice(0, 10);
    const start = formatDate(lease.start_date);
    const end = formatDate(lease.end_date);
    const endDate = end < today ? end : today;
    const cycles = calculateCyclesElapsed(start, endDate);
    const balanceDue = Math.round((cycles * Number(lease.monthly_rent) - paid) * 100) / 100;
    return res.json({
      ...mapLease(lease),
      totalPaid: paid.toFixed(2),
      cyclesElapsed: cycles,
      balanceDue: balanceDue.toFixed(2),
    });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body;

    // --- Referential checks (friendly 404s instead of FK violations) ---
    const unit = await unitsModel.getById(b.unitId);
    if (!unit) throw notFound('Unit not found.');
    const tenant = await tenantsModel.getById(b.tenantId);
    if (!tenant) throw notFound('Tenant not found.');
    if (tenant.is_archived) {
      throw unprocessable('TENANT_ARCHIVED', 'Archived tenants cannot be assigned a new lease.');
    }

    // --- Business rule: end_date strictly after start_date (422) ---
    if (b.endDate <= b.startDate) {
      throw unprocessable('INVALID_DATE_RANGE', 'Lease end date must be after start date.',
        { endDate: 'Must be after startDate.' });
    }

    // --- Business rule: no overlapping ACTIVE lease on this unit (409) ---
    // Inclusive range comparison matches the DB EXCLUDE constraint exactly.
    const overlap = await leasesModel.findOverlapping(b.unitId, b.startDate, b.endDate);
    if (overlap) {
      throw conflict('LEASE_OVERLAP',
        `Unit ${unit.unit_number} already has an active lease that overlaps the requested dates ` +
        `(${formatDate(overlap.start_date)} to ${formatDate(overlap.end_date)}).`,
        { conflictingLeaseId: overlap.id });
    }

    const lease = await leasesModel.create({
      unit_id: b.unitId,
      tenant_id: b.tenantId,
      start_date: b.startDate,
      end_date: b.endDate,
      monthly_rent: b.monthlyRent,
      deposit_amount: b.depositAmount ?? 0,
      status: 'active',
    });

    // Re-fetch for the joined response shape (unit number + tenant name).
    const full = await leasesModel.getById(lease.id);
    return res.status(201).json(mapLease(full));
  } catch (err) {
    // Safety net: a race slipped past the pre-check and the DB constraint fired.
    if (err.code === '23P01') {
      return next(conflict('LEASE_OVERLAP',
        'The unit already has an active lease overlapping the requested dates.'));
    }
    return next(err);
  }
}

// PATCH: endDate / monthlyRent / status only (per API contract §9).
async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const lease = await leasesModel.getById(id);
    if (!lease) throw notFound('Lease not found.');

    const fields = {};
    const b = req.body;

    if (b.status !== undefined) {
      // State machine: active → expired|terminated only; terminal states closed.
      if (!isTransitionAllowed(LEASE_TRANSITIONS, lease.status, b.status)) {
        throw unprocessable('INVALID_STATUS_TRANSITION',
          `Cannot change lease status from '${lease.status}' to '${b.status}'.`);
      }
      fields.status = b.status;
    }

    if (b.endDate !== undefined) {
      const newStart = lease.start_date;
      if (b.endDate <= newStart) {
        throw unprocessable('INVALID_DATE_RANGE', 'Lease end date must be after start date.',
          { endDate: 'Must be after startDate.' });
      }
      // Moving end_date can create an overlap with ANOTHER active lease on the
      // same unit — check excluding this lease itself.
      const overlap = await leasesModel.findOverlapping(lease.unit_id, newStart, b.endDate, id);
      if (overlap) {
        throw conflict('LEASE_OVERLAP',
          `Unit ${lease.unit_number} already has an active lease overlapping the requested end date ` +
          `(${formatDate(overlap.start_date)} to ${formatDate(overlap.end_date)}).`);
      }
      fields.end_date = b.endDate;
    }

    if (b.monthlyRent !== undefined) fields.monthly_rent = b.monthlyRent;

    if (Object.keys(fields).length === 0) {
      throw unprocessable('EMPTY_UPDATE', 'Provide at least one of endDate, monthlyRent, status.');
    }

    const updated = await leasesModel.update(id, fields);
    const full = await leasesModel.getById(id);
    return res.json(mapLease(full));
  } catch (err) {
    if (err.code === '23P01') {
      return next(conflict('LEASE_OVERLAP',
        'The change would overlap another active lease on this unit.'));
    }
    return next(err);
  }
}

// DELETE is intentionally not implemented — leases are financial history.
// The route answers 405 (see routes/leases.js).

module.exports = { list, getById, create, update };
