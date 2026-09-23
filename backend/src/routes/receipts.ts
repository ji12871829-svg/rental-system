import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, validateQuery, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { bulkReceiptsPdf, generateCombinedReceipt, getReceiptById, listReceipts } from '../services/receiptService';
import { prepareForReceipt, sendEmailNotification } from '../services/emailService';
import { receiptPdfBytes } from '../utils/receiptPdf';
import { getBusinessIdentity } from '../services/brandingService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  receiptType: z.enum(['RENT', 'WATER', 'COMBINED']).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  q: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listReceipts({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

// Bulk PDF export: every receipt in a billing month merged into one PDF.
// Registered BEFORE /:id so 'export.pdf' is not captured as an id.
const bulkPdfQuery = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});
router.get('/export.pdf', validateQuery(bulkPdfQuery), asyncHandler(async (req, res) => {
  const q = bulkPdfQuery.parse(req.query);
  const { bytes, count } = await bulkReceiptsPdf(q.month, q.year);
  if (count === 0) {
    res.status(404).json({ error: 'NO_RECEIPTS', message: `No receipts found for ${q.year}-${String(q.month).padStart(2, '0')}.`, details: {} });
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipts-${q.year}-${String(q.month).padStart(2, '0')}.pdf"`);
  res.setHeader('X-Receipt-Count', String(count));
  res.send(Buffer.from(bytes));
}));

router.get('/:id', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const row = await getReceiptById(Number(req.params.id));
  res.json({ data: row });
}));

// PDF download — generated server-side with pdf-lib (no headless browser).
router.get('/:id/pdf', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const receipt = await getReceiptById(Number(req.params.id));
  const bytes = await receiptPdfBytes(receipt, await getBusinessIdentity());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${receipt.receipt_number}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// Combined RWC receipt for a tenant's billing month (spec §33).
const generateSchema = z.object({
  tenantId: z.number().int().positive(),
  billingMonth: z.number().int().min(1).max(12),
  billingYear: z.number().int().min(2000).max(2100),
});

router.post('/generate', validateBody(generateSchema), asyncHandler(async (req, res) => {
  const row = await generateCombinedReceipt(req.body as { tenantId: number; billingMonth: number; billingYear: number });
  res.status(201).json({ data: row });
}));

// Email a receipt: creates the PENDING email row (recipient = the tenant's
// stored email, or an explicit address in the body) and sends it via the
// configured provider in one step.
const emailSchema = z.object({
  toEmail: z.string().email().optional(),
});

router.post('/:id/email', managerOrAdmin, validateParams(paramsSchema), validateBody(emailSchema), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const pending = await prepareForReceipt(receiptId, {
    toEmail: req.body?.toEmail,
    userId: req.user!.userId,
  });
  const row = await sendEmailNotification(pending.id);
  res.status(201).json({ data: row });
}));

export default router;