import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AppError, toEnvelope } from '../errors.js';

/**
 * Strict security headers. No inline scripts or styles are allowed, which
 * neutralizes XSS even if model output ever reached the DOM unescaped.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
  });
}

/** Restricts powerful browser features to what the app actually uses. */
export function permissionsPolicy(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(self), payment=(), usb=()');
  next();
}

/** Per-IP rate limiter for the API, answering with the standard error envelope. */
export function apiRateLimiter(perMinute: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      const err = new AppError('RATE_LIMITED');
      res.status(err.status).json(toEnvelope(err, req.requestId));
    },
  });
}
