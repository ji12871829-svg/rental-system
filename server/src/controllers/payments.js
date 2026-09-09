// controllers/payments.js — record payments, compute balance due, CSV export.
const paymentsModel = require('../models/payments');
const leasesModel = require('../models/leases');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');
const { calculateCyclesElapsed } = require('../utils/calculateCyclesElapsed');
const { formatDate } = require('../utils/formatDate');
const { notFound, conflict } = require('../utils/httpError');

// Balance due = (cyclesElapsed × monthlyRent) − SUM(payments) — the ONLY
// billing formula in the codebase (HARD-QUESTIONS Q3). cyclesElapsed counts
// whole calendar months from start_date through min(today, end_date).
function computeBalanceDue(lease, today) {
  const start = formatDate(lease.start_date);
  const end = formatDate(lease.end_date);
  const billingEndDate = end < today ? end : today;
  const cycles = calculateCyclesElapsed(start, billingEndDate);
  return Math.round(cycles * Number(lease.monthly_rent) * 100) / 100;
}

function mapPayment(p, extra = {}) {
  return {
    id: p.id,
    leaseId: p.lease_id,
    unitId: p.unit_id,
    unitNumber: p.unit_number,
    tenantName: p.tenant_name,
    amount: p.amount,
    paymentDate: formatDate(p.payment_date),
    paymentMethod: p.payment_method,
    referenceNumber: p.reference_number,
    notes: p.notes,
    createdAt: p.created_at,
    ...extra,
  };
}

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const filters = {
      leaseId: req.query.leaseId ? Number(req.query.leaseId) : undefined,
      dateFrom: req.query.dateFrom || undefined,
      dateTo: req.query.dateTo || undefined,
    };
    const [rows, total] = await Promise.all([
      paymentsModel.list({ limit, offset, ...filters }),
      paymentsModel.count(filters),
    ]);
    return res.json(buildPaginationResponse(rows.map((p) => mapPayment(p)), total, page, limit));
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const payment = await paymentsModel.getById(Number(req.params.id));
    if (!payment) throw notFound('Payment not found.');
    return res.json(mapPayment(payment));
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body;
    const lease = await leasesModel.getById(b.leaseId);
    if (!lease) throw notFound('Lease not found.');

    // Terminated leases reject new money — the tenancy ended badly enough to
    // terminate, so further payments need a human decision (HARD-QUESTIONS Q2).
    if (lease.status === 'terminated') {
      throw conflict('LEASE_TERMINATED', 'This lease is terminated and cannot accept new payments.');
    }

    // Soft duplicate guard (HARD-QUESTIONS Q4): identical payment logged within
    // the last 60 seconds is treated as a double-submit, not real money.
    const dup = await paymentsModel.findRecentDuplicate({
      leaseId: b.leaseId,
      amount: b.amount,
      paymentDate: b.paymentDate,
      referenceNumber: b.referenceNumber ?? null,
    });
    if (dup) {
      throw conflict('DUPLICATE_PAYMENT',
        'An identical payment was recorded within the last 60 seconds. If this is a genuine second payment, try again shortly.');
    }

    // Partial/over-payments are allowed by design — we reflect the result in
    // balanceDue rather than rejecting (ARCHITECTURE-ESSENTIALS rule 3).
    const payment = await paymentsModel.create({
      lease_id: b.leaseId,
      amount: b.amount,
      payment_date: b.paymentDate,
      payment_method: b.paymentMethod,
      reference_number: b.referenceNumber,
      notes: b.notes,
    });

    const today = new Date().toISOString().slice(0, 10);
    const dueToDate = computeBalanceDue(lease, today);
    const paid = await paymentsModel.sumForLease(b.leaseId);
    const balanceDue = Math.round((dueToDate - paid) * 100) / 100;

    const full = await paymentsModel.getById(payment.id);
    return res.status(201).json(mapPayment(full, { balanceDue: balanceDue.toFixed(2) }));
  } catch (err) {
    return next(err);
  }
}

// CSV export: GET /api/payments/export?dateFrom&dateTo&leaseId
// Streams matching payments as text/csv. Row cap of 5,000 with
// X-Export-Truncated header (HARD-QUESTIONS Q10).
const CSV_EXPORT_ROW_CAP = 5000;

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportCsv(req, res, next) {
  try {
    const filters = {
      leaseId: req.query.leaseId ? Number(req.query.leaseId) : undefined,
      dateFrom: req.query.dateFrom || undefined,
      dateTo: req.query.dateTo || undefined,
    };
    // Fetch one extra row to detect truncation without a second COUNT query.
    const rows = await paymentsModel.list({ limit: CSV_EXPORT_ROW_CAP + 1, offset: 0, ...filters });
    const truncated = rows.length > CSV_EXPORT_ROW_CAP;
    const data = truncated ? rows.slice(0, CSV_EXPORT_ROW_CAP) : rows;

    const header = 'id,lease_id,unit_number,tenant_name,amount,payment_date,payment_method,reference_number,notes';
    const lines = data.map((p) =>
      [p.id, p.lease_id, p.unit_number, p.tenant_name, p.amount, formatDate(p.payment_date),
       p.payment_method, p.reference_number, p.notes].map(csvEscape).join(',')
    );
    const csv = [header, ...lines].join('\n') + (lines.length ? '\n' : '');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payments-export.csv"');
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    return res.send(csv);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, exportCsv };
