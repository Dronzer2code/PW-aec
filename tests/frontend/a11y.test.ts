// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { directoryFor, renderActionCard, renderDirectoryCard, renderEmergencyFallback, renderSummaryCard } from '../../public/js/render.js';
import { makeCard } from './fixtures.js';

const APP_HTML = readFileSync(resolve(process.cwd(), 'public/app.html'), 'utf8');

/** jsdom cannot compute colours, so contrast is verified by design tokens instead. */
const AXE_OPTIONS: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  rules: { 'color-contrast': { enabled: false } },
  resultTypes: ['violations'],
};

function describeViolations(results: axe.AxeResults): string[] {
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

interface AxeWindow {
  axe: typeof axe;
}

describe('app.html (workspace) accessibility', () => {
  const dom = new JSDOM(APP_HTML, { runScripts: 'outside-only' });
  const { document } = dom.window;

  it('has zero axe violations', async () => {
    dom.window.eval(axe.source);
    const results = await (dom.window as unknown as AxeWindow).axe.run(document, AXE_OPTIONS);
    expect(describeViolations(results)).toEqual([]);
  });

  it('declares language, landmarks, one h1 and a skip link', () => {
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    for (const selector of ['header', 'nav#sidebar[aria-label]', 'main#main', 'aside[aria-label]', 'footer', 'nav.breadcrumb[aria-label="Breadcrumb"]']) {
      expect(document.querySelector(selector)).not.toBeNull();
    }
    expect(document.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
    expect(document.querySelector('#crumb-current')?.getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('.nav-item[aria-current="page"]')?.textContent).toBe('New Action Card');
  });

  it('wires the menu button, tabs, switches, drawer and dialog with ARIA', () => {
    const sample = document.getElementById('sample-btn');
    expect(sample?.getAttribute('aria-haspopup')).toBe('menu');
    expect(sample?.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(sample?.getAttribute('aria-controls') ?? '')?.getAttribute('role')).toBe('menu');
    expect(document.getElementById('menu-btn')?.getAttribute('aria-controls')).toBe('sidebar');
    for (const tab of Array.from(document.querySelectorAll('[role="tab"]'))) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    for (const id of ['share-location', 'live-check']) {
      expect(document.getElementById(id)?.getAttribute('role')).toBe('switch');
      expect(document.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
    expect(document.querySelector('fieldset > legend')?.textContent).toBe('Context and checks');
    expect(document.getElementById('verify-dialog')?.getAttribute('aria-labelledby')).toBe('verify-title');
    for (const a of Array.from(document.querySelectorAll('a[target="_blank"]'))) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.textContent).toContain('(opens in a new tab)');
    }
  });

  it('exposes live regions and labelled controls', () => {
    expect(document.getElementById('status')?.getAttribute('role')).toBe('status');
    expect(document.getElementById('status')?.getAttribute('aria-live')).toBe('polite');
    expect(document.getElementById('error')?.getAttribute('role')).toBe('alert');
    expect(document.getElementById('record-btn')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('card-region')?.getAttribute('aria-busy')).toBe('false');
    const textarea = document.getElementById('intake-text');
    expect(textarea?.getAttribute('maxlength')).toBe('10000');
    expect(document.querySelector('label[for="intake-text"]')?.textContent).toBe('Situation');
    expect(textarea?.getAttribute('aria-describedby')).toBe('intake-text-hint char-count intake-error');
    expect(document.querySelector('label[for="language-select"]')?.textContent).toBe('Output language');
    expect(document.querySelector('label[for="country-select"]')?.textContent).toBe('Country');
  });

  it('is compatible with a strict CSP (no inline scripts, styles or handlers)', () => {
    const { document } = new JSDOM(APP_HTML).window;
    expect(document.querySelectorAll('script:not([src])')).toHaveLength(0);
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
    expect(document.querySelectorAll('style')).toHaveLength(0);
    const handlers = Array.from(document.querySelectorAll('*')).filter((el) =>
      Array.from(el.attributes).some((a) => a.name.startsWith('on')),
    );
    expect(handlers).toHaveLength(0);
    const external = Array.from(document.querySelectorAll('script[src], link[href]')).filter((el) =>
      /^(https?:)?\/\//.test(el.getAttribute('src') ?? el.getAttribute('href') ?? ''),
    );
    expect(external).toHaveLength(0);
  });
});

describe('rendered Action Card accessibility', () => {
  function mount(content: HTMLElement): void {
    document.documentElement.lang = 'en';
    document.title = 'LifeBridge test';
    const main = document.createElement('main');
    const h1 = document.createElement('h1');
    h1.textContent = 'LifeBridge';
    const section = document.createElement('section');
    section.setAttribute('aria-labelledby', 'result-heading');
    const h2 = document.createElement('h2');
    h2.id = 'result-heading';
    h2.textContent = 'Action Card';
    section.append(h2, content);
    main.append(h1, section);
    document.body.replaceChildren(main);
  }

  it('has zero axe violations for a full card', async () => {
    mount(renderActionCard(makeCard()));
    const results = await axe.run(document, AXE_OPTIONS);
    expect(describeViolations(results)).toEqual([]);
  });

  it('has zero axe violations for a non-English card', async () => {
    const base = makeCard();
    mount(renderActionCard(makeCard({ meta: { ...base.meta, outputLanguage: 'hi' }, summary: 'सड़क दुर्घटना' })));
    const results = await axe.run(document, AXE_OPTIONS);
    expect(describeViolations(results)).toEqual([]);
  });

  it('has zero axe violations for the summary and directory cards', async () => {
    mount(renderSummaryCard(makeCard()));
    document.querySelector('main')?.append(renderDirectoryCard({ name: 'India' }, directoryFor({ code: 'IN', emergency: '112' })));
    const results = await axe.run(document, AXE_OPTIONS);
    expect(describeViolations(results)).toEqual([]);
  });

  it('has zero axe violations for the emergency fallback', async () => {
    mount(renderEmergencyFallback({ name: 'India', emergency: '112' }, 'AI unavailable.'));
    const results = await axe.run(document, AXE_OPTIONS);
    expect(describeViolations(results)).toEqual([]);
  });
});
