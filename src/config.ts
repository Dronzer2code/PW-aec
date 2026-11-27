import { z } from 'zod';

/** Pinned, tested, fast lite model versions (~3 s per Action Card) (an alias such as `gemini-flash-latest` can change behaviour or vanish). */
export const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
/** Tried in order when the primary model is overloaded (HTTP 429/5xx). */
export const DEFAULT_FALLBACK_MODELS: readonly string[] = ['gemini-3.5-flash-lite', 'gemini-2.5-flash'];

/** Google Search grounding is available on the free tier for this model. */
export const DEFAULT_LIVE_CHECK_MODEL = 'gemini-2.5-flash';

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().min(1).default(DEFAULT_MODEL),
  GEMINI_FALLBACK_MODELS: z.string().trim().default(DEFAULT_FALLBACK_MODELS.join(',')),
  GEMINI_LIVE_CHECK_MODEL: z.string().trim().min(1).default(DEFAULT_LIVE_CHECK_MODEL),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(600),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(0).max(10_000).default(100),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
});

/** Validated, immutable runtime configuration. */
export interface AppConfig {
  readonly geminiApiKey: string | undefined;
  readonly geminiModel: string;
  readonly geminiFallbackModels: readonly string[];
  readonly geminiLiveCheckModel: string;
  readonly port: number;
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly rateLimitPerMinute: number;
  readonly cacheTtlMs: number;
  readonly cacheMaxEntries: number;
  readonly geminiTimeoutMs: number;
}

/**
 * Parses and validates environment variables into an {@link AppConfig}.
 * Throws a descriptive error at startup instead of failing later at runtime.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  return Object.freeze({
    geminiApiKey: e.GEMINI_API_KEY ? e.GEMINI_API_KEY : undefined,
    geminiModel: e.GEMINI_MODEL,
    geminiLiveCheckModel: e.GEMINI_LIVE_CHECK_MODEL,
    geminiFallbackModels: Object.freeze(
      e.GEMINI_FALLBACK_MODELS.split(',')
        .map((m) => m.trim())
        .filter((m) => m.length > 0),
    ),
    port: e.PORT,
    nodeEnv: e.NODE_ENV,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    cacheTtlMs: e.CACHE_TTL_SECONDS * 1000,
    cacheMaxEntries: e.CACHE_MAX_ENTRIES,
    geminiTimeoutMs: e.GEMINI_TIMEOUT_MS,
  });
}
