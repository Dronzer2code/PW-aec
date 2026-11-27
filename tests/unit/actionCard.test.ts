import { describe, expect, it } from 'vitest';
import {
  buildActionCard,
  buildMapsLinks,
  buildSmsText,
  DISCLAIMER,
  SMS_MAX_CHARS,
  type BuildCardInput,
} from '../../src/domain/actionCard.js';
import { resolveContacts } from '../../src/domain/contacts.js';
import { OUTPUT_LIMITS, type LiveCheckResult, type ModelOutput } from '../../src/domain/schema.js';
import { runVerification } from '../../src/domain/verify.js';
import { SAMPLE_TEXT, validModelOutput } from '../helpers/fixtures.js';

const PUNE = { lat: 18.520430, lng: 73.856743 };
const SKIPPED: LiveCheckResult = { status: 'skipped', note: 'not requested', sources: [] };

const cardInput = (output: ModelOutput = validModelOutput(), extra: Partial<BuildCardInput> = {}): BuildCardInput => ({
  output,
  verification: runVerification({ output, userText: SAMPLE_TEXT, hasFiles: false, country: 'IN' }),
  country: 'IN',
  outputLanguage: 'en',
  location: undefined,
  liveCheck: SKIPPED,
  meta: { requestId: 'req-12345678', model: 'fake', latencyMs: 42 },
  ...extra,
});

