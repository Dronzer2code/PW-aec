import type { ActionCard } from '../../src/domain/schema.js';

/** Realistic Action Card as returned by POST /api/analyze. */
export function makeCard(overrides: Partial<ActionCard> = {}): ActionCard {
  return {
    domain: 'road_accident',
    severity: 'critical',
    summary: 'A motorcyclist is unconscious and bleeding heavily from the head after a collision with a truck.',
    detectedLanguage: 'Hindi + English',
    sourceText: 'Ek bike wala truck se takra gaya, helmet nahi tha. Uske sir se bahut khoon beh raha hai.',
    facts: [
      {
        label: 'Injury',
        value: 'Heavy bleeding from the head',
        evidence: 'sir se bahut khoon beh raha hai',
        confidence: 0.92,
        status: 'grounded',
        needsReview: false,
      },
      {
        label: 'Location',
        value: 'Under Sector 9 flyover',
        evidence: 'Sector 9 flyover ke neeche',
        confidence: 0.55,
        status: 'unverified',
        needsReview: true,
      },
      {
        label: 'Helmet',
        value: 'No helmet',
        evidence: 'helmet nahi tha',
        confidence: 0.8,
        status: 'transcribed',
        needsReview: false,
      },
    ],
    actions: [
      {
        instruction: 'Call 112 (Emergency (all services)) now.',
        actor: 'caller',
        timeframe: 'immediately',
        rationale: 'An unconscious, bleeding person needs an ambulance.',
        flags: ['escalation_added'],
      },
      {
        instruction: 'Press a clean cloth firmly on the head wound.',
        actor: 'bystander',
        timeframe: 'immediately',
        rationale: 'Pressure slows bleeding.',
        flags: [],
      },
      {
        instruction: 'Give painkillers as directed by a doctor.',
        actor: 'caregiver',
        timeframe: 'within_1_hour',
        rationale: '',
        flags: ['dosage_removed', 'number_redacted'],
      },
    ],
    redFlags: ['Breathing stops', 'Bleeding does not slow with pressure'],
    missingInformation: ['Is the person breathing normally?'],
    contacts: [
      { service: 'general_emergency', label: 'Emergency (all services)', number: '112', tel: 'tel:112' },
      { service: 'ambulance', label: 'Ambulance', number: '108', tel: 'tel:108' },
    ],
    verification: {
      status: 'needs_review',
      groundingScore: 0.6667,
      checks: [
        { id: 'schema', status: 'pass', message: 'Model output matched the schema.' },
        { id: 'evidence_grounding', status: 'warn', message: '1 of 3 facts could not be matched.' },
      ],
    },
    liveCheck: {
      status: 'corroborated',
      note: 'Local news reports a collision at this location.',
      sources: [{ title: 'City News', url: 'https://news.example.com/accident' }],
    },
    smsText: 'EMERGENCY: road accident, unconscious biker bleeding from head, Sector 9 flyover. Call 112.',
    mapsLinks: [{ label: 'Hospitals near you', url: 'https://www.google.com/maps/search/hospital/@28.6,77.2,14z' }],
    disclaimer: 'LifeBridge is not a substitute for professional help.',
    meta: { requestId: 'req-123', model: 'gemini-flash-latest', cached: false, latencyMs: 2140, outputLanguage: 'en' },
    ...overrides,
  };
}
