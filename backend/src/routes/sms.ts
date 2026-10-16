import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { applyDeliveryReport, applyTextbeeDeliveryReport, getSmsBalance, listInbox, listSms, markInboxRead, recordReceivedSms, sendSmsNotification, sendTenantSmsCampaign, sendTestSms } from '../services/smsService';
import { getSmsConfig, verifyTextbeeSignature, type TextbeeWebhookEvent } from '../services/smsProvider';
import { sendBulkArrearsReminders } from '../services/reminderService';
import { autoSendEnabled } from '../services/smsService';
import { env } from '../config/env';

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

// textbee webhook — delivery + inbound events for the own-SIM gateway.
// MUST sit above router.use(requireAuth): textbee proves itself with an
// HMAC-SHA256 signature (X-Signature over the raw body), not a login — same
// reason the AT delivery-reports route is public. Always answers 200:
// textbee retries non-2xx for up to 30 days, and a forged or malformed body
// will never become valid, so it is logged and dropped instead of retried.
// Without TEXTBEE_WEBHOOK_SECRET every delivery is dropped (fail closed).
const textbeeWebhookSchema = z.object({
  webhookEvent: z.string().optional(),
  smsId: z.string().optional(),
  smsBatchId: z.string().optional(),
  status: z.string().optional(),
  recipient: z.string().optional(),
  sender: z.string().optional(),
  message: z.string().optional(),
  deviceId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  receivedAt: z.string().optional(),
  sentAt: z.string().optional(),
  deliveredAt: z.string().optional(),
  failedAt: z.string().optional(),
});

router.post('/textbee-webhook', asyncHandler(async (req, res) => {
  const raw = (req as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  // Envelope, not bare fields: the response guard requires { data } on 200s.
  if (!verifyTextbeeSignature(raw, req.header('x-signature') ?? undefined, env.textbeeWebhookSecret)) {
    console.warn('[sms] textbee webhook dropped: bad or missing signature');
    res.status(200).json({ data: { ok: true, handled: false } });
    return;
  }
  const parsed = textbeeWebhookSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    console.warn('[sms] textbee webhook dropped: unparsable body');
    res.status(200).json({ data: { ok: true, handled: false } });
    return;
  }
  const event = parsed.data as TextbeeWebhookEvent;
  if (event.webhookEvent === 'MESSAGE_RECEIVED') {
    if (!event.sender) {
      console.warn('[sms] textbee webhook dropped: MESSAGE_RECEIVED without sender');
      res.status(200).json({ data: { ok: true, handled: false } });
      return;
    }
    const stored = await recordReceivedSms({
      sender: event.sender,
      message: event.message,
      deviceId: event.deviceId,
      textbeeSmsId: event.smsId,
      idempotencyKey: event.idempotencyKey,
      receivedAt: event.receivedAt,
    });
    res.status(200).json({ data: { ok: true, handled: true, kind: 'received', id: stored.id, duplicate: stored.duplicate } });
    return;
  }
  const result = await applyTextbeeDeliveryReport(event);
  res.status(200).json({ data: { ok: true, handled: true, kind: 'delivery', ...result } });
}));

router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

// Current SMS mode so the UI can label sends honestly (no secrets returned).
router.get('/config', asyncHandler(async (_req, res) => {
  const cfg = await getSmsConfig();
  res.json({ data: cfg });
}));

// Provider wallet balance + low-balance evaluation for the SMS page's
// warning banner. Never throws: non-AT modes report 'unknown', provider
// failures degrade to 'unavailable' with the reason.
router.get('/balance', asyncHandler(async (_req, res) => {
  res.json({ data: await getSmsBalance() });
}));

// Provider config verification: sends a real test SMS through the configured
// provider and returns its verdict (message id / failure reason, reported
// cost, latency). Not written to the SMS history — this is a diagnostic,
// not correspondence.
const testSmsSchema = z.object({
  to: z.string().max(30).optional(),
});

router.post('/test', managerOrAdmin, validateBody(testSmsSchema), asyncHandler(async (req, res) => {
  const result = await sendTestSms({ to: req.body?.to, userId: req.user!.userId });
  res.json({ data: result });
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

// Tenant campaign (one composition, many recipients) — mirrors
// POST /api/emails/campaign. Queues a personalised PENDING row per ACTIVE
// tenant ({{name}} / {{unit}} merge); rows auto-send when the pipeline is on
// and otherwise wait on the SMS page. Responses count queueing, not delivery.
const smsCampaignSchema = z.object({
  tenantIds: z.array(z.number().int().positive()).max(1000).optional(),
  message: z.string().trim().min(3).max(1000),
});

router.post('/campaign', managerOrAdmin, validateBody(smsCampaignSchema), asyncHandler(async (req, res) => {
  const result = await sendTenantSmsCampaign({ ...(req.body as { tenantIds?: number[]; message: string }), userId: req.user!.userId });
  res.status(201).json({ data: result });
}));

// One-click bulk arrears reminders — the button the operator asked for: one
// POST queues a personalised SMS (each tenant's message matches their own
// bill — balance statement for rent debtors, water notice for water-only
// debtors) for EVERY ACTIVE tenant with money owing. The optional audience
// narrows the blast to rent debtors or water debtors only; omitted it covers
// both. No recipient picking, no second step. Rows auto-send when the SMS
// pipeline is on, otherwise they wait as PENDING on the SMS page. 201:
// accepted (queued), not yet delivered.
const bulkArrearsSchema = z.object({
  audience: z.enum(['ALL', 'RENT', 'WATER']).optional().default('ALL'),
});

router.post('/reminders/bulk-arrears', managerOrAdmin, validateBody(bulkArrearsSchema), asyncHandler(async (req, res) => {
  const { audience } = req.body as { audience: 'ALL' | 'RENT' | 'WATER' };
  const result = await sendBulkArrearsReminders({ userId: req.user!.userId, audience });
  res.status(201).json({ data: { ...result, autoSend: autoSendEnabled() } });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

// --- Tenant inbox (textbee replies) ------------------------------------------
// MESSAGE_RECEIVED rows via GET, newest-first with tenant resolution; PATCH
// marks one read. Any authenticated staff may triage replies.

const inboxQuerySchema = baseListQuerySchema.extend({
  unreadOnly: z.enum(['1', 'true']).optional(),
});

router.get('/inbox', asyncHandler(async (req, res) => {
  const q = inboxQuerySchema.parse(req.query);
  const result = await listInbox({ page: q.page, limit: q.limit, unreadOnly: q.unreadOnly !== undefined });
  res.json({ data: result.rows, pagination: result.pagination });
}));

router.post('/inbox/:id/read', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const row = await markInboxRead(Number(req.params.id));
  res.json({ data: row });
}));
const sendSmsSchema = z.object({
  templateKind: z.string().optional(),
});

router.post('/:id/send', validateParams(paramsSchema), validateBody(sendSmsSchema.optional()), asyncHandler(async (req, res) => {
  const { templateKind } = (req.body ?? {}) as { templateKind?: string };
  const row = await sendSmsNotification(Number(req.params.id), { templateKind: templateKind ?? null });
  res.json({ data: row });
}));

export default router;