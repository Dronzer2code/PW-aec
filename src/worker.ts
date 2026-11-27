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
    cacheMaxEntries: config.cacheMaxEntries,
    cacheTtlMs: config.cacheTtlMs,
    geminiTimeoutMs: config.geminiTimeoutMs,
    publicDir: null,
    compress: false,
    behindCloudflare: true,
  }).listen(config.port);
  return config.port;
}

export default {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    port ??= start();
    return handleAsNodeRequest(port, request, env, ctx);
  },
};
