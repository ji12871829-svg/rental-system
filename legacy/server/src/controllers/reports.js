// controllers/reports.js — owner-facing analytics endpoints.
const reportsModel = require('../models/reports');
const { formatDate } = require('../utils/formatDate');

function parseMonthYear(req) {
  // Default to the current month when no query params given.
  const now = new Date();
  const year = req.query.year ? Number(req.query.year) : now.getUTCFullYear();
  const month = req.query.month ? Number(req.query.month) : now.getUTCMonth() + 1;
  return { year, month };
}

function isValidMonth(month) {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

function isValidYear(year) {
  return Number.isInteger(year) && year >= 2000 && year <= 2100;
}

// GET /api/reports/occupancy?month&year
async function occupancy(req, res, next) {
  try {
    const { year, month } = parseMonthYear(req);
    if (!isValidMonth(month) || !isValidYear(year)) {
      const { unprocessable } = require('../utils/httpError');
      throw unprocessable('INVALID_MONTH_YEAR', 'month must be 1-12 and year a plausible integer.');
    }
    const r = await reportsModel.occupancyForMonth(year, month);
    const total = Number(r.total_units);
    const occupied = Number(r.occupied_units);
    const maintenance = Number(r.maintenance_units);
    // Vacant = physically rentable: not occupied, not taken offline.
    const vacant = total - occupied - maintenance;
    return res.json({
      month,
      year,
      totalUnits: total,
      occupiedUnits: occupied,
      vacantUnits: vacant,
      maintenanceUnits: maintenance,
      occupancyRate: total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0,
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/reports/rent-collection?month&year
async function rentCollection(req, res, next) {
  try {
    const { year, month } = parseMonthYear(req);
    if (!isValidMonth(month) || !isValidYear(year)) {
      const { unprocessable } = require('../utils/httpError');
      throw unprocessable('INVALID_MONTH_YEAR', 'month must be 1-12 and year a plausible integer.');
    }
    const [totals, byUnit] = await Promise.all([
      reportsModel.rentCollectionForMonth(year, month),
      reportsModel.rentCollectionByUnit(year, month),
    ]);
    const totalBilled = Number(totals.total_billed);
    const totalCollected = Number(totals.total_collected);
    return res.json({
      month,
      year,
      totalBilled: totalBilled.toFixed(2),
      totalCollected: totalCollected.toFixed(2),
      outstandingBalance: (totalBilled - totalCollected).toFixed(2),
      collectionRate: totalBilled > 0
        ? Math.round((totalCollected / totalBilled) * 1000) / 10
        : 0,
      byUnit: byUnit.map((u) => ({
        unitId: u.unit_id,
        unitNumber: u.unit_number,
        billed: Number(u.billed).toFixed(2),
        collected: Number(u.collected).toFixed(2),
        outstanding: (Number(u.billed) - Number(u.collected)).toFixed(2),
      })),
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/reports/upcoming-lease-expirations?withinDays=60
async function upcomingExpirations(req, res, next) {
  try {
    let withinDays = 60;
    if (req.query.withinDays !== undefined) {
      withinDays = Number(req.query.withinDays);
      if (!Number.isInteger(withinDays) || withinDays < 1 || withinDays > 365) {
        const { unprocessable } = require('../utils/httpError');
        throw unprocessable('INVALID_WITHIN_DAYS', 'withinDays must be an integer between 1 and 365.');
      }
    }
    const leases = await reportsModel.upcomingExpirations(withinDays);
    return res.json({
      withinDays,
      count: leases.length,
      leases: leases.map((l) => ({
        leaseId: l.id,
        unitId: l.unit_id,
        unitNumber: l.unit_number,
        tenantId: l.tenant_id,
        tenantName: l.tenant_name,
        startDate: formatDate(l.start_date),
        endDate: formatDate(l.end_date),
        monthlyRent: l.monthly_rent,
        status: l.status,
        daysUntilExpiry: l.days_until_expiry,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/reports/outstanding-balances
async function outstandingBalances(req, res, next) {
  try {
    const balances = await reportsModel.outstandingBalances();
    const total = balances.reduce((sum, b) => sum + Number(b.balance_due), 0);
    return res.json({
      totalOutstanding: total.toFixed(2),
      balances: balances.map((b) => ({
        leaseId: b.lease_id,
        unitNumber: b.unit_number,
        tenantName: b.tenant_name,
        monthlyRent: b.monthly_rent,
        startDate: formatDate(b.start_date),
        endDate: formatDate(b.end_date),
        status: b.status,
        cyclesElapsed: b.cycles_elapsed,
        paid: b.paid,
        balanceDue: b.balance_due,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { occupancy, rentCollection, upcomingExpirations, outstandingBalances };
