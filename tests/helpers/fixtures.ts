import type { Express } from 'express';
import { createApp, type AppDeps } from '../../src/app.js';
import type { AllowedMimeType, LiveCheckResult, ModelOutput } from '../../src/domain/schema.js';
import { silentLogger } from '../../src/logger.js';
import { ModelOutputError, type GeminiAnalyzer } from '../../src/services/gemini.js';
import type { GeminiPart } from '../../src/services/prompt.js';

/* ------------------------------------------------------------------ */
/* Model output                                                        */
/* ------------------------------------------------------------------ */

/** User text that grounds every fact in {@link validModelOutput}. */
export const SAMPLE_TEXT =
  'My father collapsed at home in Pune. He is 67 years old and allergic to penicillin. He is breathing but not responding.';

/** A schema-valid, fully grounded, non-urgent model output. Override any field. */
export function validModelOutput(overrides: Partial<ModelOutput> = {}): ModelOutput {
  return {
    sourceText: SAMPLE_TEXT,
    detectedLanguage: 'English',
    domain: 'medical_emergency',
    severity: 'low',
    summary: 'A 67 year old man collapsed at home and is not responding.',
    facts: [
      { label: 'Age', value: '67 years', evidence: '67 years old', confidence: 0.95 },
      { label: 'Allergy', value: 'Penicillin', evidence: 'allergic to penicillin', confidence: 0.9 },
      { label: 'Location', value: 'Home, Pune', evidence: 'collapsed at home in Pune', confidence: 0.85 },
    ],
    actions: [
      {
        instruction: 'Check that he is breathing and place him on his side.',
        actor: 'bystander',
        timeframe: 'immediately',
        rationale: 'Keeps the airway open.',
      },
    ],
    redFlags: ['Breathing stops'],
    missingInformation: ['Is he diabetic?'],
    services: ['ambulance'],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Fake Gemini analyzer                                                */
/* ------------------------------------------------------------------ */

export type FakeBehaviour =
  | { kind: 'returns'; output?: unknown }
  | { kind: 'modelOutputError' }
  | { kind: 'invalidThenValid'; output?: unknown }
  | { kind: 'alwaysInvalid' }
  | { kind: 'hangs' }
  | { kind: 'genericError'; message?: string };

export type FakeLiveCheck = { kind: 'returns'; result: LiveCheckResult } | { kind: 'throws' };

export interface FakeAnalyzer extends GeminiAnalyzer {
  readonly structureCalls: { parts: GeminiPart[]; signal: AbortSignal }[];
  readonly liveCheckCalls: { claims: readonly string[]; countryName: string }[];
}

export const FAKE_MODEL = 'fake-gemini';

const waitForAbort = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
  });

/** Fake {@link GeminiAnalyzer} whose behaviour is fully scripted by the test. */
export function fakeAnalyzer(
  behaviour: FakeBehaviour = { kind: 'returns' },
  live: FakeLiveCheck = {
    kind: 'returns',
    result: { status: 'corroborated', note: 'Matches official advisories.', sources: [] },
  },
): FakeAnalyzer {
  const structureCalls: FakeAnalyzer['structureCalls'] = [];
  const liveCheckCalls: FakeAnalyzer['liveCheckCalls'] = [];

  return {
    model: FAKE_MODEL,
    structureCalls,
    liveCheckCalls,
    async structure(parts, signal) {
      structureCalls.push({ parts, signal });
      switch (behaviour.kind) {
        case 'returns':
          return behaviour.output ?? validModelOutput();
        case 'modelOutputError':
          throw new ModelOutputError('Model response was not valid JSON');
        case 'invalidThenValid':
          return structureCalls.length === 1 ? { nope: true } : (behaviour.output ?? validModelOutput());
        case 'alwaysInvalid':
          return { severity: 'apocalyptic' };
        case 'hangs':
          return waitForAbort(signal);
        case 'genericError':
          throw new Error(behaviour.message ?? 'network down');
      }
    },
    async liveCheck(claims, countryName) {
      liveCheckCalls.push({ claims, countryName });
      if (live.kind === 'throws') throw new Error('search unavailable');
      return live.result;
    },
  };
}

/* ------------------------------------------------------------------ */
/* File payloads (magic bytes)                                         */
/* ------------------------------------------------------------------ */

const PAD = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const b64 = (bytes: readonly number[]): string => Buffer.from([...bytes, ...PAD]).toString('base64');
const asciiBytes = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/** Tiny base64 payloads whose leading bytes match each MIME type's signature. */
export const MAGIC_B64: Readonly<Record<AllowedMimeType, string>> = {
  'image/png': b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': b64([0xff, 0xd8, 0xff, 0xe0]),
  'image/webp': b64([...asciiBytes('RIFF'), 0, 0, 0, 0, ...asciiBytes('WEBP')]),
  'application/pdf': b64(asciiBytes('%PDF-1.7')),
  'audio/webm': b64([0x1a, 0x45, 0xdf, 0xa3]),
  'audio/ogg': b64(asciiBytes('OggS')),
  'audio/wav': b64([...asciiBytes('RIFF'), 0, 0, 0, 0, ...asciiBytes('WAVE')]),
  'audio/mp4': b64([0, 0, 0, 0x20, ...asciiBytes('ftypM4A ')]),
  'audio/mpeg': b64(asciiBytes('ID3')),
};

export const PNG_B64 = MAGIC_B64['image/png'];
export const JPEG_B64 = MAGIC_B64['image/jpeg'];
export const PDF_B64 = MAGIC_B64['application/pdf'];
export const WEBM_B64 = MAGIC_B64['audio/webm'];
/** Plain text bytes: matches no signature (e.g. a script renamed to .png). */
export const MISMATCHED_B64 = b64(asciiBytes('#!/bin/sh echo pwned'));

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

/** `createApp` with silent logging, a fake analyzer and generous limits; override anything. */
export function createTestApp(overrides: Partial<AppDeps> = {}): Express {
  return createApp({
    analyzer: fakeAnalyzer(),
    logger: silentLogger,
    rateLimitPerMinute: 1000,
    cacheMaxEntries: 50,
    cacheTtlMs: 60_000,
    geminiTimeoutMs: 5_000,
    ...overrides,
  });
}
