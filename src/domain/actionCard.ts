import { resolveContacts, type CountryCode } from './contacts.js';
import {
  OUTPUT_LIMITS,
  type ActionCard,
  type EmergencyContact,
  type LiveCheckResult,
  type MapsLink,
  type ModelOutput,
  type Service,
  type Severity,
} from './schema.js';
import { squish, truncate } from './text.js';
import type { VerificationResult } from './verify.js';

export const DISCLAIMER =
  'LifeBridge is an AI assistant, not a medical professional or emergency service. ' +
  'In any life-threatening situation call the emergency number shown on this card first. ' +
  'Facts marked "needs review" must be confirmed by a person.';

export const SMS_MAX_CHARS = 300;

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface BuildCardInput {
  output: ModelOutput;
  verification: VerificationResult;
  country: CountryCode;
  outputLanguage: string;
  location: Coordinates | undefined;
  liveCheck: LiveCheckResult;
  meta: { requestId: string; model: string; latencyMs: number };
}

const MAP_QUERIES: Partial<Record<Service, { label: string; query: string }>> = {
  ambulance: { label: 'Nearest hospitals', query: 'hospital' },
  general_emergency: { label: 'Nearest hospitals', query: 'hospital' },
  police: { label: 'Nearest police station', query: 'police station' },
  fire: { label: 'Nearest fire station', query: 'fire station' },
  disaster: { label: 'Nearest relief shelters', query: 'relief shelter' },
};

/** Google Maps search links (Maps URLs API) for services relevant to the situation. */
export function buildMapsLinks(services: readonly Service[], location: Coordinates | undefined): MapsLink[] {
  if (location === undefined) return [];
  const coords = `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`;
  const seen = new Set<string>();
  const links: MapsLink[] = [];
  for (const service of services) {
    const target = MAP_QUERIES[service];
    if (target === undefined || seen.has(target.query)) continue;
    seen.add(target.query);
    const params = new URLSearchParams({ api: '1', query: `${target.query} near ${coords}` });
    links.push({ label: target.label, url: `https://www.google.com/maps/search/?${params.toString()}` });
  }
  return links;
}

const SEVERITY_TAG: Record<Severity, string> = {
  critical: 'CRITICAL',
  high: 'URGENT',
  moderate: 'MODERATE',
  low: 'LOW',
};

/** Short, plain-text message that fits a single SMS / WhatsApp forward on weak networks. */
export function buildSmsText(input: {
  severity: Severity;
  summary: string;
  firstAction: string | undefined;
  contacts: readonly EmergencyContact[];
  location: Coordinates | undefined;
}): string {
  const parts = [`[LifeBridge ${SEVERITY_TAG[input.severity]}]`, truncate(squish(input.summary), 140)];
  if (input.firstAction !== undefined) parts.push(`Do now: ${truncate(squish(input.firstAction), 80)}`);
  const primary = input.contacts[0];
  if (primary !== undefined) parts.push(`Call ${primary.number}.`);
  if (input.location !== undefined) {
    parts.push(`Loc: ${input.location.lat.toFixed(4)},${input.location.lng.toFixed(4)}`);
  }
  return truncate(parts.join(' '), SMS_MAX_CHARS);
}

const clip = (s: string): string => truncate(s, OUTPUT_LIMITS.fieldChars);

/** Assembles the final, size-bounded Action Card returned by the API. */
export function buildActionCard(input: BuildCardInput): ActionCard {
  const { output, verification, country, location } = input;
  const contacts = resolveContacts(country, verification.services);
  const actions = verification.actions.slice(0, OUTPUT_LIMITS.actions + 1).map((a) => ({
    ...a,
    instruction: clip(a.instruction),
    rationale: clip(a.rationale),
  }));
  const summary = clip(verification.summary);

  const report = { ...verification.report, checks: [...verification.report.checks] };
  if (input.liveCheck.status !== 'skipped') {
    report.checks.push({
      id: 'live_check',
      status: input.liveCheck.status === 'corroborated' ? 'pass' : 'warn',
      message: `Live web cross-check: ${input.liveCheck.status}.`,
    });
  }

  return {
    domain: output.domain,
    severity: output.severity,
    summary,
    detectedLanguage: truncate(output.detectedLanguage, 60),
    sourceText: truncate(output.sourceText, OUTPUT_LIMITS.sourceTextChars),
    facts: verification.facts.slice(0, OUTPUT_LIMITS.facts).map((f) => ({
      ...f,
      label: truncate(f.label, 80),
      value: clip(f.value),
      evidence: truncate(f.evidence, 200),
    })),
    actions,
    redFlags: verification.redFlags.slice(0, OUTPUT_LIMITS.redFlags).map(clip),
    missingInformation: verification.missingInformation.slice(0, OUTPUT_LIMITS.missingInformation).map(clip),
    contacts,
    verification: report,
    liveCheck: input.liveCheck,
    smsText: buildSmsText({
      severity: output.severity,
      summary,
      firstAction: actions[0]?.instruction,
      contacts,
      location,
    }),
    mapsLinks: buildMapsLinks(verification.services, location),
    disclaimer: DISCLAIMER,
    meta: { ...input.meta, cached: false, outputLanguage: input.outputLanguage },
  };
}
