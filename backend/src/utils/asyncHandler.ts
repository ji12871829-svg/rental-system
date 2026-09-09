import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Routes never try/catch themselves — async errors flow to the central
// error handler through this wrapper.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}