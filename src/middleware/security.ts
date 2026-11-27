import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
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

/**
 * Client IP used as the rate-limit key. On Cloudflare Workers the edge sets
 * `CF-Connecting-IP` (clients cannot forge it there); everywhere else the header
 * is ignored and `req.ip` (correct on Cloud Run via `trust proxy`) is used.
 * IPv6 addresses are grouped by /56 subnet so one client cannot rotate addresses.
 */
export function clientKey(req: Request, trustCloudflareHeader: boolean): string {
  const ip = (trustCloudflareHeader ? req.get('cf-connecting-ip') : undefined) ?? req.ip ?? 'unknown';
  return ipKeyGenerator(ip);
}

/** Per-IP rate limiter for the API, answering with the standard error envelope. */
export function apiRateLimiter(perMinute: number, options: { behindCloudflare?: boolean } = {}): RequestHandler {
  const trustCloudflareHeader = options.behindCloudflare ?? false;
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => clientKey(req, trustCloudflareHeader),
    handler: (req, res) => {
      const err = new AppError('RATE_LIMITED');
      res.status(err.status).json(toEnvelope(err, req.requestId));
    },
  });
}
