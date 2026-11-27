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
export const THINKING_BUDGET = 1024;

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

/** Production implementation backed by the Google Gen AI SDK (Gemini API). */
export function createGeminiAnalyzer(options: { apiKey: string; model: string }): GeminiAnalyzer {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  const model = options.model;

  return {
    model,
    async structure(parts, signal) {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseJsonSchema: modelOutputJsonSchema,
          temperature: 0.2,
          // Bounded cost and latency: modest thinking, capped output (sourceText can be long).
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
          abortSignal: signal,
        },
      });
      return parseModelJson(response.text);
    },

    async liveCheck(claims, place, signal) {
      const response = await ai.models.generateContent({
        model,
        contents: buildLiveCheckPrompt(claims, place),
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
          abortSignal: signal,
        },
      });
      return parseLiveCheck(response.text, response.candidates?.[0]?.groundingMetadata?.groundingChunks);
    },
  };
}
