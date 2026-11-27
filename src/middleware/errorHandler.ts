import type { NextFunction, Request, Response } from 'express';
import { AppError, toEnvelope } from '../errors.js';
import type { Logger } from '../logger.js';

/** 404 for unknown API routes. */
export function notFound(req: Request, res: Response): void {
  const err = new AppError('NOT_FOUND');
  res.status(err.status).json(toEnvelope(err, req.requestId));
}

interface HttpLikeError {
  status?: number;
  type?: string;
}

/** Maps body-parser and unknown errors to the envelope; never leaks stack traces. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const httpErr: HttpLikeError = typeof err === 'object' && err !== null ? (err as HttpLikeError) : {};
  if (httpErr.type === 'entity.too.large' || httpErr.status === 413) return new AppError('PAYLOAD_TOO_LARGE');
  if (httpErr.type === 'entity.parse.failed' || httpErr.status === 400) {
    return new AppError('VALIDATION_ERROR', 'The request body is not valid JSON.');
  }
  return new AppError('INTERNAL');
}

export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const appErr = toAppError(err);
    if (appErr.status >= 500) {
      logger.error('request failed', {
        requestId: req.requestId,
        code: appErr.code,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
    res.status(appErr.status).json(toEnvelope(appErr, req.requestId));
  };
}
