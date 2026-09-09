import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { badRequest } from '../utils/httpError';

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