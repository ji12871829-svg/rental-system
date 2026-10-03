import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { notFound } from '../utils/httpError';
import { logAudit } from '../services/auditService';
import {
  listTemplateState,
  resetTemplate,
  upsertTemplate,
  TEMPLATE_KINDS,
} from '../services/templateService';

const router = Router();
router.use(requireAuth);

const kindParams = z.object({ kind: z.string().min(1) });
const saveSchema = z.object({
  subject: z.string().max(200).optional(),
  body: z.string().min(1, 'Template body is required').max(4000),
});

function metaFor(kind: string) {
  const meta = TEMPLATE_KINDS.find((m) => m.kind === kind);
  if (!meta) throw notFound(`Unknown template kind: ${kind}`);
  return meta;
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: await listTemplateState() });
  }),
);

router.get(
  '/:kind',
  validateParams(kindParams),
  asyncHandler(async (req, res) => {
    const meta = metaFor(req.params.kind);
    const one = (await listTemplateState()).find((t) => t.kind === meta.kind) ?? null;
    if (!one) throw notFound(`Unknown template kind: ${meta.kind}`);
    res.json({ data: one });
  }),
);

// Save (customize) a template: stores the row; every future send of this kind
// uses it until Revert deletes the row and the hardcoded default returns.
router.put(
  '/:kind',
  managerOrAdmin,
  validateParams(kindParams),
  validateBody(saveSchema),
  asyncHandler(async (req, res) => {
    const meta = metaFor(req.params.kind);
    const saved = await upsertTemplate(
      meta.kind,
      { subject: req.body.subject ?? null, body: req.body.body },
      req.user!.userId,
    );
    await logAudit({
      userId: req.user!.userId,
      action: 'MESSAGE_TEMPLATE_UPDATED',
      entity: 'message_templates',
      entityId: saved.id,
      newValue: { kind: meta.kind },
    });
    res.status(201).json({ data: saved });
  }),
);

// Revert: delete the customized row — the hardcoded default takes over again.
router.delete(
  '/:kind',
  managerOrAdmin,
  validateParams(kindParams),
  asyncHandler(async (req, res) => {
    const meta = metaFor(req.params.kind);
    const removed = await resetTemplate(meta.kind);
    await logAudit({
      userId: req.user!.userId,
      action: 'MESSAGE_TEMPLATE_RESET',
      entity: 'message_templates',
      entityId: null,
      newValue: { kind: meta.kind },
    });
    res.json({ data: { reverted: removed } });
  }),
);

export default router;