import { describe, expect, it } from 'vitest';
import { AnalyzeRequestSchema, type ActionCard } from '../../src/domain/schema.js';
import { AppError } from '../../src/errors.js';
import { silentLogger } from '../../src/logger.js';
import { analyzeIntake, describePlace, assertFilesMatchTypes, MAX_ATTEMPTS, type AnalyzeDeps } from '../../src/services/analyze.js';
import { LruCache } from '../../src/services/cache.js';
import { fakeAnalyzer, MISMATCHED_B64, PNG_B64, SAMPLE_TEXT, validModelOutput, type FakeAnalyzer } from '../helpers/fixtures.js';

const deps = (analyzer: FakeAnalyzer | undefined, overrides: Partial<AnalyzeDeps> = {}): AnalyzeDeps => {
  let t = 1_000;
  return {
    analyzer,
    cache: new LruCache<ActionCard>(10, 60_000),
    logger: silentLogger,
    timeoutMs: 1_000,
    now: () => (t += 25),
    ...overrides,
  };
};

const request = (body: unknown) => AnalyzeRequestSchema.parse(body);

describe('assertFilesMatchTypes', () => {
  it('accepts files whose bytes match their type', () => {
    expect(() => assertFilesMatchTypes(request({ files: [{ name: 'a.png', mimeType: 'image/png', data: PNG_B64 }] }))).not.toThrow();
  });

  it('lists every mismatched file in the error details', () => {
    const r = request({
      files: [
        { name: 'ok.png', mimeType: 'image/png', data: PNG_B64 },
        { name: 'evil.png', mimeType: 'image/png', data: MISMATCHED_B64 },
        { name: 'evil.pdf', mimeType: 'application/pdf', data: PNG_B64 },
      ],
    });
    try {
      assertFilesMatchTypes(r);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
      expect((err as AppError).details).toEqual(['files: evil.png', 'files: evil.pdf']);
    }
  });
});

