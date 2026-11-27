import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIME_TYPES,
  AnalyzeRequestSchema,
  base64DecodedBytes,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TEXT_CHARS,
  modelOutputJsonSchema,
  ModelOutputSchema,
  type ModelOutput,
} from '../../src/domain/schema.js';
import { PNG_B64, validModelOutput } from '../helpers/fixtures.js';

const png = { name: 'photo.png', mimeType: 'image/png', data: PNG_B64 };

const issuesOf = (input: unknown): string[] => {
  const r = AnalyzeRequestSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('base64DecodedBytes', () => {
  it.each([
    ['AAAA', 3],
    ['AAA=', 2],
    ['AA==', 1],
    [Buffer.alloc(100).toString('base64'), 100],
    [Buffer.alloc(101).toString('base64'), 101],
    [Buffer.alloc(102).toString('base64'), 102],
  ])('computes the decoded size of %j as %i bytes', (b64, bytes) => {
    expect(base64DecodedBytes(b64)).toBe(bytes);
  });
});

describe('AnalyzeRequestSchema', () => {
  it('applies defaults for files, language, country and liveCheck', () => {
    const r = AnalyzeRequestSchema.parse({ text: '  chest pain  ' });
    expect(r).toEqual({ text: 'chest pain', files: [], language: 'en', country: 'IN', liveCheck: false });
  });

  it('defaults a missing file name to "upload"', () => {
    const r = AnalyzeRequestSchema.parse({ files: [{ mimeType: 'image/png', data: PNG_B64 }] });
    expect(r.files[0]?.name).toBe('upload');
    expect(r.text).toBeUndefined();
  });

  it('accepts a complete request', () => {
    const r = AnalyzeRequestSchema.safeParse({
      text: 'Flood water entering the house',
      files: [png],
      language: 'hi',
      country: 'US',
      location: { lat: 18.52, lng: 73.85 },
      liveCheck: true,
    });
    expect(r.success).toBe(true);
  });

  it.each([{}, { text: '' }, { text: '    ' }, { files: [] }])('requires text or at least one file: %j', (body) => {
    expect(issuesOf(body)).toContain('text: Provide text or at least one file');
  });

  it('rejects unknown top-level keys (strict)', () => {
    expect(issuesOf({ text: 'help', admin: true }).join()).toMatch(/admin/);
  });

  it('rejects unknown keys inside files and location', () => {
    expect(issuesOf({ files: [{ ...png, url: 'http://x' }] }).join()).toMatch(/url/);
    expect(issuesOf({ text: 'x', location: { lat: 1, lng: 2, alt: 3 } }).join()).toMatch(/alt/);
  });

  it('rejects text longer than the maximum', () => {
    expect(AnalyzeRequestSchema.safeParse({ text: 'a'.repeat(MAX_TEXT_CHARS) }).success).toBe(true);
    expect(issuesOf({ text: 'a'.repeat(MAX_TEXT_CHARS + 1) })[0]).toMatch(/^text:/);
  });

  it(`rejects more than ${MAX_FILES} files`, () => {
    const files = Array.from({ length: MAX_FILES + 1 }, () => png);
    expect(AnalyzeRequestSchema.safeParse({ files: files.slice(0, MAX_FILES) }).success).toBe(true);
    expect(issuesOf({ files })[0]).toMatch(/^files:/);
  });

  it('rejects a MIME type outside the allow-list', () => {
    expect(issuesOf({ files: [{ ...png, mimeType: 'text/html' }] })[0]).toMatch(/^files\.0\.mimeType:/);
    expect(issuesOf({ files: [{ ...png, mimeType: 'image/svg+xml' }] })[0]).toMatch(/mimeType/);
  });

  it.each(['not base64!', 'data:image/png;base64,iVBO', 'AAAA===', 'AB'])('rejects non-base64 data %j', (data) => {
    expect(issuesOf({ files: [{ ...png, data }] }).join()).toMatch(/files\.0\.data/);
  });

  it('rejects a file whose decoded size exceeds 5 MB, without decoding it', () => {
    const over = 'A'.repeat(Math.ceil((MAX_FILE_BYTES + 1) / 3) * 4);
    expect(base64DecodedBytes(over)).toBeGreaterThan(MAX_FILE_BYTES);
    expect(issuesOf({ files: [{ ...png, data: over }] })).toContain('files.0.data: file exceeds 5 MB');
  });

  it('accepts a file just under 5 MB', () => {
    const fits = 'A'.repeat(Math.floor(MAX_FILE_BYTES / 3) * 4);
    expect(base64DecodedBytes(fits)).toBeLessThanOrEqual(MAX_FILE_BYTES);
    expect(AnalyzeRequestSchema.safeParse({ files: [{ ...png, data: fits }] }).success).toBe(true);
  });

  it('rejects file names longer than 120 characters', () => {
    expect(issuesOf({ files: [{ ...png, name: 'x'.repeat(121) }] })[0]).toMatch(/files\.0\.name/);
  });

  it.each([
    ['language', 'xx'],
    ['country', 'FR'],
    ['liveCheck', 'yes'],
  ])('rejects an invalid %s', (key, value) => {
    expect(issuesOf({ text: 'help', [key]: value })[0]).toMatch(new RegExp(`^${key}:`));
  });

  it.each([
    { lat: 91, lng: 0 },
    { lat: -91, lng: 0 },
    { lat: 0, lng: 181 },
    { lat: 0, lng: -181 },
    { lat: '10', lng: 0 },
  ])('rejects out-of-range or non-numeric location %j', (location) => {
    expect(issuesOf({ text: 'help', location })[0]).toMatch(/^location\./);
  });

  it('rejects non-object bodies', () => {
    expect(AnalyzeRequestSchema.safeParse(null).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse('text').success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse([]).success).toBe(false);
  });

  it('allows every declared MIME type', () => {
    for (const mimeType of ALLOWED_MIME_TYPES) {
      expect(AnalyzeRequestSchema.safeParse({ files: [{ ...png, mimeType }] }).success).toBe(true);
    }
  });
});

describe('ModelOutputSchema', () => {
  it('accepts a valid model output', () => {
    expect(ModelOutputSchema.safeParse(validModelOutput()).success).toBe(true);
  });

  it('accepts empty optional arrays', () => {
    const out = validModelOutput({ facts: [], redFlags: [], missingInformation: [], services: [] });
    expect(ModelOutputSchema.safeParse(out).success).toBe(true);
  });

  it.each([
    ['unknown severity', { severity: 'apocalyptic' }],
    ['unknown domain', { domain: 'alien_invasion' }],
    ['empty summary', { summary: '' }],
    ['no actions', { actions: [] }],
    ['unknown service', { services: ['pizza'] }],
    ['confidence > 1', { facts: [{ label: 'a', value: 'b', evidence: 'c', confidence: 1.5 }] }],
    ['confidence < 0', { facts: [{ label: 'a', value: 'b', evidence: 'c', confidence: -0.1 }] }],
    [
      'unknown actor',
      { actions: [{ instruction: 'go', actor: 'robot', timeframe: 'immediately', rationale: 'r' }] },
    ],
    [
      'unknown timeframe',
      { actions: [{ instruction: 'go', actor: 'caller', timeframe: 'someday', rationale: 'r' }] },
    ],
  ])('rejects %s', (_name, override) => {
    expect(ModelOutputSchema.safeParse({ ...validModelOutput(), ...override }).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const rest: Partial<ModelOutput> = validModelOutput();
    delete rest.summary;
    expect(ModelOutputSchema.safeParse(rest).success).toBe(false);
  });
});

describe('modelOutputJsonSchema', () => {
  it('is a JSON Schema object without the $schema key (Gemini rejects it)', () => {
    expect(modelOutputJsonSchema).not.toHaveProperty('$schema');
    expect(modelOutputJsonSchema.type).toBe('object');
  });

  it('describes every ModelOutput property and marks them required', () => {
    const properties = modelOutputJsonSchema.properties as Record<string, { description?: string }>;
    const keys = Object.keys(ModelOutputSchema.shape);
    expect(Object.keys(properties).sort()).toEqual([...keys].sort());
    expect((modelOutputJsonSchema.required as string[]).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(properties[key]?.description).toBeTruthy();
  });

  it('constrains enums to the same values as the zod schema', () => {
    const properties = modelOutputJsonSchema.properties as Record<string, { enum?: string[] }>;
    expect(properties.severity?.enum).toEqual(['critical', 'high', 'moderate', 'low']);
  });
});
