import { AppError, toEnvelope } from './errors.js';

/**
 * Edge rate limiting for Cloudflare Workers (Workers Rate Limiting API).
 *
 * The in-process limiter in `src/middleware/security.ts` counts per Worker
 * isolate, and Cloudflare runs many isolates, so on Workers it is only a soft
 * limit. These bindings count at the edge for every isolate in a location,
 * which protects the Gemini quota without requiring users to log in.
 */

/** Shape of a `ratelimits` binding declared in `wrangler.jsonc`. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface EdgeLimiters {
  /** Per client IP, e.g. 6 Action Cards per minute. */
  perClient?: RateLimitBinding;
  /** Whole service, e.g. 60 Action Cards per minute per location. */
  global?: RateLimitBinding;
}

/** Seconds a client is asked to wait (both limiters use a 60 s window). */
export const RETRY_AFTER_SECONDS = 60;

/** Only the Gemini-backed endpoint is expensive enough to need edge limits. */
export function isLimitedRequest(request: Request): boolean {
  return request.method === 'POST' && new URL(request.url).pathname === '/api/analyze';
}

/**
 * Returns a 429 response when a limiter rejects the request, otherwise `null`.
 * A limiter that throws (binding unavailable) fails open: the in-process
 * limiter still applies, and availability matters more than a missed count.
 */
export async function checkEdgeLimits(request: Request, limiters: EdgeLimiters): Promise<Response | null> {
  if (!isLimitedRequest(request)) return null;
  const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const checks: [RateLimitBinding | undefined, string][] = [
    [limiters.perClient, `ip:${clientIp}`],
    [limiters.global, 'global'],
  ];
  for (const [binding, key] of checks) {
    if (binding === undefined) continue;
    let allowed = true;
    try {
      allowed = (await binding.limit({ key })).success;
    } catch {
      allowed = true;
    }
    if (!allowed) return rateLimitedResponse(request.headers.get('x-request-id'));
  }
  return null;
}

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** 429 in the API's standard error envelope. */
export function rateLimitedResponse(incomingRequestId: string | null): Response {
  const requestId = incomingRequestId !== null && SAFE_ID.test(incomingRequestId) ? incomingRequestId : crypto.randomUUID();
  return new Response(JSON.stringify(toEnvelope(new AppError('RATE_LIMITED'), requestId)), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(RETRY_AFTER_SECONDS),
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    },
  });
}
