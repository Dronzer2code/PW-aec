import { allowedNumbers, numberFor, SERVICE_LABELS, type CountryCode } from './contacts.js';
import type {
  ActionFlag,
  ModelAction,
  ModelOutput,
  Service,
  VerificationCheck,
  VerificationReport,
  VerifiedAction,
  VerifiedFact,
} from './schema.js';
import { containsEvidence } from './text.js';

/** Facts below this confidence are flagged for human confirmation. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
/** Share of facts that must be traceable to the Intake for the card to count as verified. */
export const MIN_GROUNDING_SCORE = 0.8;

export const REDACTED_NUMBER = '[see emergency contacts]';
export const DOSAGE_REPLACEMENT = 'the dose prescribed by a doctor';

export interface VerificationInput {
  output: ModelOutput;
  /** Text typed by the user (trusted as evidence). */
  userText: string;
  /** Whether the Intake contained audio/image/PDF files (enables `transcribed` status). */
  hasFiles: boolean;
  country: CountryCode;
}

export interface VerificationResult {
  summary: string;
  facts: VerifiedFact[];
  actions: VerifiedAction[];
  redFlags: string[];
  missingInformation: string[];
  services: Service[];
  report: VerificationReport;
}

/* ---------------------------- detectors ---------------------------- */

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)?\s*(instructions|rules|prompts?)\b/i,
  /\bsystem\s+prompt\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(act|pretend)\s+as\s+(if|an?)\b/i,
  /\breveal\s+(your|the)\s+(instructions|prompt|api\s*key)\b/i,
  /<\/?\s*(system|intake|instructions?)\s*>/i,
];

/** Heuristic prompt-injection detector applied to untrusted user text. */
export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

/** Medication dose like "500 mg" or "2 tablets". Volumes of water/ORS/fluids are first-aid, not doses. */
const DOSAGE_RE =
  /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|g|ml|units?|iu|tablets?|tabs?|pills?|capsules?|drops?|puffs?)\b(?!\s*(?:of\s+)?(?:clean\s+|drinking\s+)?(?:water|ors|fluids?|liquids?)\b)/giu;

/** Replaces medication doses in model-written instructions (the app never prescribes). */
export function stripDosages(text: string): { text: string; changed: boolean } {
  let changed = false;
  const result = text.replace(DOSAGE_RE, () => {
    changed = true;
    return DOSAGE_REPLACEMENT;
  });
  return { text: result, changed };
}

/** Digits introduced by a calling verb, or any long digit run that looks like a phone number. */
const PHONE_CONTEXT_RE = /\b(call|dial|phone|contact|ring|helpline|hotline|number|tel)\b([^\p{N}+\n]{0,20})(\+?\p{N}[\p{N}\s-]{1,15}\p{N})/giu;
const LONG_DIGITS_RE = /\+?\p{N}[\p{N}\s-]{6,}\p{N}/gu;

const digitsOf = (raw: string): string => raw.replace(/[^\p{N}]/gu, '');

/**
 * Redacts any phone-like number that is not in the verified directory for the
 * country. Guarantees the model can never introduce an unverified number.
 */
export function redactUnknownNumbers(text: string, country: CountryCode): { text: string; changed: boolean } {
  const allowed = allowedNumbers(country);
  let changed = false;
  const isAllowed = (raw: string): boolean => allowed.has(digitsOf(raw));

  let result = text.replace(PHONE_CONTEXT_RE, (match, verb: string, gap: string, num: string) => {
    if (isAllowed(num)) return match;
    // "Call 911 2 times": the verified number is the first token; the rest is ordinary text.
    const firstToken = /^\+?\p{N}+/u.exec(num)?.[0] ?? '';
    if (!firstToken.startsWith('+') && allowed.has(firstToken)) return match;
    changed = true;
    return `${verb}${gap}${REDACTED_NUMBER}`;
  });
  result = result.replace(LONG_DIGITS_RE, (num) => {
    if (isAllowed(num)) return num;
    changed = true;
    return REDACTED_NUMBER;
  });
  return { text: result, changed };
}

const CALL_VERB_RE = /\b(call|dial|phone|ring|contact|alert)\b/i;
const EMERGENCY_SERVICE_RE =
  /\b(emergency|ambulance|police|fire\s*(brigade|service|department)|rescue|responders?|helpline|paramedics?)\b/i;
