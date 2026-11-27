import { buildActionCard } from '../domain/actionCard.js';
import { DIRECTORY, type CountryCode } from '../domain/contacts.js';
import { matchesMagicBytes } from '../domain/fileSniff.js';
import { ModelOutputSchema, type ActionCard, type AnalyzeRequest, type LiveCheckResult, type ModelOutput } from '../domain/schema.js';
import { redactUnknownNumbers, runVerification } from '../domain/verify.js';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import { cacheKey, type LruCache } from './cache.js';
import { ModelOutputError, type GeminiAnalyzer } from './gemini.js';
import { buildUserParts, type GeminiPart } from './prompt.js';

export interface AnalyzeDeps {
  analyzer: GeminiAnalyzer | undefined;
  cache: LruCache<ActionCard>;
  logger: Logger;
  /** Per Gemini call timeout. A request makes at most two sequential calls. */
  timeoutMs: number;
  now?: () => number;
}

export interface AnalyzeOutcome {
  card: ActionCard;
  cached: boolean;
}

/** Number of attempts for the structured call when the model returns unusable output. */
export const MAX_ATTEMPTS = 2;

/** HTTP statuses from Gemini that mean the service is misconfigured (bad key, unknown model), not busy. */
const CONFIG_ERROR_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404]);

/** Maps a Gemini SDK error to a non-retryable configuration error or a retryable upstream error. */
export function toUpstreamError(err: unknown): AppError {
  const status = typeof err === 'object' && err !== null ? (err as { status?: unknown }).status : undefined;
  return typeof status === 'number' && CONFIG_ERROR_STATUSES.has(status)
    ? new AppError('AI_UNAVAILABLE')
    : new AppError('AI_UPSTREAM_ERROR');
}

/** Describes where the situation is, for the live check, using only coarse (about 1 km) coordinates. */
export function describePlace(countryName: string, location: AnalyzeRequest['location']): string {
  if (location === undefined) return countryName;
  return `${countryName}, near latitude ${location.lat.toFixed(2)}, longitude ${location.lng.toFixed(2)}`;
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));
}

/** Rejects files whose bytes do not match their declared type. */
export function assertFilesMatchTypes(request: AnalyzeRequest): void {
  const bad = request.files.filter((f) => !matchesMagicBytes(f.mimeType, f.data)).map((f) => f.name);
  if (bad.length > 0) {
    throw new AppError('VALIDATION_ERROR', 'A file does not match its declared type.', bad.map((n) => `files: ${n}`));
  }
}

async function structureWithRetry(
  analyzer: GeminiAnalyzer,
  parts: GeminiPart[],
  signal: AbortSignal,
  logger: Logger,
  requestId: string,
): Promise<ModelOutput> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = await analyzer.structure(parts, signal);
      const parsed = ModelOutputSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      logger.warn('model output failed schema validation', { requestId, attempt, issues: parsed.error.issues.length });
    } catch (err) {
      if (isAbort(err, signal)) throw new AppError('AI_TIMEOUT');
      if (!(err instanceof ModelOutputError)) {
        logger.error('gemini request failed', { requestId, error: err instanceof Error ? err.message : 'unknown' });
        throw toUpstreamError(err);
      }
      logger.warn('model output was not JSON', { requestId, attempt });
    }
  }
  throw new AppError('AI_BAD_OUTPUT');
}

async function runLiveCheck(
  analyzer: GeminiAnalyzer,
  output: ModelOutput,
  context: { place: string; country: CountryCode; signal: AbortSignal },
  logger: Logger,
  requestId: string,
): Promise<LiveCheckResult> {
  const claims = [output.summary, ...output.facts.slice(0, 5).map((f) => `${f.label}: ${f.value}`)];
  try {
    const result = await analyzer.liveCheck(claims, context.place, context.signal);
    // The note is model text too: it must never carry an unverified phone number.
    return { ...result, note: redactUnknownNumbers(result.note, context.country).text };
  } catch (err) {
    logger.warn('live check failed', { requestId, error: err instanceof Error ? err.name : 'unknown' });
    return { status: 'error', note: 'The live web cross-check is unavailable right now.', sources: [] };
  }
}

/**
 * Orchestrates one Intake → Action Card request:
 * cache → Gemini structuring (with retry) → verification → optional live check → card.
 */
export async function analyzeIntake(
  request: AnalyzeRequest,
  requestId: string,
  deps: AnalyzeDeps,
  clientSignal?: AbortSignal,
): Promise<AnalyzeOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  assertFilesMatchTypes(request);

  const key = cacheKey(request);
  const hit = deps.cache.get(key);
  if (hit !== undefined) {
    return {
      cached: true,
      card: { ...hit, meta: { ...hit.meta, requestId, cached: true, latencyMs: now() - started } },
    };
  }

  const analyzer = deps.analyzer;
  if (analyzer === undefined) throw new AppError('AI_UNAVAILABLE');

  const country = DIRECTORY[request.country];
  const parts = buildUserParts({
    text: request.text,
    files: request.files,
    language: request.language,
    countryName: country.name,
  });

  /** Each Gemini call stops at its timeout, or as soon as the client disconnects. */
  const callSignal = (): AbortSignal => {
    const timeout = AbortSignal.timeout(deps.timeoutMs);
    return clientSignal === undefined ? timeout : AbortSignal.any([clientSignal, timeout]);
  };

  const output = await structureWithRetry(analyzer, parts, callSignal(), deps.logger, requestId);

  const verification = runVerification({
    output,
    userText: request.text ?? '',
    hasFiles: request.files.length > 0,
    country: request.country,
    language: request.language,
  });

  const liveCheck: LiveCheckResult = request.liveCheck
    ? await runLiveCheck(
        analyzer,
        output,
        { place: describePlace(country.name, request.location), country: request.country, signal: callSignal() },
        deps.logger,
        requestId,
      )
    : { status: 'skipped', note: 'Live web cross-check was not requested.', sources: [] };

  const card = buildActionCard({
    output,
    verification,
    country: request.country,
    outputLanguage: request.language,
    location: request.location,
    liveCheck,
    meta: { requestId, model: analyzer.model, latencyMs: now() - started },
  });

  // A failed live check is transient: do not pin it in the cache for the whole TTL.
  if (liveCheck.status !== 'error') deps.cache.set(key, card);
  return { card, cached: false };
}
