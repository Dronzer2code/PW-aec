import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createGeminiAnalyzer } from './services/gemini.js';

const config = loadConfig();
const logger = createLogger({ minSeverity: config.nodeEnv === 'development' ? 'DEBUG' : 'INFO' });

const analyzer =
  config.geminiApiKey === undefined
    ? undefined
    : createGeminiAnalyzer({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        fallbackModels: config.geminiFallbackModels,
        liveCheckModel: config.geminiLiveCheckModel,
      });

if (analyzer === undefined) {
  logger.warn('GEMINI_API_KEY is not set; /api/analyze will return AI_UNAVAILABLE');
}

const app = createApp({
  analyzer,
  logger,
  rateLimitPerMinute: config.rateLimitPerMinute,
    analyzeRateLimitPerMinute: config.analyzeRateLimitPerMinute,
  cacheMaxEntries: config.cacheMaxEntries,
  cacheTtlMs: config.cacheTtlMs,
  geminiTimeoutMs: config.geminiTimeoutMs,
});

const server = app.listen(config.port, () => {
  logger.info('LifeBridge listening', { port: config.port, model: config.geminiModel });
});

/** Cloud Run sends SIGTERM before stopping an instance; finish in-flight requests. */
function shutdown(signal: string): void {
  logger.info('shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
