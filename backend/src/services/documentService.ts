import { query, queryOne } from '../config/db';
import { paginate } from './paginate';
import { logAudit } from './auditService';
import { badRequest, notFound } from '../utils/httpError';
import type { Pagination } from '../types';

// Document vault (ported from the legacy DocumentController): lease
// agreements, ID scans, inspection reports… linked to a tenant and/or unit.
// Files live as bytea (same home as the branding logo) — no shared disk to
// provision. Listings never carry the blob; downloads stream it back with the
// original filename. 15 MB cap keeps memory and rows sane for a web app.
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export interface DocumentInput {
  title: string;
  docType: string;
  tenantId?: number;
  unitId?: number;
  fileName: string;
  mimeType: string;
  // base64 payload (the browser reads the File and posts the data URL body).
  contentBase64: string;
}

export async function createDocument(input: DocumentInput, userId: number): Promise<{ id: number }> {
  if (!input.tenantId && !input.unitId) {
    throw badRequest('Link the document to a tenant or a unit.');
  }
  const content = Buffer.from(input.contentBase64, 'base64');
  if (content.length === 0) throw badRequest('The uploaded file is empty.');
  if (content.length > MAX_DOCUMENT_BYTES) {
    throw badRequest('Files are capped at 15 MB.');
  }
  const inserted = await query<{ id: number }>(
    `INSERT INTO documents (title, doc_type, tenant_id, unit_id, file_data, file_name, mime_type, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [input.title, input.docType, input.tenantId ?? null, input.unitId ?? null,
     content, input.fileName, input.mimeType, content.length, userId]
  );
  await logAudit({
    userId,
    action: 'DOCUMENT_UPLOADED',
    entity: 'documents',
    entityId: inserted[0].id,
    newValue: { title: input.title, docType: input.docType, tenantId: input.tenantId ?? null, unitId: input.unitId ?? null, fileName: input.fileName, size: content.length },
  });
  return inserted[0];
}

export async function listDocuments(filters: {
  page: number;
  limit: number;
  docType?: string;
  tenantId?: number;
  unitId?: number;
  q?: string;
}): Promise<{ rows: Record<string, unknown>[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.docType) {
    params.push(filters.docType);
    where.push(`d.doc_type = $${params.length}`);
  }
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`d.tenant_id = $${params.length}`);
  }
  if (filters.unitId) {
    params.push(filters.unitId);
    where.push(`d.unit_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(d.title ILIKE $${params.length} OR d.file_name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return paginate<Record<string, unknown>>({
    selectSql: `d.id, d.title, d.doc_type, d.tenant_id, d.unit_id, d.file_name, d.mime_type, d.file_size, d.created_at,
                t.full_name AS tenant_name, u.unit_number`,
    tableSql: `FROM documents d
     LEFT JOIN tenants t ON t.id = d.tenant_id
     LEFT JOIN units u ON u.id = d.unit_id`,
    whereSql,
    params,
    orderBy: `ORDER BY d.created_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}

export interface DocumentDownload {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export async function getDocumentFile(id: number): Promise<DocumentDownload> {
  const row = await queryOne<{ file_name: string; mime_type: string; file_data: Buffer }>(
    'SELECT file_name, mime_type, file_data FROM documents WHERE id = $1',
    [id]
  );
  if (!row) throw notFound('Document not found.');
  return { fileName: row.file_name, mimeType: row.mime_type, content: row.file_data };
}

export async function deleteDocument(id: number, userId: number): Promise<void> {
  const existing = await queryOne<{ title: string }>('SELECT title FROM documents WHERE id = $1', [id]);
  if (!existing) throw notFound('Document not found.');
  await query('DELETE FROM documents WHERE id = $1', [id]);
  await logAudit({
    userId,
    action: 'DOCUMENT_DELETED',
    entity: 'documents',
    entityId: id,
    oldValue: { title: existing.title },
  });
}
