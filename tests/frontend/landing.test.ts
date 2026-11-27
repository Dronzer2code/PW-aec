// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INTERVAL,
  heroHeight,
  heroProgress,
  initHero,
  initLanding,
  initReveal,
  initTabs,
  syncNav,
} from '../../public/js/landing.js';
import type { TabsController } from '../../public/js/landing.js';

const LANDING_HTML = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');
const LANDING_CSS = readFileSync(resolve(process.cwd(), 'public/css/landing.css'), 'utf8');

const AXE_OPTIONS: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  // jsdom cannot compute colours; text colours are near-black on light surfaces by design.
  rules: { 'color-contrast': { enabled: false } },
  resultTypes: ['violations'],
};

/** Replaces the global document's body with the landing page body. */
function loadLanding(): void {
  const parsed = new DOMParser().parseFromString(LANDING_HTML, 'text/html');
  document.documentElement.className = '';
  document.body.innerHTML = parsed.body.innerHTML;
}

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};
const tabs = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const selectedKeys = (): (string | undefined)[] =>
  tabs()
    .filter((t) => t.getAttribute('aria-selected') === 'true')
    .map((t) => t.dataset.key);
const visiblePanels = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
    .filter((p) => !p.hidden)
    .map((p) => p.id);
const activeScene = (): string | undefined => document.querySelector<HTMLElement>('[data-scene-key].is-active')?.dataset.sceneKey;
const key = (target: Element, name: string): boolean =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

