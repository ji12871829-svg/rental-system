// controllers/tenants.js — business logic for tenants.
const tenantsModel = require('../models/tenants');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');
const { notFound, conflict, unprocessable } = require('../utils/httpError');

function mapTenant(t) {
  return {
    id: t.id,
    firstName: t.first_name,
    lastName: t.last_name,
    email: t.email,
    phone: t.phone,
    nationalId: t.national_id,
    emergencyContactName: t.emergency_contact_name,
    emergencyContactPhone: t.emergency_contact_phone,
    isArchived: t.is_archived,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const includeArchived = req.query.includeArchived === 'true';
    const [rows, total] = await Promise.all([
      tenantsModel.list({ limit, offset, includeArchived }),
      tenantsModel.count({ includeArchived }),
    ]);
    return res.json(buildPaginationResponse(rows.map(mapTenant), total, page, limit));
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const tenant = await tenantsModel.getById(Number(req.params.id));
    if (!tenant) throw notFound('Tenant not found.');
    return res.json(mapTenant(tenant));
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body;
    const tenant = await tenantsModel.create({
      first_name: b.firstName,
      last_name: b.lastName,
      email: b.email.toLowerCase().trim(),
      phone: b.phone,
      national_id: b.nationalId,
      emergency_contact_name: b.emergencyContactName,
      emergency_contact_phone: b.emergencyContactPhone,
    });
    return res.status(201).json(mapTenant(tenant));
  } catch (err) {
    if (err.code === '23505') {
      return next(conflict('DUPLICATE_EMAIL', 'A tenant with that email already exists.'));
    }
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const b = req.body;
    const fields = {};
    if (b.firstName !== undefined) fields.first_name = b.firstName;
    if (b.lastName !== undefined) fields.last_name = b.lastName;
    if (b.email !== undefined) fields.email = b.email.toLowerCase().trim();
    if (b.phone !== undefined) fields.phone = b.phone;
    if (b.nationalId !== undefined) fields.national_id = b.nationalId;
    if (b.emergencyContactName !== undefined) fields.emergency_contact_name = b.emergencyContactName;
    if (b.emergencyContactPhone !== undefined) fields.emergency_contact_phone = b.emergencyContactPhone;

    if (Object.keys(fields).length === 0) {
      throw unprocessable('EMPTY_UPDATE', 'Provide at least one field to update.');
    }

    const tenant = await tenantsModel.update(Number(req.params.id), fields);
    if (!tenant) throw notFound('Tenant not found.');
    return res.json(mapTenant(tenant));
  } catch (err) {
    if (err.code === '23505') {
      return next(conflict('DUPLICATE_EMAIL', 'A tenant with that email already exists.'));
    }
    return next(err);
  }
}

// Archive-instead-of-delete. Also blocked while the tenant holds an active
// lease (HARD-QUESTIONS.md Q7): archiving means "done with us", which an
// active lease contradicts. Clear the lease first.
async function archive(req, res, next) {
  try {
    const id = Number(req.params.id);
    const tenant = await tenantsModel.getById(id);
    if (!tenant) throw notFound('Tenant not found.');
    if (await tenantsModel.hasActiveLease(id)) {
      throw conflict('ARCHIVE_BLOCKED_ACTIVE_LEASE',
        'Tenant has an active lease and cannot be archived. End the lease first.');
    }
    const archived = await tenantsModel.archive(id);
    return res.json({ id: archived.id, isArchived: archived.is_archived });
  } catch (err) {
    return next(err);
  }
}

// Hard-delete is admin-only, and blocked entirely while an active lease
// exists. (The DB's ON DELETE RESTRICT is the final safety net; this check
// gives the friendly 409 the UI can show.)
async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    const tenant = await tenantsModel.getById(id);
    if (!tenant) throw notFound('Tenant not found.');
    if (await tenantsModel.hasActiveLease(id)) {
      throw conflict('TENANT_HAS_ACTIVE_LEASE',
        'Tenant has an active lease and cannot be deleted. Terminate the lease or archive the tenant instead.');
    }
    const deleted = await tenantsModel.remove(id);
    if (!deleted) throw notFound('Tenant not found.');
    return res.status(204).end();
  } catch (err) {
    // A non-active lease still restricts deletion at the DB level — translate.
    if (err.code === '23503') {
      return next(conflict('TENANT_HAS_LEASE_HISTORY',
        'Tenant has lease history and cannot be deleted. Archive the tenant instead.'));
    }
    return next(err);
  }
}

module.exports = { list, getById, create, update, archive, remove };
