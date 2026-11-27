import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.x contrast checks on the design tokens in app.css (light theme only).
 * jsdom cannot compute rendered colours, so the tokens themselves are verified.
 */
const CSS = readFileSync(resolve(process.cwd(), 'public/css/app.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)) out[m[1] as string] = (m[2] as string).toLowerCase();
  return out;
}

const ROOT = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('}', CSS.indexOf(':root {')));
const theme = tokens(ROOT);

function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const get = (key: string): string => {
  const value = theme[key];
  if (!value) throw new Error(`missing token --${key}`);
  return value;
};

const SURFACES = ['page', 'shell', 'side', 'surface', 'surface-2'] as const;
const TEXT_PAIRS: [string, string][] = [
  ...(['ink', 'ink-2', 'muted'] as const).flatMap((fg): [string, string][] => SURFACES.map((bg) => [fg, bg])),
  ['on-dark', 'dark'], ['on-dark', 'dark-hover'], ['ink', 'neutral-bg'], ['muted', 'neutral-bg'],
  ['ok-fg', 'ok-bg'], ['info-fg', 'info-bg'], ['warn-fg', 'warn-bg'], ['danger-fg', 'danger-bg'], ['neutral-fg', 'neutral-bg'],
  ['danger-fg', 'surface'], ['warn-fg', 'surface'], ['ok-fg', 'surface'], ['info-fg', 'surface'],
  ['ink-2', 'warn-bg'], ['muted', 'warn-bg'], ['ink', 'danger-bg'],
  ...(['critical', 'high', 'moderate', 'low'] as const).flatMap((s): [string, string][] => [
    [`sev-${s}-fg`, `sev-${s}-bg`], [`sev-${s}-fg`, 'surface'], [`sev-${s}-fg`, 'surface-2'], ['ink', `sev-${s}-bg`],
  ]),
];
/** Input borders and focus indicators (WCAG 1.4.11 non-text contrast). */
const UI_PAIRS: [string, string][] = [
  ['border-input', 'surface'], ['border-input', 'side'],
  ['focus', 'surface'], ['focus', 'side'], ['focus', 'shell'], ['focus', 'page'], ['focus', 'surface-2'],
  ['dark', 'surface'], ['danger-fg', 'danger-bg'],
];

describe('light theme tokens', () => {
  it.each(TEXT_PAIRS)('%s on %s meets 4.5:1 (text)', (fg, bg) => {
    expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)('%s against %s meets 3:1 (WCAG 1.4.11 non-text)', (fg, bg) => {
    expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(3);
  });

  it('white call-button text meets 4.5:1', () => {
    expect(contrast('#ffffff', get('call-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', get('call-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  it('ships no dark theme (light only, matching the landing page)', () => {
    expect(CSS).not.toContain('prefers-color-scheme');
  });
});

describe('contrast()', () => {
  it('matches known reference ratios', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
