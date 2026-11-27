import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.x contrast checks on the design tokens in styles.css, for light and dark themes.
 * jsdom cannot compute rendered colours, so the tokens themselves are verified.
 */
const CSS = readFileSync(resolve(process.cwd(), 'public/css/styles.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\b/gi)) out[m[1] as string] = (m[2] as string).toLowerCase();
  return out;
}

function rootBlock(from: number): string {
  const start = CSS.indexOf(':root {', from);
  return CSS.slice(start, CSS.indexOf('}', start));
}

const light = tokens(rootBlock(0));
const dark = { ...light, ...tokens(rootBlock(CSS.indexOf('@media (prefers-color-scheme: dark)'))) };

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

const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'accent-soft'], ['text', 'warn-bg'],
  ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-2'], ['text-muted', 'warn-bg'],
  ['accent', 'surface'], ['accent', 'bg'], ['on-accent', 'accent'], ['on-accent', 'accent-hover'],
  ['ok-fg', 'ok-bg'], ['info-fg', 'info-bg'], ['warn-fg', 'warn-bg'], ['danger-fg', 'danger-bg'], ['neutral-fg', 'neutral-bg'],
  ['danger-fg', 'surface'], ['warn-fg', 'surface'],
  ...(['critical', 'high', 'moderate', 'low'] as const).flatMap((s): [string, string][] => [
    [`sev-${s}-fg`, `sev-${s}-bg`], [`sev-${s}-fg`, 'surface'], ['text', `sev-${s}-bg`],
  ]),
];
const UI_PAIRS: [string, string][] = [
  ['input-border', 'surface'], ['input-border', 'bg'], ['input-border', 'surface-2'],
  ['accent', 'accent-soft'], ['focus', 'surface'], ['focus', 'bg'],
];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme tokens', (_name, theme) => {
  const get = (key: string): string => {
    const value = theme[key];
    if (!value) throw new Error(`missing token --${key}`);
    return value;
  };

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
});

describe('contrast()', () => {
  it('matches known reference ratios', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});