describe('buildMapsLinks', () => {
  it('returns no links without a location', () => {
    expect(buildMapsLinks(['ambulance', 'police'], undefined)).toEqual([]);
  });

  it('returns no links for services without a map query', () => {
    expect(buildMapsLinks(['child_helpline', 'women_helpline'], PUNE)).toEqual([]);
  });

  it('builds URL-encoded Google Maps search links', () => {
    const [link] = buildMapsLinks(['ambulance'], PUNE);
    expect(link?.label).toBe('Nearest hospitals');
    const url = new URL(link?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe('hospital near 18.52043,73.85674');
    expect(link?.url).not.toContain(' ');
  });

  it('de-duplicates services that map to the same place type', () => {
    const links = buildMapsLinks(['general_emergency', 'ambulance', 'police', 'fire', 'disaster', 'police'], PUNE);
    expect(links.map((l) => l.label)).toEqual([
      'Nearest hospitals',
      'Nearest police station',
      'Nearest fire station',
      'Nearest relief shelters',
    ]);
  });
});

describe('buildSmsText', () => {
  const contacts = resolveContacts('IN', ['ambulance']);

  it('includes severity tag, summary, first action, primary number and location', () => {
    const sms = buildSmsText({
      severity: 'critical',
      summary: 'Man   collapsed,\n not responding.',
      firstAction: 'Call 108 now.',
      contacts,
      location: PUNE,
    });
    expect(sms).toBe(
      '[LifeBridge CRITICAL] Man collapsed, not responding. Do now: Call 108 now. Call 112. Loc: 18.5204,73.8567',
    );
  });

  it.each([
    ['high', 'URGENT'],
    ['moderate', 'MODERATE'],
    ['low', 'LOW'],
  ] as const)('tags %s severity as %s', (severity, tag) => {
    const sms = buildSmsText({ severity, summary: 's', firstAction: undefined, contacts: [], location: undefined });
    expect(sms).toBe(`[LifeBridge ${tag}] s`);
  });

  it(`never exceeds ${SMS_MAX_CHARS} characters`, () => {
    const sms = buildSmsText({
      severity: 'high',
      summary: 'x'.repeat(1000),
      firstAction: 'y'.repeat(1000),
      contacts,
      location: PUNE,
    });
    expect(Array.from(sms).length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    expect(sms).toContain('Call 112.');
    expect(sms).toContain('Loc:');
  });

  it('stays within the limit for long multi-byte text', () => {
    const sms = buildSmsText({
      severity: 'critical',
      summary: 'मेरे पिता बेहोश हैं '.repeat(50),
      firstAction: 'तुरंत 108 पर कॉल करें '.repeat(20),
      contacts,
      location: PUNE,
    });
    expect(Array.from(sms).length).toBeLessThanOrEqual(SMS_MAX_CHARS);
  });
});

describe('buildActionCard', () => {
  it('assembles a complete card with directory contacts, disclaimer and meta', () => {
    const card = buildActionCard(cardInput(validModelOutput(), { location: PUNE, outputLanguage: 'hi' }));
    expect(card.domain).toBe('medical_emergency');
    expect(card.contacts.map((c) => c.number)).toEqual(['112', '108']);
    expect(card.disclaimer).toBe(DISCLAIMER);
    expect(card.meta).toEqual({
      requestId: 'req-12345678',
      model: 'fake',
      latencyMs: 42,
      cached: false,
      outputLanguage: 'hi',
    });
    expect(card.mapsLinks).toHaveLength(1);
    expect(card.smsText).toContain('Loc: 18.5204,73.8567');
    expect(card.verification.status).toBe('verified');
  });

  it('truncates oversized model content to the output limits', () => {
    const long = 'z'.repeat(5000);
    const fact = { label: long, value: long, evidence: long, confidence: 0.9 };
    const output = validModelOutput({
      summary: long,
      detectedLanguage: long,
      sourceText: 's'.repeat(OUTPUT_LIMITS.sourceTextChars + 100),
      facts: Array.from({ length: 20 }, () => fact),
      actions: Array.from({ length: 12 }, () => ({
        instruction: long,
        actor: 'caller' as const,
        timeframe: 'today' as const,
        rationale: long,
      })),
      redFlags: Array.from({ length: 10 }, () => long),
      missingInformation: Array.from({ length: 10 }, () => long),
    });
    const card = buildActionCard(cardInput(output));

    expect(card.summary).toHaveLength(OUTPUT_LIMITS.fieldChars);
    expect(card.detectedLanguage).toHaveLength(60);
    expect(card.sourceText).toHaveLength(OUTPUT_LIMITS.sourceTextChars);
    expect(card.facts).toHaveLength(OUTPUT_LIMITS.facts);
    expect(card.facts[0]?.label).toHaveLength(80);
    expect(card.facts[0]?.value).toHaveLength(OUTPUT_LIMITS.fieldChars);
    expect(card.facts[0]?.evidence).toHaveLength(200);
    // 8 model actions plus room for one server-added escalation action.
    expect(card.actions).toHaveLength(OUTPUT_LIMITS.actions + 1);
    expect(card.actions[0]?.instruction).toHaveLength(OUTPUT_LIMITS.fieldChars);
    expect(card.actions[0]?.rationale).toHaveLength(OUTPUT_LIMITS.fieldChars);
    expect(card.redFlags).toHaveLength(OUTPUT_LIMITS.redFlags);
    expect(card.missingInformation).toHaveLength(OUTPUT_LIMITS.missingInformation);
    expect(card.redFlags.every((r) => r.length === OUTPUT_LIMITS.fieldChars && r.endsWith('…'))).toBe(true);
    expect(card.smsText.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
  });

  it('keeps the escalation action when the model sent the maximum number of actions', () => {
    const output = validModelOutput({
      severity: 'critical',
      actions: Array.from({ length: OUTPUT_LIMITS.actions }, (_, i) => ({
        instruction: `Step ${i}`,
        actor: 'bystander' as const,
        timeframe: 'immediately' as const,
        rationale: 'r',
      })),
    });
    const card = buildActionCard(cardInput(output));
    expect(card.actions).toHaveLength(OUTPUT_LIMITS.actions + 1);
    expect(card.actions[0]?.flags).toContain('escalation_added');
    expect(card.smsText).toContain('Do now: Call 108 (Ambulance) now.');
  });

  it('does not add a live_check check when the cross-check was skipped', () => {
    const card = buildActionCard(cardInput());
    expect(card.liveCheck).toEqual(SKIPPED);
    expect(card.verification.checks.some((c) => c.id === 'live_check')).toBe(false);
  });

  it.each([
    ['corroborated', 'pass'],
    ['contradicted', 'warn'],
    ['inconclusive', 'warn'],
    ['error', 'warn'],
  ] as const)('appends a live_check check (%s → %s)', (status, checkStatus) => {
    const liveCheck: LiveCheckResult = { status, note: 'n', sources: [] };
    const input = cardInput(validModelOutput(), { liveCheck });
    const card = buildActionCard(input);
    expect(card.liveCheck).toBe(liveCheck);
    expect(card.verification.checks.at(-1)).toEqual({
      id: 'live_check',
      status: checkStatus,
      message: `Live web cross-check: ${status}.`,
    });
    // The verification report passed in is not mutated.
    expect(input.verification.report.checks.some((c) => c.id === 'live_check')).toBe(false);
  });
});
