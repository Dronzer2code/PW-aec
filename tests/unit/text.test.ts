import { describe, expect, it } from 'vitest';
import { containsEvidence, MIN_EVIDENCE_CHARS, normalizeForMatch, squish, truncate } from '../../src/domain/text.js';

describe('normalizeForMatch', () => {
  it('lower-cases, strips punctuation and collapses whitespace', () => {
    expect(normalizeForMatch('  Allergic to   PENICILLIN!!  ')).toBe('allergic to penicillin');
  });

  it('removes straight and curly quotes without splitting words', () => {
    expect(normalizeForMatch('He said “don’t move” and `wait`')).toBe('he said dont move and wait');
    expect(normalizeForMatch(`it's "fine"`)).toBe('its fine');
  });

  it('applies NFKC so full-width and ligature forms match plain text', () => {
    expect(normalizeForMatch('ＢＰ １８０')).toBe('bp 180');
    expect(normalizeForMatch('ﬁre')).toBe('fire');
  });

  it('keeps Devanagari letters and combining marks intact', () => {
    expect(normalizeForMatch('मेरे पिता बेहोश हैं।')).toBe('मेरे पिता बेहोश हैं');
  });

  it('keeps digits from other scripts', () => {
    expect(normalizeForMatch('उम्र ६७ साल')).toBe('उम्र ६७ साल');
  });

  it('turns punctuation-only input into an empty string', () => {
    expect(normalizeForMatch('—!?…')).toBe('');
  });
});

describe('containsEvidence', () => {
  const corpus = 'My father, aged 67, collapsed at home in Pune. He is allergic to penicillin.';

  it('accepts an exact (normalized) quote', () => {
    expect(containsEvidence(corpus, 'Allergic to Penicillin.')).toBe(true);
    expect(containsEvidence(corpus, 'aged 67')).toBe(true);
  });

  it('accepts a quote in a non-Latin script', () => {
    expect(containsEvidence('मेरे पिता बेहोश हैं, उम्र 67', 'पिता बेहोश')).toBe(true);
  });

  it('accepts a fuzzy quote when at least 80% of the words appear', () => {
    // 5 words, 4 present (the filler word "suddenly" is not in the corpus).
    expect(containsEvidence(corpus, 'father suddenly collapsed at home')).toBe(true);
  });

  it('rejects a fuzzy quote when fewer than 80% of the words appear', () => {
    expect(containsEvidence(corpus, 'mother fainted at the office')).toBe(false);
  });

  it('requires every number in a fuzzy quote to appear in the corpus', () => {
    expect(containsEvidence(corpus, 'father aged 76 collapsed at home in Pune')).toBe(false);
  });

  it('requires at least three words for fuzzy matching', () => {
    expect(containsEvidence('heart attack', 'attack heart')).toBe(false);
  });

  it('rejects evidence shorter than the minimum length', () => {
    expect(MIN_EVIDENCE_CHARS).toBe(3);
    expect(containsEvidence(corpus, 'He')).toBe(false);
    expect(containsEvidence(corpus, ' !! ')).toBe(false);
  });

  it('rejects any evidence against an empty corpus', () => {
    expect(containsEvidence('', 'allergic to penicillin')).toBe(false);
    expect(containsEvidence('...', 'allergic to penicillin')).toBe(false);
  });

  it('rejects invented evidence', () => {
    expect(containsEvidence(corpus, 'history of diabetes')).toBe(false);
  });
});

describe('truncate', () => {
  it('returns the input unchanged when it fits', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('', 3)).toBe('');
  });

  it('cuts to max characters including the ellipsis', () => {
    const out = truncate('hello world', 6);
    expect(out).toBe('hello…');
    expect(Array.from(out)).toHaveLength(6);
  });

  it('trims trailing whitespace before the ellipsis', () => {
    expect(truncate('ab   cdef', 5)).toBe('ab…');
  });

  it('never splits a surrogate pair (counts code points)', () => {
    const emoji = '🚑🚑🚑🚑';
    expect(truncate(emoji, 4)).toBe(emoji);
    const out = truncate(emoji, 3);
    expect(out).toBe('🚑🚑…');
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('squish', () => {
  it('collapses all whitespace runs, including newlines and tabs', () => {
    expect(squish('  call\n\n the\tdoctor  ')).toBe('call the doctor');
  });
});

describe('containsEvidence negation safety', () => {
  it('rejects a quote that adds a negation missing from the input', () => {
    expect(containsEvidence('the patient is diabetic since 2004', 'the patient is not diabetic')).toBe(false);
  });

  it('rejects a quote whose matching words are negated in the input', () => {
    expect(containsEvidence('the patient is not diabetic', 'patient is diabetic')).toBe(false);
    expect(containsEvidence('he is not diabetic', 'diabetic')).toBe(false);
    expect(containsEvidence('sugar wala nahi hai, diabetic nahi', 'diabetic')).toBe(false);
  });

  it('accepts a quote with the same negation as the input', () => {
    expect(containsEvidence('the patient is not diabetic at all', 'patient is not diabetic')).toBe(true);
    expect(containsEvidence('helmet nahi tha', 'helmet nahi tha')).toBe(true);
  });

  it('requires fuzzy matches to fall inside one nearby window', () => {
    expect(containsEvidence('bleeding from the head and he is unconscious', 'bleeding from head unconscious')).toBe(false);
    expect(containsEvidence('heavy bleeding from the head right now', 'heavy bleeding from head right now')).toBe(true);
  });
});
