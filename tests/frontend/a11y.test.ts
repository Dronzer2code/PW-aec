// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderActionCard, renderEmergencyFallback, renderSummaryCard } from '../../public/js/render.js';
import { makeCard } from './fixtures.js';

const APP_HTML = readFileSync(resolve(process.cwd(), 'public/app.html'), 'utf8');

/** jsdom cannot compute colours, so contrast is verified by design tokens instead (contrast.test.ts). */
const AXE_OPTIONS: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  rules: { 'color-contrast': { enabled: false } },
  resultTypes: ['violations'],
};

function describeViolations(results: axe.AxeResults): string[] {
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe('app.html (static) accessibility', () => {
  const { document } = new JSDOM(APP_HTML).window;
  const visibleH1 = () => Array.from(document.querySelectorAll('h1')).filter((h) => !h.closest('[hidden]'));

  it('declares language, landmarks, one visible h1 and a skip link', () => {
    expect(document.documentElement.lang).toBe('en');
    expect(visibleH1()).toHaveLength(1);
    for (const selector of ['header', 'nav#sidebar[aria-label]', 'main#main', 'footer', 'nav#breadcrumb[aria-label="Breadcrumb"]']) {
      expect(document.querySelector(selector)).not.toBeNull();
    }
    expect(document.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
    for (const view of Array.from(document.querySelectorAll('[data-view]'))) {
      if (view.getAttribute('data-view') !== 'card') expect(view.querySelector('h1[tabindex="-1"]')).not.toBeNull();
    }
  });

  it('labels every control and exposes live regions', () => {
    expect(document.getElementById('status')?.getAttribute('role')).toBe('status');
    expect(document.getElementById('status')?.getAttribute('aria-live')).toBe('polite');
    expect(document.getElementById('error')?.getAttribute('role')).toBe('alert');
    expect(document.getElementById('card-region')?.getAttribute('aria-busy')).toBe('false');
    const textarea = document.getElementById('intake-text');
    expect(textarea?.getAttribute('maxlength')).toBe('10000');
    expect(textarea?.getAttribute('aria-describedby')).toBe('composer-hint char-count intake-error');
    for (const id of ['intake-text', 'language-select', 'country-select', 'qs-language', 'qs-country', 'emergency-country', 'search']) {
      expect(document.querySelector(`label[for="${id}"]`)?.textContent?.trim()).toBeTruthy();
    }
    for (const id of ['record-btn', 'location-btn', 'live-btn']) expect(document.getElementById(id)?.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('submit-btn')?.textContent?.trim()).toBe('Create Action Card');
    expect(document.getElementById('brand-btn')?.getAttribute('aria-controls')).toBe('quick-settings');
    expect(document.getElementById('menu-btn')?.getAttribute('aria-controls')).toBe('sidebar');
    expect(document.getElementById('recent-toggle')?.getAttribute('aria-controls')).toBe('recent-body');
    expect(document.getElementById('search')?.getAttribute('aria-keyshortcuts')).toBe('/');
    for (const a of Array.from(document.querySelectorAll('a[target="_blank"]'))) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.textContent).toContain('(opens in a new tab)');
    }
  });

  it('is compatible with a strict CSP (no inline scripts, styles or handlers, no external resources)', () => {
    expect(document.querySelectorAll('script:not([src])')).toHaveLength(0);
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
    expect(document.querySelectorAll('style')).toHaveLength(0);
    const handlers = Array.from(document.querySelectorAll('*')).filter((el) => Array.from(el.attributes).some((a) => a.name.startsWith('on')));
    expect(handlers).toHaveLength(0);
    const external = Array.from(document.querySelectorAll('script[src], link[href]')).filter((el) =>
      /^(https?:)?\/\//.test(el.getAttribute('src') ?? el.getAttribute('href') ?? ''));
    expect(external).toHaveLength(0);
  });
});

describe('every workspace view has zero axe violations', () => {
  beforeAll(async () => {
    window.scrollTo = vi.fn() as never;
    sessionStorage.setItem('lifebridge.cards.v1', JSON.stringify([{ id: 'req-123', createdAt: Date.now(), card: makeCard() }]));
    history.replaceState(null, '', '/app');
    const parsed = new DOMParser().parseFromString(APP_HTML, 'text/html');
    document.documentElement.lang = 'en';
    document.title = parsed.title;
    document.body.innerHTML = parsed.body.innerHTML;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await import('../../public/js/app.js');
  });

  it.each([
    ['/app', 'What’s happening?'],
    ['/app/cards', 'Action Cards'],
    ['/app/cards/req-123', 'Road accident'],
    ['/app/cards/missing', 'Action Card not found'],
    ['/app/samples', 'Samples'],
    ['/app/emergency', 'Emergency numbers'],
    ['/app/verification', 'How verification works'],
    ['/app/nope', 'Page not found'],
  ])('%s', async (path, heading) => {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const h1s = Array.from(document.querySelectorAll('h1')).filter((h) => !h.closest('[hidden]'));
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toContain(heading);
    expect(document.activeElement).toBe(h1s[0]);
    const results = await axe.run(document, AXE_OPTIONS);
    expect(describeViolations(results)).toEqual([]);
  });

  it('with the quick settings popover and the drawer open', async () => {
    document.getElementById('brand-btn')?.click();
    document.getElementById('menu-btn')?.click();
    const results = await axe.run(document, AXE_OPTIONS);
    expect(describeViolations(results)).toEqual([]);
  });
});

describe('rendered Action Card components', () => {
  function mount(...content: HTMLElement[]): void {
    document.documentElement.lang = 'en';
    document.title = 'LifeBridge test';
    const main = document.createElement('main');
    const h1 = document.createElement('h1');
    h1.textContent = 'LifeBridge';
    const h2 = document.createElement('h2');
    h2.textContent = 'Result';
    main.append(h1, h2, ...content);
    document.body.replaceChildren(main);
  }

  it('full card (h3 title) and summary card', async () => {
    mount(renderActionCard(makeCard()), renderSummaryCard(makeCard()));
    expect(describeViolations(await axe.run(document, AXE_OPTIONS))).toEqual([]);
  });

  it('non-English card', async () => {
    const base = makeCard();
    mount(renderActionCard(makeCard({ meta: { ...base.meta, outputLanguage: 'hi' }, summary: 'सड़क दुर्घटना' })));
    expect(describeViolations(await axe.run(document, AXE_OPTIONS))).toEqual([]);
  });

  it('emergency fallback', async () => {
    mount(renderEmergencyFallback({ name: 'India', emergency: '112' }, 'AI unavailable.'));
    expect(describeViolations(await axe.run(document, AXE_OPTIONS))).toEqual([]);
  });
});
