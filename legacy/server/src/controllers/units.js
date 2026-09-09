// controllers/units.js — business logic for units.
const unitsModel = require('../models/units');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');
const { notFound, conflict, unprocessable } = require('../utils/httpError');

function mapUnit(u) {
  return {
    id: u.id,
    unitNumber: u.unit_number,
    floor: u.floor,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    squareFeet: u.square_feet,
    baseRent: u.base_rent,
    status: u.status,
    notes: u.notes,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = req.query.status || undefined;
    const [rows, total] = await Promise.all([
      unitsModel.list({ limit, offset, status }),
      unitsModel.count({ status }),
    ]);
    return res.json(buildPaginationResponse(rows.map(mapUnit), total, page, limit));
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const unit = await unitsModel.getById(Number(req.params.id));
    if (!unit) throw notFound('Unit not found.');
    return res.json(mapUnit(unit));
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body;
    const unit = await unitsModel.create({
      unit_number: b.unitNumber,
      floor: b.floor || null,
      bedrooms: b.bedrooms,
      bathrooms: b.bathrooms,
      square_feet: b.squareFeet ?? null,
      base_rent: b.baseRent,
      notes: b.notes || null,
    });
    return res.status(201).json(mapUnit(unit));
  } catch (err) {
    if (err.code === '23505') {
      return next(conflict('DUPLICATE_UNIT_NUMBER', `Unit "${req.body.unitNumber}" already exists.`));
    }
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const b = req.body;
    // Allowlist the columns actually present in the request; no-op if empty.
    const fields = {};
    if (b.unitNumber !== undefined) fields.unit_number = b.unitNumber;
    if (b.floor !== undefined) fields.floor = b.floor;
    if (b.bedrooms !== undefined) fields.bedrooms = b.bedrooms;
    if (b.bathrooms !== undefined) fields.bathrooms = b.bathrooms;
    if (b.squareFeet !== undefined) fields.square_feet = b.squareFeet;
    if (b.baseRent !== undefined) fields.base_rent = b.baseRent;
    if (b.status !== undefined) fields.status = b.status; // includes "deactivate" → maintenance
    if (b.notes !== undefined) fields.notes = b.notes;

    if (Object.keys(fields).length === 0) {
      throw unprocessable('EMPTY_UPDATE', 'Provide at least one field to update.');
    }

    const unit = await unitsModel.update(Number(req.params.id), fields);
    if (!unit) throw notFound('Unit not found.');
    return res.json(mapUnit(unit));
  } catch (err) {
    if (err.code === '23505') {
      return next(conflict('DUPLICATE_UNIT_NUMBER', `Unit "${req.body.unitNumber}" already exists.`));
    }
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    const unit = await unitsModel.getById(id);
    if (!unit) throw notFound('Unit not found.');

    // Units with any lease or maintenance history are permanent records —
    // the client offers "deactivate" (status=maintenance) instead (rule 5).
    if (await unitsModel.hasHistory(id)) {
      throw conflict('UNIT_HAS_HISTORY',
        'Unit has lease or maintenance history and cannot be deleted. Set its status to "maintenance" to take it offline instead.');
    }
    const deleted = await unitsModel.remove(id);
    if (!deleted) throw notFound('Unit not found.');
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update, remove };
