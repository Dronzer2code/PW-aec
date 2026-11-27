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

/** Minimum normalized evidence length; shorter quotes are too generic to prove anything. */
export const MIN_EVIDENCE_CHARS = 3;

/**
 * True when `evidence` occurs in `corpus` after normalization. When an exact
 * match fails, accepts the quote if at least 80% of its words (and all of its
 * numbers) appear in the corpus — models sometimes drop or reorder a filler word.
 */
export function containsEvidence(corpus: string, evidence: string): boolean {
  const needle = normalizeForMatch(evidence);
  if (needle.length < MIN_EVIDENCE_CHARS) return false;
  const haystack = normalizeForMatch(corpus);
  if (haystack.length === 0) return false;
  if (haystack.includes(needle)) return true;

  const corpusWords = new Set(haystack.split(' '));
  const words = needle.split(' ');
  const numbers = words.filter((w) => /^\p{N}+$/u.test(w));
  if (numbers.some((n) => !corpusWords.has(n))) return false;
  const hits = words.filter((w) => corpusWords.has(w)).length;
  return words.length >= 3 && hits / words.length >= 0.8;
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
