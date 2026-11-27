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
  /** Output language of the card; used for any action the engine adds. Default `en`. */
  language?: string;
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
/** Calling verbs in common Indian output languages (Hindi/Marathi "कॉल/फोन", Bengali "কল/ফোন", Hinglish). */
const LOCAL_CALL_RE = /(कॉल|फ़ोन|फोन|बुलाएँ|बुलाएं|बुलाओ|बुलाइए|बोलवा|কল|ফোন|ডাকুন|call\s+karo|phone\s+karo|bulao)/iu;
/** Emergency service words in Hindi/Marathi and Bengali. */
const LOCAL_SERVICE_RE = /(एम्बुलेंस|एंबुलेंस|पुलिस|आपातकालीन|दमकल|अग्निशमन|रुग्णवाहिका|অ্যাম্বুলেন্স|পুলিশ|জরুরি|দমকল|ambulance\s+ko)/iu;
const NEGATED_RE =/\b(do\s+not|don't|never|avoid)\s+(touch\s+or\s+)?(call|dial|phone|ring|contact|alert)\b/i;

/**
 * True when an action actually tells someone to call emergency services: a
 * verified number is present, or a calling verb is paired with a service word.
 * "Do not contact the live wire" or "phone the family" do not count.
 */
export function mentionsEmergencyCall(action: ModelAction, country: CountryCode): boolean {
  const text = action.instruction;
  const callVerb = CALL_VERB_RE.test(text) || LOCAL_CALL_RE.test(text);
  if (!callVerb || NEGATED_RE.test(text)) return false;
  // A bare "100" in "move 100 metres away" is not a call; the number must accompany a calling verb.
  const numberHit = Array.from(allowedNumbers(country)).some((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(text));
  return numberHit || EMERGENCY_SERVICE_RE.test(text) || LOCAL_SERVICE_RE.test(text);
}

/** Localized wording of the "call now" action added by the critical escalation check. */
type EscalationWording = (number: string, label: string) => { instruction: string; rationale: string };

const ENGLISH_ESCALATION: EscalationWording = (n, l) => ({
  instruction: `Call ${n} (${l}) now.`,
  rationale: 'This situation is urgent; trained responders must be alerted first.',
});

const ESCALATION_TEXT: Readonly<Record<string, EscalationWording>> = {
  en: ENGLISH_ESCALATION,
  hi: (n, l) => ({ instruction: `अभी ${n} (${l}) पर कॉल करें।`, rationale: 'स्थिति गंभीर है; सबसे पहले प्रशिक्षित मदद को सूचित करें।' }),
  mr: (n, l) => ({ instruction: `आत्ताच ${n} (${l}) वर कॉल करा.`, rationale: 'परिस्थिती गंभीर आहे; आधी प्रशिक्षित मदतीला कळवा.' }),
  bn: (n, l) => ({ instruction: `এখনই ${n} (${l}) নম্বরে কল করুন।`, rationale: 'পরিস্থিতি গুরুতর; সবার আগে প্রশিক্ষিত সাহায্যকারীদের জানান।' }),
  es: (n, l) => ({ instruction: `Llame al ${n} (${l}) ahora.`, rationale: 'La situación es urgente; avise primero a los servicios de emergencia.' }),
  fr: (n, l) => ({ instruction: `Appelez le ${n} (${l}) maintenant.`, rationale: 'La situation est urgente ; prévenez d’abord les secours.' }),
};

/** Escalation wording for a language, falling back to English. */
export function escalationText(language: string, number: string, label: string): { instruction: string; rationale: string } {
  return (ESCALATION_TEXT[language] ?? ENGLISH_ESCALATION)(number, label);
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
  const language = input.language ?? 'en';
  const checks: VerificationCheck[] = [
    { id: 'schema', status: 'pass', message: 'Model output matched the required structure.' },
  ];

  /* Phone number + dosage guards (counters shared by every guarded field) */
  let redactions = 0;
  let dosageEdits = 0;

  /* Evidence grounding + confidence */
  const facts: VerifiedFact[] = output.facts.map((fact) => {
    const status = containsEvidence(userText, fact.evidence)
      ? 'grounded'
      : hasFiles && containsEvidence(output.sourceText, fact.evidence)
        ? 'transcribed'
        : 'unverified';
    const needsReview = status === 'unverified' || fact.confidence < LOW_CONFIDENCE_THRESHOLD;
    // Grounded facts may legitimately quote numbers from the user's own records; unverified ones may not.
    if (status !== 'unverified') return { ...fact, status, needsReview };
    const value = guardText(fact.value, country);
    if (value.redacted) redactions += 1;
    return { ...fact, value: value.text, status, needsReview };
  });

  const traceable = facts.filter((f) => f.status !== 'unverified').length;
  const groundingScore = facts.length === 0 ? 0 : Math.round((traceable / facts.length) * 100) / 100;
  checks.push({
    id: 'evidence_grounding',
    status: facts.length > 0 && groundingScore >= MIN_GROUNDING_SCORE ? 'pass' : 'warn',
    message:
      facts.length === 0
        ? 'No facts could be extracted, so nothing could be checked against the input.'
        : `${traceable} of ${facts.length} facts are traceable to the input (${Math.round(groundingScore * 100)}%).`,
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

  /** Number guard + dosage guard for free text written by the model. */
  const guardAdvice = (text: string): { text: string; redacted: boolean; dosed: boolean } => {
    const numbers = guardText(text, country);
    const dosage = stripDosages(numbers.text);
    return { text: dosage.text, redacted: numbers.redacted, dosed: dosage.changed };
  };

  const summary = guardAdvice(output.summary);
  if (summary.redacted) redactions += 1;
  if (summary.dosed) dosageEdits += 1;

  const actions: VerifiedAction[] = output.actions.map((action) => {
    const flags: ActionFlag[] = [];
    const instr = guardAdvice(action.instruction);
    const why = guardAdvice(action.rationale);
    if (instr.redacted || why.redacted) flags.push('number_redacted');
    if (instr.dosed || why.dosed) flags.push('dosage_removed');
    redactions += flags.includes('number_redacted') ? 1 : 0;
    dosageEdits += flags.includes('dosage_removed') ? 1 : 0;
    return { ...action, instruction: instr.text, rationale: why.text, flags };
  });

  const guardList = (items: readonly string[]): string[] =>
    items.map((item) => {
      const g = guardAdvice(item);
      if (g.redacted) redactions += 1;
      if (g.dosed) dosageEdits += 1;
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
        : `Removed ${dosageEdits} suggested medication dose(s); follow a doctor's prescription.`,
  });

  /* Critical escalation */
  const services = new Set<Service>(['general_emergency', ...output.services]);
  const urgent = output.severity === 'critical' || output.severity === 'high';
  const first = actions[0];
  if (urgent && (first === undefined || !mentionsEmergencyCall(first, country))) {
    const service: Service = services.has('ambulance') ? 'ambulance' : 'general_emergency';
    const number = numberFor(country, service);
    actions.unshift({
      instruction: escalationText(language, number, SERVICE_LABELS[service]).instruction,
      actor: 'caller',
      timeframe: 'immediately',
      rationale: escalationText(language, number, SERVICE_LABELS[service]).rationale,
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
