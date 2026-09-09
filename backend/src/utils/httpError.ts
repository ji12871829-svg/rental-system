// Consistent error responses: { error: CODE, message, details }.

export class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new HttpError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Authentication required.') =>
  new HttpError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new HttpError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found.') =>
  new HttpError(404, 'NOT_FOUND', message);

export const conflict = (message: string, code = 'CONFLICT') =>
  new HttpError(409, code, message);

export const unprocessable = (message: string, details?: Record<string, unknown>) =>
  new HttpError(422, 'UNPROCESSABLE_ENTITY', message, details);