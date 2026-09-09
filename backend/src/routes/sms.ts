import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateParams } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { applyDeliveryReport, getSmsBalance, listSms, sendSmsNotification } from '../services/smsService';
import { getSmsConfig } from '../services/smsProvider';

const router = Router();

// Delivery-report callback — Africa's Talking POSTs here from its dashboard
// (SMS → SMS Callback URLs → Delivery Reports). It MUST sit above
// router.use(requireAuth): the provider cannot authenticate as a user.
// Accepts both JSON and form-urlencoded bodies (the parser for form posts is
// mounted in app.ts before the routers). Always answers 200 so the gateway
// does not retry a report we already processed or cannot act on.
const deliveryReportSchema = z.record(z.string(), z.unknown());
router.post('/delivery-reports', asyncHandler(async (req, res) => {
  const body = deliveryReportSchema.parse(req.body ?? {});
  const entry = (body as { Recipients?: unknown[] }).Recipients?.[0];
  const report = (entry ?? body) as Record<string, unknown>;
  await applyDeliveryReport({
    messageId: typeof report.messageId === 'string' ? report.messageId : undefined,
    status: typeof report.status === 'string' ? report.status : undefined,
    statusCode: typeof report.statusCode === 'number' ? report.statusCode : undefined,
    networkCode: typeof report.networkCode === 'string' ? report.networkCode : undefined,
  });
  res.status(200).send('Ok');
}));

router.use(requireAuth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

// Current SMS mode so the UI can label sends honestly (no secrets returned).
router.get('/config', asyncHandler(async (_req, res) => {
  res.json({ data: getSmsConfig() });
}));

// Provider wallet balance + low-balance evaluation for the SMS page's
// warning banner. Never throws: non-AT modes report 'unknown', provider
// failures degrade to 'unavailable' with the reason.
router.get('/balance', asyncHandler(async (_req, res) => {
  res.json({ data: await getSmsBalance() });
}));

// History doubles as the list endpoint (spec §42: GET /api/sms/history).
// meta.spendByCurrency carries the total provider-reported cost across the
// whole filtered set (all pages), per currency.
router.get('/history', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listSms({ ...q });
  res.json({ data: result.rows, pagination: result.pagination, meta: { spendByCurrency: result.spendByCurrency } });
}));

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listSms({ ...q });
  res.json({ data: result.rows, pagination: result.pagination, meta: { spendByCurrency: result.spendByCurrency } });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.post('/:id/send', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const row = await sendSmsNotification(Number(req.params.id));
  res.json({ data: row });
}));

export default router;