describe('landing page markup', () => {
  it('has zero axe violations', async () => {
    const dom = new JSDOM(LANDING_HTML, { runScripts: 'outside-only' });
    dom.window.eval(axe.source);
    const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(dom.window.document, AXE_OPTIONS);
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  it('declares language, metadata, landmarks, one h1 and a skip link', () => {
    const { document: doc } = new JSDOM(LANDING_HTML).window;
    expect(doc.documentElement.lang).toBe('en');
    expect(doc.querySelector('meta[name="description"]')?.getAttribute('content')?.length).toBeGreaterThan(50);
    expect(doc.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/favicon.svg');
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    for (const selector of ['header', 'nav[aria-label="Sections"]', 'main#main', 'footer']) {
      expect(doc.querySelector(selector), selector).not.toBeNull();
    }
    expect(doc.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
  });

  it('is compatible with a strict CSP (no inline scripts, styles, handlers or external assets)', () => {
    const { document: doc } = new JSDOM(LANDING_HTML).window;
    expect(doc.querySelectorAll('script:not([src])')).toHaveLength(0);
    expect(doc.querySelectorAll('[style]')).toHaveLength(0);
    expect(doc.querySelectorAll('style')).toHaveLength(0);
    const handlers = Array.from(doc.querySelectorAll('*')).filter((el) =>
      Array.from(el.attributes).some((attr) => attr.name.startsWith('on')),
    );
    expect(handlers).toHaveLength(0);
    const assets = Array.from(doc.querySelectorAll('script[src], link[href], img[src]')).map(
      (el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '',
    );
    expect(assets.every((url) => url.startsWith('/'))).toBe(true);
    expect(doc.querySelector('script[type="module"]')?.getAttribute('src')).toBe('/js/landing.js');
  });

  it('wires every tab to a labelled panel and keeps one tab in the tab order', () => {
    const { document: doc } = new JSDOM(LANDING_HTML).window;
    const tabEls = Array.from(doc.querySelectorAll('[role="tab"]'));
    expect(tabEls.map((t) => t.querySelector('.tab-title')?.textContent)).toEqual([
      'Voice',
      'Photos & PDFs',
      'Verification',
      'Live check',
    ]);
    for (const tab of tabEls) {
      const panel = doc.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    expect(doc.querySelectorAll('[role="tab"]:not([tabindex="-1"])')).toHaveLength(1);
    expect(doc.querySelector('[data-autoplay-toggle]')?.getAttribute('aria-label')).toMatch(/automatic tab rotation/);
  });

  it('links calls to action to the workspace and credits nothing it is not', () => {
    const { document: doc } = new JSDOM(LANDING_HTML).window;
    expect(doc.querySelector('.hero-cta')?.getAttribute('href')).toBe('/app');
    expect(doc.querySelector('.topbar-cta')?.textContent?.trim()).toBe('Open workspace');
    expect(doc.querySelector('.badge')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Powered by Gemini');
    expect(doc.querySelector('a[href="https://github.com/Dronzer2code/PW-aec"]')).not.toBeNull();
    expect(doc.querySelector('.footer')?.textContent).toMatch(/not a substitute for emergency services/);
    expect(doc.querySelectorAll('.preview[aria-hidden="true"], .feature-visual[aria-hidden="true"]')).toHaveLength(2);
  });

  it('disables motion and the sticky hero under prefers-reduced-motion', () => {
    const block = LANDING_CSS.slice(LANDING_CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/animation: none !important/);
    expect(block).toMatch(/transition: none !important/);
    expect(block).toMatch(/\.hero-frame \{ position: static; \}/);
  });
});

describe('pure helpers', () => {
  it('heroHeight shrinks with scroll and clamps to the banner height', () => {
    expect(heroHeight(0, 760, 264)).toBe(760);
    expect(heroHeight(-40, 760, 264)).toBe(760);
    expect(heroHeight(100.4, 760, 264)).toBe(660);
    expect(heroHeight(5000, 760, 264)).toBe(264);
  });

  it('heroProgress maps scroll to [0, 1] and is 0 without a range', () => {
    expect(heroProgress(0, 760, 264)).toBe(0);
    expect(heroProgress(248, 760, 264)).toBe(0.5);
    expect(heroProgress(9999, 760, 264)).toBe(1);
    expect(heroProgress(-10, 760, 264)).toBe(0);
    expect(heroProgress(100, 0, 0)).toBe(0);
    expect(heroProgress(100, Number.NaN, 0)).toBe(0);
  });

  it('syncNav marks exactly one link as current and falls back to Overview', () => {
    loadLanding();
    const nav = $('[data-nav-root]');
    const current = () => Array.from(nav.querySelectorAll('[aria-current="true"]')).map((a) => a.getAttribute('data-nav'));
    syncNav(nav, 'verify');
    expect(current()).toEqual(['verify']);
    syncNav(nav, 'unknown');
    expect(current()).toEqual(['overview']);
    syncNav(nav, undefined);
    expect(current()).toEqual(['overview']);
  });
});

describe('initTabs', () => {
  let controller: TabsController | null = null;
  const root = (): HTMLElement => $('[data-tabs]');

  beforeEach(() => {
    vi.useFakeTimers();
    loadLanding();
  });
  afterEach(() => {
    controller?.destroy();
    controller = null;
    vi.useRealTimers();
  });

  it('returns null when there are no tabs', () => {
    expect(initTabs(document.createElement('div'))).toBeNull();
  });

  it('initialises the first tab, its panel and its scene', () => {
    controller = initTabs(root(), { reducedMotion: true });
    expect(selectedKeys()).toEqual(['voice']);
    expect(visiblePanels()).toEqual(['panel-voice']);
    expect(activeScene()).toBe('voice');
    expect(controller?.key).toBe('voice');
    expect(root().style.getPropertyValue('--tab-interval')).toBe(`${DEFAULT_INTERVAL}ms`);
  });

  it('switches tabs on click and reports the change', () => {
    const onChange = vi.fn();
    controller = initTabs(root(), { reducedMotion: true, onChange });
    tabs()[2]?.click();
    expect(selectedKeys()).toEqual(['verify']);
    expect(visiblePanels()).toEqual(['panel-verify']);
    expect(activeScene()).toBe('verify');
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1]);
    expect(onChange).toHaveBeenLastCalledWith('verify', 2);
  });

  it('supports Arrow, Home and End keys with wrap-around and moves focus', () => {
    controller = initTabs(root(), { reducedMotion: true });
    const [first] = tabs();
    if (!first) throw new Error('no tabs');
    first.focus();
    expect(key(first, 'ArrowLeft')).toBe(false); // default prevented
    expect(selectedKeys()).toEqual(['live']);
    expect(document.activeElement).toBe(tabs()[3]);
    key(document.activeElement as Element, 'ArrowRight');
    expect(selectedKeys()).toEqual(['voice']);
    key(document.activeElement as Element, 'End');
    expect(selectedKeys()).toEqual(['live']);
    key(document.activeElement as Element, 'Home');
    expect(selectedKeys()).toEqual(['voice']);
    expect(key(document.activeElement as Element, 'Enter')).toBe(true); // ignored keys are not prevented
    expect(selectedKeys()).toEqual(['voice']);
  });

  it('show() selects by key and ignores unknown keys', () => {
    controller = initTabs(root(), { reducedMotion: true });
    controller?.show('photos');
    expect(controller?.index).toBe(1);
    controller?.show('nope');
    expect(controller?.index).toBe(1);
  });

  it('auto-advances on an interval and restarts the progress bar', () => {
    controller = initTabs(root(), { interval: 1000 });
    expect(controller?.playing).toBe(true);
    expect(root().classList.contains('is-playing')).toBe(true);
    expect(tabs()[0]?.querySelector('.tab-progress')?.classList.contains('is-running')).toBe(true);
    vi.advanceTimersByTime(999);
    expect(selectedKeys()).toEqual(['voice']);
    vi.advanceTimersByTime(1);
    expect(selectedKeys()).toEqual(['photos']);
    vi.advanceTimersByTime(3000);
    expect(selectedKeys()).toEqual(['voice']); // wrapped around
  });

  it('holds while hovered and resumes with the remaining time', () => {
    controller = initTabs(root(), { interval: 1000 });
    vi.advanceTimersByTime(600);
    root().dispatchEvent(new MouseEvent('mouseenter'));
    root().dispatchEvent(new MouseEvent('mouseenter')); // repeated holds are idempotent
    expect(root().classList.contains('is-held')).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(selectedKeys()).toEqual(['voice']);
    root().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(399);
    expect(selectedKeys()).toEqual(['voice']);
    vi.advanceTimersByTime(1);
    expect(selectedKeys()).toEqual(['photos']);
  });

  it('holds while focus is inside, but not for the toggle itself', () => {
    controller = initTabs(root(), { interval: 1000 });
    tabs()[0]?.focus();
    vi.advanceTimersByTime(3000);
    expect(selectedKeys()).toEqual(['voice']);
    // focus moving within the showcase keeps the hold
    tabs()[0]?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: tabs()[1] ?? null }));
    vi.advanceTimersByTime(3000);
    expect(selectedKeys()).toEqual(['voice']);
    tabs()[0]?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    vi.advanceTimersByTime(1000);
    expect(selectedKeys()).toEqual(['photos']);
    $('[data-autoplay-toggle]').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(root().classList.contains('is-held')).toBe(false);
  });

  it('the toggle pauses and resumes rotation and updates its label', () => {
    controller = initTabs(root(), { interval: 1000 });
    const toggle = $('[data-autoplay-toggle]');
    expect(toggle.getAttribute('aria-label')).toBe('Pause automatic tab rotation');
    toggle.click();
    expect(controller?.playing).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Play automatic tab rotation');
    expect(root().classList.contains('is-playing')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(selectedKeys()).toEqual(['voice']);
    root().dispatchEvent(new MouseEvent('mouseenter'));
    toggle.click(); // explicit play overrides the hover hold
    expect(controller?.playing).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(selectedKeys()).toEqual(['photos']);
    controller?.pause();
    controller?.play();
    expect(controller?.playing).toBe(true);
  });

  it('does not auto-advance under reduced motion until the user presses play', () => {
    controller = initTabs(root(), { interval: 1000, reducedMotion: true });
    expect(controller?.playing).toBe(false);
    expect($('[data-autoplay-toggle]').getAttribute('aria-label')).toBe('Play automatic tab rotation');
    vi.advanceTimersByTime(10_000);
    expect(selectedKeys()).toEqual(['voice']);
  });

  it('destroy() stops the timer and detaches listeners', () => {
    controller = initTabs(root(), { interval: 1000 });
    controller?.destroy();
    vi.advanceTimersByTime(5000);
    tabs()[3]?.click();
    expect(selectedKeys()).toEqual(['voice']);
    controller = null;
  });

  it('tolerates tabs without panels or progress bars', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button role="tab" data-key="a" aria-selected="false"></button><button role="tab" data-key="b"></button>';
    const c = initTabs(host, { reducedMotion: true });
    expect(c?.key).toBe('a');
    c?.select(1);
    expect(c?.key).toBe('b');
    c?.destroy();
  });
});

interface FakeWin {
  scrollY: number;
  listeners: Record<string, (() => void) | undefined>;
  frames: (() => void)[];
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string): void;
  requestAnimationFrame(fn: () => void): number;
  cancelAnimationFrame(id: number): void;
  getComputedStyle(el: Element): { getPropertyValue(name: string): string };
  flush(): void;
}

function fakeWindow(vars: Record<string, string> = { '--band': ' 28px', '--hero-min': ' 264px' }): FakeWin {
  const win: FakeWin = {
    scrollY: 0,
    listeners: {},
    frames: [],
    addEventListener(type, fn) {
      win.listeners[type] = fn;
    },
    removeEventListener(type) {
      win.listeners[type] = undefined;
    },
    requestAnimationFrame(fn) {
      win.frames.push(fn);
      return win.frames.length;
    },
    cancelAnimationFrame: vi.fn(),
    getComputedStyle: () => ({ getPropertyValue: (name: string) => vars[name] ?? '' }),
    flush() {
      win.frames.splice(0).forEach((fn) => fn());
    },
  };
  return win;
}

function setSlotHeight(slot: HTMLElement, value: number): void {
  Object.defineProperty(slot, 'offsetHeight', { configurable: true, get: () => value });
}

describe('initHero', () => {
  beforeEach(loadLanding);

  it('is disabled under reduced motion or without a hero', () => {
    expect(initHero($('[data-hero-slot]'), { reducedMotion: true })).toBeNull();
    expect(initHero(document.createElement('div'))).toBeNull();
  });

  it('shrinks the hero with scroll and swaps to the condensed banner', () => {
    const slot = $('[data-hero-slot]');
    const hero = $('.hero');
    setSlotHeight(slot, 788);
    const win = fakeWindow();
    const onCondense = vi.fn();
    const ctrl = initHero(slot, { win: win as unknown as Window, onCondense });
    expect(hero.style.height).toBe('760px');
    expect(ctrl?.condensed).toBe(false);

    win.scrollY = 100;
    win.listeners.scroll?.();
    win.listeners.scroll?.(); // coalesced into one frame
    expect(win.frames).toHaveLength(1);
    win.flush();
    expect(hero.style.height).toBe('660px');
    expect(slot.style.getPropertyValue('--hero-progress')).toBe('0.202');

    win.scrollY = 400;
    win.listeners.scroll?.();
    win.flush();
    expect(ctrl?.condensed).toBe(true);
    expect(slot.classList.contains('is-condensed')).toBe(true);
    expect(onCondense).toHaveBeenLastCalledWith(true);

    win.scrollY = 0;
    ctrl?.update();
    expect(slot.classList.contains('is-condensed')).toBe(false);
    expect(onCondense).toHaveBeenLastCalledWith(false);

    setSlotHeight(slot, 628);
    win.listeners.resize?.();
    expect(hero.style.height).toBe('600px');

    ctrl?.destroy();
    expect(hero.style.height).toBe('');
    expect(win.listeners.scroll).toBeUndefined();
  });

  it('leaves the height alone when layout is unavailable', () => {
    const win = fakeWindow({});
    const ctrl = initHero($('[data-hero-slot]'), { win: win as unknown as Window });
    expect($('.hero').style.height).toBe('');
    expect(ctrl?.condensed).toBe(false);
    ctrl?.destroy();
  });
});

describe('initReveal', () => {
  it('reveals immediately without IntersectionObserver or with reduced motion', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    expect(initReveal([a], { win: {} as Window })).toBeNull();
    expect(initReveal([b], { reducedMotion: true })).toBeNull();
    expect(a.classList.contains('is-visible') && b.classList.contains('is-visible')).toBe(true);
  });

  it('reveals each element once it intersects', () => {
    let callback: (entries: { isIntersecting: boolean; target: Element }[]) => void = () => {};
    const observe = vi.fn();
    const unobserve = vi.fn();
    class FakeIO {
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe = observe;
      unobserve = unobserve;
    }
    const el = document.createElement('div');
    const other = document.createElement('div');
    initReveal([el, other], { win: { IntersectionObserver: FakeIO } as unknown as Window });
    expect(observe).toHaveBeenCalledTimes(2);
    callback([
      { isIntersecting: false, target: other },
      { isIntersecting: true, target: el },
    ]);
    expect(el.classList.contains('is-visible')).toBe(true);
    expect(other.classList.contains('is-visible')).toBe(false);
    expect(unobserve).toHaveBeenCalledWith(el);
  });
});

