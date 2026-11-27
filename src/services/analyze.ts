import { buildActionCard } from '../domain/actionCard.js';
import { DIRECTORY } from '../domain/contacts.js';
import { matchesMagicBytes } from '../domain/fileSniff.js';
import { ModelOutputSchema, type ActionCard, type AnalyzeRequest, type LiveCheckResult, type ModelOutput } from '../domain/schema.js';
import { runVerification } from '../domain/verify.js';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import { cacheKey, type LruCache } from './cache.js';
import { ModelOutputError, type GeminiAnalyzer } from './gemini.js';
import { buildUserParts, type GeminiPart } from './prompt.js';

export interface AnalyzeDeps {
  analyzer: GeminiAnalyzer | undefined;
  cache: LruCache<ActionCard>;
  logger: Logger;
  timeoutMs: number;
  now?: () => number;
}

export interface AnalyzeOutcome {
  card: ActionCard;
  cached: boolean;
}

/** Number of attempts for the structured call when the model returns unusable output. */
export const MAX_ATTEMPTS = 2;

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
        throw new AppError('AI_UNAVAILABLE');
      }
      logger.warn('model output was not JSON', { requestId, attempt });
    }
  }
  throw new AppError('AI_BAD_OUTPUT');
}

async function runLiveCheck(
  analyzer: GeminiAnalyzer,
  output: ModelOutput,
  countryName: string,
  timeoutMs: number,
  logger: Logger,
  requestId: string,
): Promise<LiveCheckResult> {
  const claims = [output.summary, ...output.facts.slice(0, 5).map((f) => `${f.label}: ${f.value}`)];
  try {
    return await analyzer.liveCheck(claims, countryName, AbortSignal.timeout(timeoutMs));
  } catch (err) {
    logger.warn('live check failed', { requestId, error: err instanceof Error ? err.name : 'unknown' });
    return { status: 'error', note: 'The live web cross-check is unavailable right now.', sources: [] };
  }
}

/**
 * Orchestrates one Intake → Action Card request:
 * cache → Gemini structuring (with retry) → verification → optional live check → card.
 */
export async function analyzeIntake(request: AnalyzeRequest, requestId: string, deps: AnalyzeDeps): Promise<AnalyzeOutcome> {
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

  const output = await structureWithRetry(analyzer, parts, AbortSignal.timeout(deps.timeoutMs), deps.logger, requestId);

  const verification = runVerification({
    output,
    userText: request.text ?? '',
    hasFiles: request.files.length > 0,
    country: request.country,
  });

  const liveCheck: LiveCheckResult = request.liveCheck
    ? await runLiveCheck(analyzer, output, country.name, deps.timeoutMs, deps.logger, requestId)
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

  deps.cache.set(key, card);
  return { card, cached: false };
}
