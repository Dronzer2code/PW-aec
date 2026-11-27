/**
 * Text utilities used by the Verification Engine to decide whether a model
 * "evidence" quote really appears in the user's Intake.
 */

/**
 * Normalizes text for tolerant matching: Unicode NFKC, lower case, curly quotes
 * and dashes unified, punctuation removed, whitespace collapsed. Works for any
 * script (Devanagari, Tamil, Arabic, ...) because it keeps all letters/marks/numbers.
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’“”`"']/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/** Negation words (English, Hindi/Hinglish, Bengali) that must appear in the input if a quote uses them. */
const NEGATION_WORDS: ReadonlySet<string> = new Set(['not', 'no', 'never', 'none', 'without', 'nahi', 'nahin', 'na', 'नहीं', 'ना', 'না', 'নেই']);

/** Minimum normalized evidence length; shorter quotes are too generic to prove anything. */
export const MIN_EVIDENCE_CHARS = 3;

/** Minimum share of evidence words that must appear inside one corpus window for a fuzzy match. */
export const FUZZY_MATCH_RATIO = 0.8;

const isNumber = (w: string): boolean => /^\p{N}+$/u.test(w);

/** True when the words just before or after a match negate it ("not diabetic", "diabetic nahi"). */
function negatedAround(corpusWords: readonly string[], start: number, end: number, needle: readonly string[]): boolean {
  const neighbours = [corpusWords[start - 1], corpusWords[end]].filter((w): w is string => w !== undefined);
  return neighbours.some((w) => NEGATION_WORDS.has(w) && !needle.includes(w));
}

/**
 * True when `evidence` occurs in `corpus` after normalization, without a
 * negation the quote does not contain. If there is no exact match, the quote is
 * accepted when one nearby window holds ≥ 80% of its words, all of its numbers
 * and negations, and no extra negation (models sometimes drop a filler word).
 */
export function containsEvidence(corpus: string, evidence: string): boolean {
  const needle = normalizeForMatch(evidence);
  if (needle.length < MIN_EVIDENCE_CHARS) return false;
  const haystack = normalizeForMatch(corpus);
  if (haystack.length === 0) return false;

  const corpusWords = haystack.split(' ');
  const words = needle.split(' ');

  for (let i = 0; i + words.length <= corpusWords.length; i += 1) {
    if (words.every((w, k) => corpusWords[i + k] === w) && !negatedAround(corpusWords, i, i + words.length, words)) {
      return true;
    }
  }
  if (words.length < 3) return false;

  const required = words.filter((w) => isNumber(w) || NEGATION_WORDS.has(w));
  const windowSize = words.length + 2;
  for (let i = 0; i < corpusWords.length; i += 1) {
    const window = corpusWords.slice(i, i + windowSize);
    if (window.some((w) => NEGATION_WORDS.has(w) && !words.includes(w))) continue;
    if (required.some((w) => !window.includes(w))) continue;
    const hits = words.filter((w) => window.includes(w)).length;
    if (hits / words.length >= FUZZY_MATCH_RATIO) return true;
  }
  return false;
}

/** Truncates to `max` characters on a code point boundary, appending an ellipsis. */
export function truncate(input: string, max: number): string {
  const chars = Array.from(input);
  if (chars.length <= max) return input;
  return `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

/** Collapses internal whitespace and trims. */
export function squish(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}