describe('initLanding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadLanding();
  });
  afterEach(() => vi.useRealTimers());

  const stubMatchMedia = (reduce: boolean) =>
    vi.fn((query: string) => ({ matches: reduce && query.includes('reduce') })) as unknown as typeof window.matchMedia;

  it('wires tabs, hero, nav links, reveals and canvases', () => {
    const stop = vi.fn();
    const mount = vi.fn(() => stop);
    const slot = $('[data-hero-slot]');
    setSlotHeight(slot, 788);
    const win = Object.assign(fakeWindow(), { matchMedia: stubMatchMedia(false) });
    const page = initLanding(document, win as unknown as Window, { mount });

    expect(document.documentElement.classList.contains('js')).toBe(true);
    expect(page.reducedMotion).toBe(false);
    expect(page.tabs?.playing).toBe(true);
    expect(mount.mock.calls.map((call: unknown[]) => (call[1] as { scene: string }).scene)).toEqual([
      'sky',
      'hill',
      'sky',
      'rock',
    ]);
    expect(Array.from(document.querySelectorAll('[data-reveal]')).every((el) => el.classList.contains('is-visible'))).toBe(
      true,
    );

    // Nav icon links select the matching feature tab.
    $('a[data-tab="live"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(page.tabs?.key).toBe('live');
    $('[data-nav-root]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(page.tabs?.key).toBe('live');

    // Condensing highlights the active tab in the nav; expanding restores Overview.
    const current = () => document.querySelector('[data-nav-root] [aria-current="true"]')?.getAttribute('data-nav');
    expect(current()).toBe('overview');
    win.scrollY = 496;
    page.hero?.update();
    expect(current()).toBe('live');
    page.tabs?.show('photos');
    expect(current()).toBe('photos');
    win.scrollY = 0;
    page.hero?.update();
    expect(current()).toBe('overview');

    page.destroy();
    expect(stop).toHaveBeenCalledTimes(4);
  });

  it('respects prefers-reduced-motion via matchMedia', () => {
    const win = Object.assign(fakeWindow(), { matchMedia: stubMatchMedia(true) });
    const page = initLanding(document, win as unknown as Window, { mount: () => () => {} });
    expect(page.reducedMotion).toBe(true);
    expect(page.hero).toBeNull();
    expect(page.tabs?.playing).toBe(false);
    vi.advanceTimersByTime(DEFAULT_INTERVAL * 3);
    expect(page.tabs?.key).toBe('voice');
    page.destroy();
  });

  it('copes with an empty document and no matchMedia', () => {
    document.body.innerHTML = '';
    const page = initLanding(document, {} as Window, { mount: () => () => {} });
    expect(page.tabs).toBeNull();
    expect(page.hero).toBeNull();
    page.destroy();
  });

  it('auto-initialises on DOMContentLoaded only while the document is still loading', async () => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    vi.resetModules();
    await import('../../public/js/landing.js');
    state.mockRestore();
    expect(document.documentElement.classList.contains('js')).toBe(false);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.documentElement.classList.contains('js')).toBe(true);
  });
});
