import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelOutputJsonSchema } from '../../src/domain/schema.js';
import {
  createGeminiAnalyzer,
  ModelOutputError,
  parseLiveCheck,
  parseModelJson,
  safeHttpUrl,
} from '../../src/services/gemini.js';
import { SYSTEM_INSTRUCTION } from '../../src/services/prompt.js';
import { validModelOutput } from '../helpers/fixtures.js';

const sdk = vi.hoisted(() => ({
  generateContent: vi.fn(),
  constructorArgs: [] as unknown[],
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: sdk.generateContent };
    constructor(options: unknown) {
      sdk.constructorArgs.push(options);
    }
  },
}));

describe('safeHttpUrl', () => {
  it.each([
    ['https://who.int/news', 'https://who.int/news'],
    ['http://example.org', 'http://example.org/'],
  ])('keeps %s', (raw, expected) => {
    expect(safeHttpUrl(raw)).toBe(expected);
  });

  it.each([undefined, 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://x.org/a', 'not a url', ''])(
    'drops %j',
    (raw) => {
      expect(safeHttpUrl(raw)).toBeUndefined();
    },
  );
});

describe('parseModelJson', () => {
  const json = JSON.stringify(validModelOutput());

  it('parses plain JSON', () => {
    expect(parseModelJson(json)).toEqual(validModelOutput());
  });

  it.each([`\`\`\`json\n${json}\n\`\`\``, `\`\`\`\n${json}\n\`\`\``, `  \`\`\`JSON ${json}\`\`\`  `])(
    'tolerates a Markdown fence',
    (text) => {
      expect(parseModelJson(text)).toEqual(validModelOutput());
    },
  );

  it.each([undefined, '', '   \n'])('throws ModelOutputError for an empty response %j', (text) => {
    expect(() => parseModelJson(text)).toThrow(ModelOutputError);
    expect(() => parseModelJson(text)).toThrow('Empty model response');
  });

  it.each(['{"summary": ', 'Sorry, I cannot help with that.', '```json\n{oops}\n```'])(
    'throws ModelOutputError for invalid JSON %j',
    (text) => {
      expect(() => parseModelJson(text)).toThrow(new ModelOutputError('Model response was not valid JSON'));
    },
  );

  it('ModelOutputError carries its name', () => {
    const err = new ModelOutputError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ModelOutputError');
  });
});

describe('parseLiveCheck', () => {
  it.each([
    ['STATUS: CORROBORATED\nIMD issued a red alert.', 'corroborated'],
    ['status: contradicted - no such alert exists', 'contradicted'],
    ['STATUS:INCONCLUSIVE', 'inconclusive'],
  ] as const)('reads the status from %j', (text, status) => {
    expect(parseLiveCheck(text, undefined).status).toBe(status);
  });

  it('strips the status line from the note', () => {
    expect(parseLiveCheck('STATUS: CORROBORATED\nIMD issued a red alert.', []).note).toBe('IMD issued a red alert.');
  });

  it('falls back to inconclusive with a default note when the reply is empty or malformed', () => {
    expect(parseLiveCheck(undefined, undefined)).toEqual({
      status: 'inconclusive',
      note: 'No explanation returned.',
      sources: [],
    });
    expect(parseLiveCheck('It is probably true.', undefined)).toMatchObject({
      status: 'inconclusive',
      note: 'It is probably true.',
    });
  });

  it('caps the note at 400 characters', () => {
    expect(parseLiveCheck(`STATUS: CORROBORATED ${'a'.repeat(1000)}`, []).note).toHaveLength(400);
  });

  it('keeps only http(s) grounding sources, de-duplicated, at most 5', () => {
    const chunks = [
      { web: { uri: 'https://imd.gov.in/alert', title: 'IMD alert' } },
      { web: { uri: 'https://imd.gov.in/alert', title: 'Duplicate' } },
      { web: { uri: 'javascript:alert(1)', title: 'Evil' } },
      { web: { title: 'No uri' } },
      {},
      { web: { uri: 'https://ndma.gov.in/' } },
      { web: { uri: 'https://a.example/1', title: 'A' } },
      { web: { uri: 'https://b.example/2', title: 'B' } },
      { web: { uri: 'https://c.example/3', title: 'C' } },
      { web: { uri: 'https://d.example/4', title: 'D' } },
    ];
    const { sources } = parseLiveCheck('STATUS: CORROBORATED', chunks);
    expect(sources).toEqual([
      { title: 'IMD alert', url: 'https://imd.gov.in/alert' },
      { title: 'ndma.gov.in', url: 'https://ndma.gov.in/' },
      { title: 'A', url: 'https://a.example/1' },
      { title: 'B', url: 'https://b.example/2' },
      { title: 'C', url: 'https://c.example/3' },
    ]);
  });

  it('truncates long source titles', () => {
    const { sources } = parseLiveCheck('', [{ web: { uri: 'https://x.org', title: 't'.repeat(300) } }]);
    expect(sources[0]?.title).toHaveLength(120);
  });
});

describe('createGeminiAnalyzer', () => {
  beforeEach(() => {
    sdk.generateContent.mockReset();
    sdk.constructorArgs.length = 0;
  });

  it('creates the SDK client with the API key and exposes the model name', () => {
    const analyzer = createGeminiAnalyzer({ apiKey: 'k-123', model: 'gemini-test' });
    expect(analyzer.model).toBe('gemini-test');
    expect(sdk.constructorArgs).toEqual([{ apiKey: 'k-123' }]);
  });

  it('structure() sends a schema-constrained JSON request and parses the reply', async () => {
    sdk.generateContent.mockResolvedValue({ text: JSON.stringify(validModelOutput()) });
    const analyzer = createGeminiAnalyzer({ apiKey: 'k', model: 'gemini-test' });
    const signal = new AbortController().signal;
    const parts = [{ text: '<intake>help</intake>' }];

    await expect(analyzer.structure(parts, signal)).resolves.toEqual(validModelOutput());

    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    expect(sdk.generateContent).toHaveBeenCalledWith({
      model: 'gemini-test',
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseJsonSchema: modelOutputJsonSchema,
        temperature: 0.2,
        abortSignal: signal,
      },
    });
  });

  it('structure() surfaces unparseable replies as ModelOutputError', async () => {
    sdk.generateContent.mockResolvedValue({ text: 'not json' });
    const analyzer = createGeminiAnalyzer({ apiKey: 'k', model: 'm' });
    await expect(analyzer.structure([], new AbortController().signal)).rejects.toBeInstanceOf(ModelOutputError);
  });

  it('structure() propagates SDK errors unchanged', async () => {
    sdk.generateContent.mockRejectedValue(new Error('quota exceeded'));
    const analyzer = createGeminiAnalyzer({ apiKey: 'k', model: 'm' });
    await expect(analyzer.structure([], new AbortController().signal)).rejects.toThrow('quota exceeded');
  });

  it('liveCheck() enables Google Search grounding and parses grounding metadata', async () => {
    sdk.generateContent.mockResolvedValue({
      text: 'STATUS: CONTRADICTED\nNo alert was issued.',
      candidates: [
        { groundingMetadata: { groundingChunks: [{ web: { uri: 'https://imd.gov.in', title: 'IMD' } }] } },
      ],
    });
    const analyzer = createGeminiAnalyzer({ apiKey: 'k', model: 'gemini-test' });
    const signal = new AbortController().signal;

    const result = await analyzer.liveCheck(['Cyclone in Chennai'], 'India', signal);

    expect(result).toEqual({
      status: 'contradicted',
      note: 'No alert was issued.',
      sources: [{ title: 'IMD', url: 'https://imd.gov.in/' }],
    });
    const request = sdk.generateContent.mock.calls[0]?.[0] as {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    };
    expect(request.model).toBe('gemini-test');
    expect(request.contents).toContain('1. Cyclone in Chennai');
    expect(request.config).toEqual({ tools: [{ googleSearch: {} }], temperature: 0, abortSignal: signal });
  });

  it('liveCheck() tolerates a reply without candidates', async () => {
    sdk.generateContent.mockResolvedValue({ text: 'STATUS: INCONCLUSIVE' });
    const analyzer = createGeminiAnalyzer({ apiKey: 'k', model: 'm' });
    const result = await analyzer.liveCheck(['x'], 'India', new AbortController().signal);
    expect(result).toEqual({ status: 'inconclusive', note: 'No explanation returned.', sources: [] });
  });
});