describe('analyzeIntake', () => {
  it('measures latency with the injected clock and records the model name', async () => {
    const { card, cached } = await analyzeIntake(request({ text: SAMPLE_TEXT }), 'req-1', deps(fakeAnalyzer()));
    expect(cached).toBe(false);
    expect(card.meta).toMatchObject({ requestId: 'req-1', model: 'fake-gemini', latencyMs: 25, cached: false });
  });

  it('returns a cached card with the new request id', async () => {
    const analyzer = fakeAnalyzer();
    const d = deps(analyzer);
    await analyzeIntake(request({ text: SAMPLE_TEXT }), 'req-1', d);
    const second = await analyzeIntake(request({ text: SAMPLE_TEXT }), 'req-2', d);
    expect(second.cached).toBe(true);
    expect(second.card.meta).toMatchObject({ requestId: 'req-2', cached: true });
    expect(analyzer.structureCalls).toHaveLength(1);
  });

  it('serves cache hits even when the AI is not configured', async () => {
    const d = deps(fakeAnalyzer());
    await analyzeIntake(request({ text: SAMPLE_TEXT }), 'req-1', d);
    const hit = await analyzeIntake(request({ text: SAMPLE_TEXT }), 'req-2', { ...d, analyzer: undefined });
    expect(hit.cached).toBe(true);
  });

  it(`retries invalid output up to ${MAX_ATTEMPTS} times`, async () => {
    const analyzer = fakeAnalyzer({ kind: 'invalidThenValid' });
    const { card } = await analyzeIntake(request({ text: SAMPLE_TEXT }), 'r', deps(analyzer));
    expect(analyzer.structureCalls).toHaveLength(2);
    expect(card.summary).toBe(validModelOutput().summary);
  });

  it('retries after a non-JSON reply, then gives up with AI_BAD_OUTPUT', async () => {
    const analyzer = fakeAnalyzer({ kind: 'modelOutputError' });
    await expect(analyzeIntake(request({ text: SAMPLE_TEXT }), 'r', deps(analyzer))).rejects.toMatchObject({
      code: 'AI_BAD_OUTPUT',
    });
    expect(analyzer.structureCalls).toHaveLength(MAX_ATTEMPTS);
  });

  it('maps an AbortError-named rejection to AI_TIMEOUT even before the signal fires', async () => {
    const analyzer = fakeAnalyzer();
    analyzer.structure = () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(analyzeIntake(request({ text: SAMPLE_TEXT }), 'r', deps(analyzer))).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
    });
  });

  it('maps a non-Error rejection to the retryable AI_UPSTREAM_ERROR', async () => {
    const analyzer = fakeAnalyzer();
    analyzer.structure = () => Promise.reject(new Map());
    await expect(analyzeIntake(request({ text: SAMPLE_TEXT }), 'r', deps(analyzer))).rejects.toMatchObject({
      code: 'AI_UPSTREAM_ERROR',
    });
  });

  it.each([400, 401, 403, 404])('maps Gemini HTTP %i (misconfiguration) to AI_UNAVAILABLE', async (status) => {
    const analyzer = fakeAnalyzer();
    analyzer.structure = () => Promise.reject(Object.assign(new Error('bad'), { status }));
    await expect(analyzeIntake(request({ text: SAMPLE_TEXT }), 'r', deps(analyzer))).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
    });
  });

  it.each([429, 500, 503])('maps Gemini HTTP %i (busy) to AI_UPSTREAM_ERROR', async (status) => {
    const analyzer = fakeAnalyzer();
    analyzer.structure = () => Promise.reject(Object.assign(new Error('busy'), { status }));
    await expect(analyzeIntake(request({ text: SAMPLE_TEXT }), 'r', deps(analyzer))).rejects.toMatchObject({
      code: 'AI_UPSTREAM_ERROR',
    });
  });

  it('aborts the Gemini call when the client disconnects', async () => {
    const analyzer = fakeAnalyzer();
    let seen: AbortSignal | undefined;
    analyzer.structure = (_parts, signal) => {
      seen = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    };
    const client = new AbortController();
    const pending = analyzeIntake(request({ text: SAMPLE_TEXT }), 'r', deps(analyzer), client.signal);
    client.abort();
    await expect(pending).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(seen?.aborted).toBe(true);
  });

  it('describes the place with coarse coordinates only', () => {
    expect(describePlace('India', undefined)).toBe('India');
    expect(describePlace('India', { lat: 12.971_599, lng: 77.594_566 })).toBe(
      'India, near latitude 12.97, longitude 77.59',
    );
  });

  it('degrades to status "error" when the live check rejects with a non-Error', async () => {
    const analyzer = fakeAnalyzer();
    analyzer.liveCheck = () => Promise.reject(new Map());
    const { card } = await analyzeIntake(request({ text: SAMPLE_TEXT, liveCheck: true }), 'r', deps(analyzer));
    expect(card.liveCheck.status).toBe('error');
  });

  it('sends the summary and at most 5 facts to the live check', async () => {
    const fact = { label: 'Age', value: '67', evidence: '67 years old', confidence: 0.9 };
    const analyzer = fakeAnalyzer({ kind: 'returns', output: validModelOutput({ facts: Array(8).fill(fact) }) });
    await analyzeIntake(request({ text: SAMPLE_TEXT, liveCheck: true, country: 'GB' }), 'r', deps(analyzer));
    expect(analyzer.liveCheckCalls).toHaveLength(1);
    expect(analyzer.liveCheckCalls[0]?.countryName).toBe('United Kingdom');
    expect(analyzer.liveCheckCalls[0]?.claims).toEqual([validModelOutput().summary, ...Array(5).fill('Age: 67')]);
  });

  it('only trusts sourceText evidence when files were attached', async () => {
    const output = validModelOutput({
      sourceText: 'Blood group O positive',
      facts: [{ label: 'Blood group', value: 'O+', evidence: 'Blood group O positive', confidence: 0.9 }],
    });
    const withFile = await analyzeIntake(
      request({ files: [{ name: 'card.png', mimeType: 'image/png', data: PNG_B64 }] }),
      'r',
      deps(fakeAnalyzer({ kind: 'returns', output })),
    );
    expect(withFile.card.facts[0]?.status).toBe('transcribed');

    const textOnly = await analyzeIntake(request({ text: 'help' }), 'r', deps(fakeAnalyzer({ kind: 'returns', output })));
    expect(textOnly.card.facts[0]?.status).toBe('unverified');
  });
});

describe('analyzeIntake: live check robustness', () => {
  it('does not cache a card whose live check failed', async () => {
    const analyzer = fakeAnalyzer({ kind: 'returns' }, { kind: 'throws' });
    const d = deps(analyzer);
    const body = request({ text: SAMPLE_TEXT, liveCheck: true });
    const first = await analyzeIntake(body, 'r1', d);
    expect(first.card.liveCheck.status).toBe('error');
    const second = await analyzeIntake(body, 'r2', d);
    expect(second.cached).toBe(false);
  });

  it('redacts unverified phone numbers from the live check note', async () => {
    const analyzer = fakeAnalyzer(
      { kind: 'returns' },
      { kind: 'returns', result: { status: 'corroborated', note: 'Call control room 9876543210 for updates.', sources: [] } },
    );
    const { card } = await analyzeIntake(request({ text: SAMPLE_TEXT, liveCheck: true }), 'r', deps(analyzer));
    expect(card.liveCheck.note).not.toContain('9876543210');
  });
});
