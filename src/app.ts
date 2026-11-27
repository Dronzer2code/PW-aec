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
  publicDir?: string;
}

/** Max JSON body: 4 files × 5 MB base64-encoded (~6.7 MB each) plus text. */
export const JSON_BODY_LIMIT = '28mb';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/** Express application factory. Pure wiring; no network listeners are opened here. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(securityHeaders());
  app.use(permissionsPolicy);
  app.use(compression());

  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
  });

  const cache = new LruCache<ActionCard>(deps.cacheMaxEntries, deps.cacheTtlMs);
  const api = express.Router();
  api.use(apiRateLimiter(deps.rateLimitPerMinute));
  api.use(express.json({ limit: JSON_BODY_LIMIT }));
  api.use(configRouter({ aiAvailable: deps.analyzer !== undefined }));
  api.use(
    analyzeRouter({ analyzer: deps.analyzer, cache, logger: deps.logger, timeoutMs: deps.geminiTimeoutMs }),
  );
  api.use(notFound);
  app.use('/api', api);

  app.use(
    express.static(deps.publicDir ?? DEFAULT_PUBLIC_DIR, {
      index: 'index.html',
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}
