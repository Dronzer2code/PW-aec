import { describe, expect, it } from 'vitest';
import {
  checkEdgeLimits,
  isLimitedRequest,
  rateLimitedResponse,
  RETRY_AFTER_SECONDS,
  type RateLimitBinding,
} from '../../src/edgeRateLimit.js';

const analyze = (ip = '203.0.113.7', extra: Record<string, string> = {}) =>
  new Request('https://lifebridge.example/api/analyze', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip, ...extra },
    body: '{}',
  });

/** Fake binding that allows `limit` calls per key, recording the keys it saw. */
function fakeLimiter(limit: number): RateLimitBinding & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

describe('isLimitedRequest', () => {
  it('only limits POST /api/analyze', () => {
    expect(isLimitedRequest(analyze())).toBe(true);
    expect(isLimitedRequest(new Request('https://x.example/api/analyze'))).toBe(false);
    expect(isLimitedRequest(new Request('https://x.example/api/config', { method: 'POST' }))).toBe(false);
  });
});

describe('checkEdgeLimits', () => {
  it('lets requests through until the per-client limit, keyed by client IP', async () => {
    const perClient = fakeLimiter(2);
    expect(await checkEdgeLimits(analyze(), { perClient })).toBeNull();
    expect(await checkEdgeLimits(analyze(), { perClient })).toBeNull();
    const blocked = await checkEdgeLimits(analyze(), { perClient });
    expect(blocked?.status).toBe(429);
    expect(perClient.keys).toEqual(['ip:203.0.113.7', 'ip:203.0.113.7', 'ip:203.0.113.7']);
    // A different visitor still has budget.
    expect(await checkEdgeLimits(analyze('198.51.100.1'), { perClient })).toBeNull();
  });

  it('applies the global limit across all clients', async () => {
    const global = fakeLimiter(1);
    expect(await checkEdgeLimits(analyze('192.0.2.1'), { global })).toBeNull();
    expect((await checkEdgeLimits(analyze('192.0.2.2'), { global }))?.status).toBe(429);
    expect(global.keys).toEqual(['global', 'global']);
  });

  it('ignores other routes and missing bindings', async () => {
    const perClient = fakeLimiter(0);
    expect(await checkEdgeLimits(new Request('https://x.example/api/config'), { perClient })).toBeNull();
    expect(await checkEdgeLimits(analyze(), {})).toBeNull();
    expect(perClient.keys).toEqual([]);
  });

  it('fails open when a binding throws', async () => {
    const broken: RateLimitBinding = {
      limit: () => Promise.reject(new Error('binding unavailable')),
    };
    expect(await checkEdgeLimits(analyze(), { perClient: broken, global: broken })).toBeNull();
  });

  it('uses an "unknown" key when the client IP header is missing', async () => {
    const perClient = fakeLimiter(5);
    await checkEdgeLimits(new Request('https://x.example/api/analyze', { method: 'POST' }), { perClient });
    expect(perClient.keys).toEqual(['ip:unknown']);
  });
});

describe('rateLimitedResponse', () => {
  it('returns the standard 429 envelope with Retry-After and a request id', async () => {
    const res = rateLimitedResponse('req-12345678');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe(String(RETRY_AFTER_SECONDS));
    expect(res.headers.get('x-request-id')).toBe('req-12345678');
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.requestId).toBe('req-12345678');
  });

  it('replaces a malformed incoming request id', () => {
    const res = rateLimitedResponse('<script>');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(rateLimitedResponse(null).headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
