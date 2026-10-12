import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { createDocument, deleteDocument, getDocumentFile, listDocuments, type DocumentInput } from '../services/documentService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  docType: z.string().optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listDocuments(q);
  res.json({ data: result.rows, pagination: result.pagination });
}));

// The browser posts { title, docType, tenantId/unitId, fileName, mimeType,
// contentBase64 } — base64 keeps the JSON envelope uniform with every other
// write in the app (multer/multipart would be the only exception in it).
const DOC_TYPES = ['LEASE_AGREEMENT', 'INVOICE', 'RECEIPT', 'ID_DOCUMENT', 'INSPECTION_REPORT', 'PHOTO', 'INSURANCE', 'OTHER'] as const;
const uploadSchema = z.object({
  title: z.string().trim().min(2).max(200),
  docType: z.enum(DOC_TYPES),
  tenantId: z.number().int().positive().optional(),
  unitId: z.number().int().positive().optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(120),
  contentBase64: z.string().min(4),
});

router.post('/', validateBody(uploadSchema), asyncHandler(async (req, res) => {
  const row = await createDocument(req.body as DocumentInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get('/:id/download', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const file = await getDocumentFile(Number(req.params.id));
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.content.length));
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
  res.send(file.content);
}));

router.delete('/:id', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteDocument(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

export default router;
