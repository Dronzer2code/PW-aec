import { z } from 'zod';
import { LANGUAGE_CODES } from './languages.js';
import { COUNTRY_CODES } from './contacts.js';

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

export const MAX_TEXT_CHARS = 10_000;
export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decoded byte length of a base64 string without allocating a buffer. */
export function base64DecodedBytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export const IntakeFileSchema = z
  .object({
    name: z.string().trim().max(120).default('upload'),
    mimeType: z.enum(ALLOWED_MIME_TYPES),
    data: z
      .string()
      .min(4)
      .regex(BASE64_RE, 'must be base64')
      .refine((d) => base64DecodedBytes(d) <= MAX_FILE_BYTES, { message: 'file exceeds 5 MB' }),
  })
  .strict();

export type IntakeFile = z.infer<typeof IntakeFileSchema>;

export const AnalyzeRequestSchema = z
  .object({
    text: z.string().trim().max(MAX_TEXT_CHARS).optional(),
    files: z.array(IntakeFileSchema).max(MAX_FILES).default([]),
    language: z.enum(LANGUAGE_CODES).default('en'),
    country: z.enum(COUNTRY_CODES).default('IN'),
    location: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .strict()
      .optional(),
    liveCheck: z.boolean().default(false),
  })
  .strict()
  .refine((r) => (r.text !== undefined && r.text.length > 0) || r.files.length > 0, {
    message: 'Provide text or at least one file',
    path: ['text'],
  });

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

/* ------------------------------------------------------------------ */
/* Model output (Gemini structured response)                           */
/* ------------------------------------------------------------------ */

export const DOMAINS = [
  'medical_emergency',
  'medical_history',
  'road_accident',
  'fire',
  'natural_disaster',
  'crime_or_safety',
  'public_health',
  'other',
] as const;

export const SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const;
export const ACTORS = ['caller', 'bystander', 'caregiver', 'authority'] as const;
export const TIMEFRAMES = ['immediately', 'within_1_hour', 'today', 'ongoing'] as const;
export const SERVICES = [
  'general_emergency',
  'ambulance',
  'police',
  'fire',
  'disaster',
  'child_helpline',
  'women_helpline',
] as const;

export type Domain = (typeof DOMAINS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Service = (typeof SERVICES)[number];

export const ModelFactSchema = z.object({
  label: z.string().min(1).describe('Short name of the fact, e.g. "Allergy", "Location", "Injury".'),
  value: z.string().min(1).describe('Normalized value of the fact in the output language.'),
  evidence: z
    .string()
    .describe('Exact verbatim quote (3-120 chars) copied from the intake or sourceText that supports this fact.'),
  confidence: z.number().min(0).max(1).describe('Confidence 0..1 that the fact is correct.'),
});

export const ModelActionSchema = z.object({
  instruction: z
    .string()
    .min(1)
    .describe('One short imperative step in the output language. No phone numbers. No medication doses.'),
  actor: z.enum(ACTORS).describe('Who should perform the step.'),
  timeframe: z.enum(TIMEFRAMES).describe('When the step must happen.'),
  rationale: z.string().describe('One short sentence explaining why the step matters.'),
});

export const ModelOutputSchema = z.object({
  sourceText: z
    .string()
    .describe(
      'Verbatim transcription of ALL inputs in their original language: typed text, speech in audio, and text visible in images/PDFs.',
    ),
  detectedLanguage: z.string().describe('Language(s) of the input, e.g. "Hindi + English".'),
  domain: z.enum(DOMAINS).describe('Best matching situation category.'),
  severity: z
    .enum(SEVERITIES)
    .describe('critical = life threatening now; high = urgent within hours; moderate; low.'),
  summary: z.string().min(1).describe('2-3 sentence plain-language summary in the output language.'),
  facts: z.array(ModelFactSchema).describe('Up to 15 key structured facts.'),
  actions: z.array(ModelActionSchema).min(1).describe('Up to 8 actions ordered by priority, most urgent first.'),
  redFlags: z.array(z.string()).describe('Up to 6 warning signs that require escalation.'),
  missingInformation: z.array(z.string()).describe('Up to 5 questions whose answers would change the plan.'),
  services: z.array(z.enum(SERVICES)).describe('Emergency services relevant to this situation.'),
});

export type ModelOutput = z.infer<typeof ModelOutputSchema>;
export type ModelFact = z.infer<typeof ModelFactSchema>;
export type ModelAction = z.infer<typeof ModelActionSchema>;

/** Upper bounds applied after validation so oversized model answers are trimmed, not rejected. */
export const OUTPUT_LIMITS = {
  facts: 15,
  actions: 8,
  redFlags: 6,
  missingInformation: 5,
  sourceTextChars: 20_000,
  fieldChars: 600,
} as const;

/**
 * JSON Schema passed to Gemini as `responseJsonSchema`, generated from the zod
 * schema so the model contract and runtime validation can never drift apart.
 */
export const modelOutputJsonSchema: Record<string, unknown> = (() => {
  const schema = z.toJSONSchema(ModelOutputSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
})();

/* ------------------------------------------------------------------ */
/* Action Card (API response)                                          */
/* ------------------------------------------------------------------ */

export type FactStatus = 'grounded' | 'transcribed' | 'unverified';
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type ActionFlag = 'dosage_removed' | 'number_redacted' | 'escalation_added';

export interface VerifiedFact extends ModelFact {
  status: FactStatus;
  needsReview: boolean;
}

export interface VerifiedAction extends ModelAction {
  flags: ActionFlag[];
}

export interface VerificationCheck {
  id: string;
  status: CheckStatus;
  message: string;
}

export interface VerificationReport {
  status: 'verified' | 'needs_review';
  groundingScore: number;
  checks: VerificationCheck[];
}

export interface EmergencyContact {
  service: Service;
  label: string;
  number: string;
  tel: string;
}

export type LiveCheckStatus = 'corroborated' | 'contradicted' | 'inconclusive' | 'skipped' | 'error';

export interface LiveCheckSource {
  title: string;
  url: string;
}

export interface LiveCheckResult {
  status: LiveCheckStatus;
  note: string;
  sources: LiveCheckSource[];
}

export interface MapsLink {
  label: string;
  url: string;
}

export interface ActionCard {
  domain: Domain;
  severity: Severity;
  summary: string;
  detectedLanguage: string;
  sourceText: string;
  facts: VerifiedFact[];
  actions: VerifiedAction[];
  redFlags: string[];
  missingInformation: string[];
  contacts: EmergencyContact[];
  verification: VerificationReport;
  liveCheck: LiveCheckResult;
  smsText: string;
  mapsLinks: MapsLink[];
  disclaimer: string;
  meta: { requestId: string; model: string; cached: boolean; latencyMs: number; outputLanguage: string };
}
