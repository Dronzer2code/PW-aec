import { GoogleGenAI } from '@google/genai';
import { modelOutputJsonSchema, type LiveCheckResult, type LiveCheckSource } from '../domain/schema.js';
import { truncate } from '../domain/text.js';
import { buildLiveCheckPrompt, SYSTEM_INSTRUCTION, type GeminiPart } from './prompt.js';

/**
 * Abstraction over Gemini so routes and tests depend on behaviour, not on the
 * SDK. `createApp` receives an implementation; tests inject a fake.
 */
export interface GeminiAnalyzer {
  readonly model: string;
  /** Structured extraction call. Returns parsed JSON (validated by the caller). */
  structure(parts: GeminiPart[], signal: AbortSignal): Promise<unknown>;
  /** Google Search grounded cross-check of key claims. Never throws for model content issues. */
  liveCheck(claims: readonly string[], place: string, signal: AbortSignal): Promise<LiveCheckResult>;
}

/** Thrown when Gemini returns text that is not valid JSON. */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

export const MAX_OUTPUT_TOKENS = 8192;
/**
 * Models that accept `thinkingBudget: 0`. Turning thinking off keeps a lite
 * model at ~3 s instead of ~40 s of dynamic thinking. Newer lite models reject
 * a zero budget and are already fast with their default, so they get no config.
 */
const ZERO_THINKING_MODELS = /^gemini-(2\.5|3\.1)-/;

/** Thinking settings for a model: off where supported, otherwise the model default. */
export function thinkingConfigFor(model: string): { thinkingConfig?: { thinkingBudget: number } } {
  return ZERO_THINKING_MODELS.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
}

const STATUS_RE = /STATUS:\s*(CORROBORATED|CONTRADICTED|INCONCLUSIVE)/i;
const MAX_SOURCES = 5;

interface GroundingChunkLike {
  web?: { uri?: string; title?: string };
}

/** Keeps only http(s) URLs so the UI can never receive a `javascript:` link. */
export function safeHttpUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Parses the grounded reply. Sources come only from grounding metadata, never from model text. */
export function parseLiveCheck(text: string | undefined, chunks: readonly GroundingChunkLike[] | undefined): LiveCheckResult {
  const body = (text ?? '').trim();
  const match = STATUS_RE.exec(body);
  const status = match?.[1] === undefined ? 'inconclusive' : (match[1].toLowerCase() as LiveCheckResult['status']);
  const note = truncate(body.replace(STATUS_RE, '').trim(), 400) || 'No explanation returned.';

  const seen = new Set<string>();
  const sources: LiveCheckSource[] = [];
  for (const chunk of chunks ?? []) {
    const url = safeHttpUrl(chunk.web?.uri);
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title: truncate(chunk.web?.title ?? new URL(url).hostname, 120), url });
    if (sources.length >= MAX_SOURCES) break;
  }
  return { status, note, sources };
}

/** Parses the structured call text into JSON, tolerating a stray Markdown fence. */
export function parseModelJson(text: string | undefined): unknown {
  if (text === undefined || text.trim().length === 0) throw new ModelOutputError('Empty model response');
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new ModelOutputError('Model response was not valid JSON');
  }
}

/** Gemini answers with these statuses when a model is overloaded or rate limited; another model may still work. */
const FAILOVER_STATUSES: ReadonlySet<number> = new Set([429, 500, 503]);

/** True when an SDK error means "try the next model" rather than "the request itself is wrong". */
export function isFailoverError(err: unknown): boolean {
  const status = typeof err === 'object' && err !== null ? (err as { status?: unknown }).status : undefined;
  return typeof status === 'number' && FAILOVER_STATUSES.has(status);
}

/**
 * Calls `fn` with each model in order, moving to the next one only when the
 * current model is overloaded (429/5xx) and the request has not been aborted.
 */
export async function withModelFailover<T>(
  models: readonly string[],
  signal: AbortSignal,
  fn: (model: string, attemptSignal: AbortSignal) => Promise<T>,
  attemptTimeoutMs?: number,
): Promise<T> {
  let lastError: unknown = new Error('No Gemini model configured');
  for (const [i, model] of models.entries()) {
    // Every model but the last gets its own deadline, so one stuck in a slow queue
    // hands over to the next instead of consuming the whole request budget.
    const isLast = i === models.length - 1;
    const attemptSignal =
      attemptTimeoutMs === undefined || isLast ? signal : AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]);
    try {
      return await fn(model, attemptSignal);
    } catch (err) {
      lastError = err;
      if (signal.aborted) throw err;
      const stalled = attemptSignal !== signal && attemptSignal.aborted;
      if (!stalled && !isFailoverError(err)) throw err;
    }
  }
  throw lastError;
}

/** Per-model deadline before failing over to the next model (lite models normally answer in ~3 s). */
export const ATTEMPT_TIMEOUT_MS = 12_000;

/**
 * Production implementation backed by the Google Gen AI SDK (Gemini API).
 * `fallbackModels` are tried in order when the primary model is overloaded.
 */
export function createGeminiAnalyzer(options: {
  apiKey: string;
  model: string;
  fallbackModels?: readonly string[];
  /** Model tried first for Google Search grounding (free-tier grounding quota differs per model). */
  liveCheckModel?: string;
}): GeminiAnalyzer {
  // v1beta exposes systemInstruction, JSON-schema output and Google Search grounding for every key type.
  const ai = new GoogleGenAI({ apiKey: options.apiKey, apiVersion: 'v1beta' });
  const model = options.model;
  const models = [model, ...(options.fallbackModels ?? []).filter((m) => m !== model)];
  const liveModels =
    options.liveCheckModel === undefined
      ? models
      : [options.liveCheckModel, ...models.filter((m) => m !== options.liveCheckModel)];

  const structureConfig = (model: string, signal: AbortSignal) => ({
    systemInstruction: SYSTEM_INSTRUCTION,
    responseMimeType: 'application/json',
    responseJsonSchema: modelOutputJsonSchema,
    temperature: 0.2,
    // Bounded cost and latency: no thinking where supported, capped output (sourceText can be long).
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    ...thinkingConfigFor(model),
    abortSignal: signal,
  });

  const liveCheckConfig = (model: string, signal: AbortSignal) => ({
    tools: [{ googleSearch: {} }],
    temperature: 0,
    maxOutputTokens: 1024,
    ...thinkingConfigFor(model),
    abortSignal: signal,
  });

  return {
    model,
    async structure(parts, signal) {
      const response = await withModelFailover(
        models,
        signal,
        (candidate, attemptSignal) =>
          ai.models.generateContent({
            model: candidate,
            contents: [{ role: 'user', parts }],
            config: structureConfig(candidate, attemptSignal),
          }),
        ATTEMPT_TIMEOUT_MS,
      );
      return parseModelJson(response.text);
    },

    async liveCheck(claims, place, signal) {
      const response = await withModelFailover(
        liveModels,
        signal,
        (candidate, attemptSignal) =>
          ai.models.generateContent({
            model: candidate,
            contents: buildLiveCheckPrompt(claims, place),
            config: liveCheckConfig(candidate, attemptSignal),
          }),
        ATTEMPT_TIMEOUT_MS,
      );
      return parseLiveCheck(response.text, response.candidates?.[0]?.groundingMetadata?.groundingChunks);
    },
  };
}
