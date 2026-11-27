/**
 * Cloudflare Workers entry point (alternative to `src/server.ts` on Cloud Run).
 *
 * The same Express app runs unchanged through Cloudflare's Node.js HTTP server
 * support (`nodejs_compat`). Differences from the container runtime:
 * - Static files in `public/` are served by Workers Static Assets (see
 *   `wrangler.jsonc`), with security headers from `public/_headers`.
 * - Cloudflare compresses responses at the edge, so Express compression is off.
 * - `GEMINI_API_KEY` comes from `wrangler secret put GEMINI_API_KEY`.
 * - The app is created on the first request: Workers forbid timers (used by the
 *   rate limiter's cleanup) during global-scope initialization.
 */
import { handleAsNodeRequest } from 'cloudflare:node';
import { checkEdgeLimits, type RateLimitBinding } from './edgeRateLimit.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createGeminiAnalyzer } from './services/gemini.js';

let port: number | undefined;

function start(): number {
  const config = loadConfig();
  const analyzer =
    config.geminiApiKey === undefined
      ? undefined
      : createGeminiAnalyzer({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        fallbackModels: config.geminiFallbackModels,
        liveCheckModel: config.geminiLiveCheckModel,
      });

  createApp({
    analyzer,
    logger: createLogger(),
    rateLimitPerMinute: config.rateLimitPerMinute,
    analyzeRateLimitPerMinute: config.analyzeRateLimitPerMinute,
    cacheMaxEntries: config.cacheMaxEntries,
    cacheTtlMs: config.cacheTtlMs,
    geminiTimeoutMs: config.geminiTimeoutMs,
    publicDir: null,
    compress: false,
    behindCloudflare: true,
  }).listen(config.port);
  return config.port;
}

/** Bindings declared in `wrangler.jsonc`. */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Per client IP limit on POST /api/analyze (no login required). */
  ANALYZE_PER_CLIENT?: RateLimitBinding;
  /** Whole-service limit on POST /api/analyze, protecting the Gemini quota. */
  ANALYZE_GLOBAL?: RateLimitBinding;
}

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    // Workspace sub pages (/app/cards, /app/samples, ...) are client-side routes of app.html.
    if (url.pathname.startsWith('/app/') && (request.method === 'GET' || request.method === 'HEAD')) {
      return env.ASSETS.fetch(new Request(new URL('/app', url), request));
    }
    const limited = await checkEdgeLimits(request, { perClient: env.ANALYZE_PER_CLIENT, global: env.ANALYZE_GLOBAL });
    if (limited !== null) return limited;
    port ??= start();
    return handleAsNodeRequest(port, request, env, ctx);
  },
};
