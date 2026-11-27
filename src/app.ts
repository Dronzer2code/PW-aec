import compression from 'compression';
import express, { type Express } from 'express';
import { fileURLToPath } from 'node:url';
import type { ActionCard } from './domain/schema.js';
import type { Logger } from './logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { apiRateLimiter, permissionsPolicy, securityHeaders } from './middleware/security.js';
import { analyzeRouter } from './routes/analyze.js';
import { configRouter } from './routes/meta.js';
import { LruCache } from './services/cache.js';
import type { GeminiAnalyzer } from './services/gemini.js';

/** Dependencies injected into the app; tests pass fakes, `server.ts` passes real ones. */
export interface AppDeps {
  analyzer: GeminiAnalyzer | undefined;
  logger: Logger;
  rateLimitPerMinute: number;
  cacheMaxEntries: number;
  cacheTtlMs: number;
  geminiTimeoutMs: number;
  /** Directory served as static files; `null` when the platform serves them (Cloudflare Static Assets). */
  publicDir?: string | null;
  /** gzip responses in-process; disable where the edge already compresses (Cloudflare). Default true. */
  compress?: boolean;
  /** True only on Cloudflare Workers, where `CF-Connecting-IP` is set by the edge. Default false. */
  behindCloudflare?: boolean;
}

/** Max JSON body: 4 files × 5 MB base64-encoded (~6.7 MB each) plus text. */
export const JSON_BODY_LIMIT = '28mb';

/** Client-side budget: structuring + live check calls plus network headroom. */
export function requestTimeoutMs(geminiTimeoutMs: number): number {
  return geminiTimeoutMs * 2 + 10_000;
}

/** `public/` next to `src/` (tsx) or `dist/` (compiled); resolved lazily so non-file runtimes never touch it. */
const defaultPublicDir = (): string => fileURLToPath(new URL('../public', import.meta.url));

/** Express application factory. Pure wiring; no network listeners are opened here. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(securityHeaders());
  app.use(permissionsPolicy);
  if (deps.compress ?? true) app.use(compression());

  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
  });

  const cache = new LruCache<ActionCard>(deps.cacheMaxEntries, deps.cacheTtlMs);
  const api = express.Router();
  api.use(apiRateLimiter(deps.rateLimitPerMinute, { behindCloudflare: deps.behindCloudflare ?? false }));
  api.use(express.json({ limit: JSON_BODY_LIMIT }));
  api.use(
    configRouter({ aiAvailable: deps.analyzer !== undefined, requestTimeoutMs: requestTimeoutMs(deps.geminiTimeoutMs) }),
  );
  api.use(
    analyzeRouter({ analyzer: deps.analyzer, cache, logger: deps.logger, timeoutMs: deps.geminiTimeoutMs }),
  );
  api.use(notFound);
  app.use('/api', api);

  if (deps.publicDir !== null) {
    const publicDir = deps.publicDir ?? defaultPublicDir();
    // Workspace sub pages (/app/cards, /app/samples, ...) are client-side routes of app.html.
    app.get('/app/{*page}', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('app.html', { root: publicDir }, (err) => {
        if (err) next(err);
      });
    });
    app.use(
      express.static(publicDir, {
        index: 'index.html',
        // `/app` serves app.html (the workspace); `/` serves the landing page.
        extensions: ['html'],
        // Unversioned module URLs: revalidate with ETag so a deploy never mixes old and new modules.
        // Icons rarely change and are cached for a day.
        setHeaders: (res, filePath) => {
          res.setHeader('Cache-Control', /\.(svg|png|ico)$/.test(filePath) ? 'public, max-age=86400' : 'no-cache');
        },
      }),
    );
  }
  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}
