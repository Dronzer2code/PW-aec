import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

/**
 * Assigns every request an id (reusing a well-formed incoming `X-Request-Id`)
 * and echoes it in the response so users can quote it when reporting issues.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  req.requestId = incoming !== undefined && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