const NEGATED_RE = /\b(do\s+not|don't|never|avoid)\s+(touch\s+or\s+)?(call|dial|phone|ring|contact|alert)\b/i;

/**
 * True when an action actually tells someone to call emergency services: a
 * verified number is present, or a calling verb is paired with a service word.
 * "Do not contact the live wire" or "phone the family" do not count.
 */
export function mentionsEmergencyCall(action: ModelAction, country: CountryCode): boolean {
  const text = action.instruction;
  if (Array.from(allowedNumbers(country)).some((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(text))) return true;
  return CALL_VERB_RE.test(text) && !NEGATED_RE.test(text) && EMERGENCY_SERVICE_RE.test(text);
}

/* ----------------------------- engine ------------------------------ */

function guardText(text: string, country: CountryCode): { text: string; redacted: boolean } {
  const r = redactUnknownNumbers(text, country);
  return { text: r.text, redacted: r.changed };
}

/**
 * Runs every deterministic check on a validated model response and returns the
 * repaired content plus a Verification Report. Pure function: no I/O.
 */
export function runVerification(input: VerificationInput): VerificationResult {
  const { output, userText, hasFiles, country } = input;
  const checks: VerificationCheck[] = [
    { id: 'schema', status: 'pass', message: 'Model output matched the required structure.' },
  ];

  /* Evidence grounding + confidence */
  const facts: VerifiedFact[] = output.facts.map((fact) => {
    const status = containsEvidence(userText, fact.evidence)
      ? 'grounded'
      : hasFiles && containsEvidence(output.sourceText, fact.evidence)
        ? 'transcribed'
        : 'unverified';
    const needsReview = status === 'unverified' || fact.confidence < LOW_CONFIDENCE_THRESHOLD;
    return { ...fact, status, needsReview };
  });

  const traceable = facts.filter((f) => f.status !== 'unverified').length;
  const groundingScore = facts.length === 0 ? 1 : Math.round((traceable / facts.length) * 100) / 100;
  checks.push({
    id: 'evidence_grounding',
    status: groundingScore >= MIN_GROUNDING_SCORE ? 'pass' : 'warn',
    message: `${traceable} of ${facts.length} facts are traceable to the input (${Math.round(groundingScore * 100)}%).`,
  });

  const lowConfidence = facts.filter((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD);
  checks.push({
    id: 'low_confidence',
    status: lowConfidence.length === 0 ? 'pass' : 'warn',
    message:
      lowConfidence.length === 0
        ? 'All facts have adequate confidence.'
        : `Please confirm: ${lowConfidence.map((f) => f.label).join(', ')}.`,
  });

  /* Phone number + dosage guards */
  let redactions = 0;
  let dosageEdits = 0;
  const summary = guardText(output.summary, country);
  if (summary.redacted) redactions += 1;

  const actions: VerifiedAction[] = output.actions.map((action) => {
    const flags: ActionFlag[] = [];
    const instr = guardText(action.instruction, country);
    const why = guardText(action.rationale, country);
    if (instr.redacted || why.redacted) flags.push('number_redacted');
    const dosedInstr = stripDosages(instr.text);
    const dosedWhy = stripDosages(why.text);
    if (dosedInstr.changed || dosedWhy.changed) flags.push('dosage_removed');
    redactions += flags.includes('number_redacted') ? 1 : 0;
    dosageEdits += flags.includes('dosage_removed') ? 1 : 0;
    return { ...action, instruction: dosedInstr.text, rationale: dosedWhy.text, flags };
  });

  const guardList = (items: readonly string[]): string[] =>
    items.map((item) => {
      const g = guardText(item, country);
      if (g.redacted) redactions += 1;
      return g.text;
    });
  const redFlags = guardList(output.redFlags);
  const missingInformation = guardList(output.missingInformation);

  checks.push({
    id: 'phone_number_guard',
    status: 'pass',
    message:
      redactions === 0
        ? 'No unverified phone numbers in the answer.'
        : `Removed ${redactions} unverified phone number(s); use the verified contacts below.`,
  });
  checks.push({
    id: 'dosage_guard',
    status: 'pass',
    message:
      dosageEdits === 0
        ? 'No medication doses were suggested.'
        : `Removed medication doses from ${dosageEdits} action(s); follow a doctor's prescription.`,
  });

  /* Critical escalation */
  const services = new Set<Service>(['general_emergency', ...output.services]);
  const urgent = output.severity === 'critical' || output.severity === 'high';
  const first = actions[0];
  if (urgent && (first === undefined || !mentionsEmergencyCall(first, country))) {
    const service: Service = services.has('ambulance') ? 'ambulance' : 'general_emergency';
    const number = numberFor(country, service);
    actions.unshift({
      instruction: `Call ${number} (${SERVICE_LABELS[service]}) now.`,
      actor: 'caller',
      timeframe: 'immediately',
      rationale: 'This situation is urgent; trained responders must be alerted first.',
      flags: ['escalation_added'],
    });
    checks.push({
      id: 'critical_escalation',
      status: 'pass',
      message: `Added "call ${number}" as the first action because severity is ${output.severity}.`,
    });
  } else {
    checks.push({
      id: 'critical_escalation',
      status: 'pass',
      message: urgent ? 'First action already contacts emergency services.' : 'Not an urgent situation.',
    });
  }

  /* Contact resolution */
  checks.push({
    id: 'contact_resolution',
    status: 'pass',
    message: 'Emergency numbers come from the verified directory, not from the AI model.',
  });

  /* Prompt injection */
  const injection = detectPromptInjection(userText) || detectPromptInjection(output.sourceText);
  checks.push({
    id: 'prompt_injection',
    status: injection ? 'warn' : 'pass',
    message: injection
      ? 'The input contains instruction-like text; it was treated strictly as data. Review the card carefully.'
      : 'No instruction-like text detected in the input.',
  });

  const mustPass = new Set(['evidence_grounding', 'low_confidence', 'prompt_injection']);
  const verified = checks.every((c) => c.status !== 'fail' && (!mustPass.has(c.id) || c.status === 'pass'));

  return {
    summary: summary.text,
    facts,
    actions,
    redFlags,
    missingInformation,
    services: Array.from(services),
    report: { status: verified ? 'verified' : 'needs_review', groundingScore, checks },
  };
}
