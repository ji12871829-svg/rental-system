import type { NextFunction, Request, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { badRequest } from '../utils/httpError';

// Shared list-endpoint query schema: every paginated GET route parses the
// same page/limit pair, so the bounds live here once (1..100 per page,
// default 20) and each route extends it with its own filters.
export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Shared optional month/year bounds (1-12, 2000-2100) for period-filtered
// list endpoints.
export const monthYearQuery = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// Validates req.body (and optional params) against a zod schema. Never trust
// frontend validation — this is the authoritative gate.
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(badRequest('Validation failed.', { issues: details }));
    }
    req.body = result.data;
    return next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(badRequest('Validation failed.', { issues: details }));
    }
    Object.assign(req.query, result.data);
    return next();
  };
}

export function validateParams(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(badRequest('Invalid request parameters.'));
    }
    return next();
  };
}
