/**
 * LifeBridge landing page behaviour: an accessible auto-rotating tab showcase,
 * a scroll-linked hero that condenses into a banner, and reveal-on-scroll.
 * Every controller is exported (and DOM-injected) so it can be unit-tested.
 */
import { mountClouds } from './clouds.js';

export const DEFAULT_INTERVAL = 6000;
const CONDENSE_AT = 0.45;
const NAV_OVERVIEW = 'overview';

/** Hero height for a scroll offset: shrinks 1:1 with scrolling, never below `min`. */
export function heroHeight(scrollY, full, min) {
  return Math.round(Math.max(min, full - Math.max(0, scrollY)));
}

/** Collapse progress in [0, 1]; 0 when there is nothing to collapse. */
export function heroProgress(scrollY, full, min) {
  const range = full - min;
  if (!(range > 0)) return 0;
  return Math.min(1, Math.max(0, scrollY / range));
}

/** Marks the nav link for `key` as current (falls back to Overview). */
export function syncNav(nav, key) {
  const links = Array.from(nav.querySelectorAll('a[data-nav]'));
  const target = links.some((link) => link.dataset.nav === key) ? key : NAV_OVERVIEW;
  for (const link of links) {
    if (link.dataset.nav === target) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}

/**
 * ARIA tablist controller (automatic activation, roving tabindex, Arrow/Home/End).
 * Auto-advances every `interval` ms unless `reducedMotion`; hovering or focusing
 * the showcase holds the timer, and a toggle button pauses/plays it (WCAG 2.2.2).
 */
export function initTabs(root, { interval = DEFAULT_INTERVAL, reducedMotion = false, onChange } = {}) {
  const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
  if (tabs.length === 0) return null;
  const doc = root.ownerDocument;
  const panels = tabs.map((tab) => doc.getElementById(tab.getAttribute('aria-controls') ?? ''));
  const scenes = Array.from(root.querySelectorAll('[data-scene-key]'));
  const toggle = root.querySelector('[data-autoplay-toggle]');
  const holds = new Set();
  let index = Math.max(0, tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'));
  let playing = !reducedMotion;
  let remaining = interval;
  let startedAt = 0;
  let timer;

  root.style.setProperty('--tab-interval', `${interval}ms`);

  const running = () => playing && holds.size === 0;

  function stopTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function arm() {
    stopTimer();
    root.classList.toggle('is-playing', playing);
    root.classList.toggle('is-held', playing && holds.size > 0);
    if (toggle) toggle.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} automatic tab rotation`);
    if (!running()) return;
    startedAt = Date.now();
    timer = setTimeout(() => select(index + 1), remaining);
  }

  function restartProgress() {
    const bar = tabs[index].querySelector('.tab-progress');
    if (!bar) return;
    bar.classList.remove('is-running');
    void bar.offsetWidth; // restart the CSS fill animation
    bar.classList.add('is-running');
  }

  function select(next, { focus = false } = {}) {
    index = ((next % tabs.length) + tabs.length) % tabs.length;
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (panels[i]) panels[i].hidden = !active;
    });
    const key = tabs[index].dataset.key;
    for (const scene of scenes) scene.classList.toggle('is-active', scene.dataset.sceneKey === key);
    if (focus) tabs[index].focus();
    remaining = interval;
    restartProgress();
    arm();
    onChange?.(key, index);
  }

  function hold(reason) {
    if (holds.has(reason)) return;
    if (running()) remaining = Math.max(0, remaining - (Date.now() - startedAt));
    holds.add(reason);
    arm();
  }

  function release(reason) {
    if (holds.delete(reason)) arm();
  }

  function setPlaying(value) {
    playing = value;
    holds.clear(); // an explicit choice wins over hover/focus holds
    remaining = interval;
    restartProgress();
    arm();
  }

  const KEYS = { ArrowRight: 1, ArrowLeft: -1 };
  const onKeydown = (event) => {
    const current = tabs.indexOf(event.currentTarget);
    let next;
    if (event.key in KEYS) next = current + KEYS[event.key];
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    select(next, { focus: true });
  };
  const listeners = new AbortController();
  const on = (target, type, fn) => target?.addEventListener(type, fn, { signal: listeners.signal });
  for (const tab of tabs) {
    on(tab, 'keydown', onKeydown);
    on(tab, 'click', () => select(tabs.indexOf(tab)));
  }
  on(toggle, 'click', () => setPlaying(!playing));
  on(root, 'mouseenter', () => hold('hover'));
  on(root, 'mouseleave', () => release('hover'));
  on(root, 'focusin', (event) => event.target !== toggle && hold('focus'));
  on(root, 'focusout', (event) => root.contains(event.relatedTarget) || release('focus'));

  select(index);

  return {
    select,
    show(key) {
      const i = tabs.findIndex((tab) => tab.dataset.key === key);
      if (i >= 0) select(i);
    },
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    get index() {
      return index;
    },
    get key() {
      return tabs[index].dataset.key;
    },
    get playing() {
      return playing;
    },
    destroy() {
      stopTimer();
      listeners.abort();
    },
  };
}

/**
 * Scroll-linked hero: the slot reserves the full height, the sticky hero shrinks
 * as the page scrolls and swaps headlines (class `is-condensed`) past 45%.
 */
export function initHero(slot, { win = window, reducedMotion = false, onCondense } = {}) {
  const hero = slot.querySelector('.hero');
  if (!hero || reducedMotion) return null;
  const readPx = (name) => parseFloat(win.getComputedStyle(slot).getPropertyValue(name)) || 0;
  let full = 0;
  let min = 0;
  let frame = 0;
  let condensed = false;

  const update = () => {
    frame = 0;
    const y = win.scrollY;
    if (full > min) hero.style.height = `${heroHeight(y, full, min)}px`;
    const progress = heroProgress(y, full, min);
    slot.style.setProperty('--hero-progress', progress.toFixed(3));
    const next = progress > CONDENSE_AT;
    if (next !== condensed) {
      condensed = next;
      slot.classList.toggle('is-condensed', next);
      onCondense?.(next);
    }
  };
  const measure = () => {
    min = readPx('--hero-min');
    full = slot.offsetHeight - readPx('--band');
    update();
  };
  const onScroll = () => {
    if (!frame) frame = win.requestAnimationFrame(update);
  };

  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', measure);
  measure();

  return {
    update,
    measure,
    get condensed() {
      return condensed;
    },
    destroy() {
      win.cancelAnimationFrame(frame);
      win.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', measure);
      hero.style.height = '';
    },
  };
}

/** Adds `is-visible` once each element scrolls into view (immediately without IO or with reduced motion). */
export function initReveal(elements, { win = window, reducedMotion = false } = {}) {
  const show = (el) => el.classList.add('is-visible');
  if (reducedMotion || typeof win.IntersectionObserver !== 'function') {
    elements.forEach(show);
    return null;
  }
  const observer = new win.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.15 },
  );
  elements.forEach((el) => observer.observe(el));
  return observer;
}

/** Wires the whole page. Returns a handle for tests and teardown. */
export function initLanding(doc = document, win = window, { mount = mountClouds } = {}) {
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  doc.documentElement.classList.add('js');

  const nav = doc.querySelector('[data-nav-root]');
  let condensed = false;
  const tabsRoot = doc.querySelector('[data-tabs]');
  const tabs = tabsRoot
    ? initTabs(tabsRoot, {
        reducedMotion,
        onChange: (key) => {
          if (condensed && nav) syncNav(nav, key);
        },
      })
    : null;

  const slot = doc.querySelector('[data-hero-slot]');
  const hero = slot
    ? initHero(slot, {
        win,
        reducedMotion,
        onCondense: (value) => {
          condensed = value;
          if (nav) syncNav(nav, value ? tabs?.key : NAV_OVERVIEW);
        },
      })
    : null;

  const onNavClick = (event) => {
    const link = event.target.closest?.('a[data-tab]');
    if (link && tabs) tabs.show(link.dataset.tab);
  };
  nav?.addEventListener('click', onNavClick);

  initReveal(Array.from(doc.querySelectorAll('[data-reveal]')), { win, reducedMotion });

  const unmount = Array.from(doc.querySelectorAll('canvas[data-scene]')).map((canvas) =>
    mount(canvas, { scene: canvas.dataset.scene, reducedMotion }),
  );

  return {
    tabs,
    hero,
    reducedMotion,
    destroy() {
      tabs?.destroy();
      hero?.destroy();
      nav?.removeEventListener('click', onNavClick);
      unmount.forEach((stop) => stop());
    },
  };
}

// Module scripts run before DOMContentLoaded; test environments import after load.
if (typeof document !== 'undefined' && document.readyState !== 'complete') {
  document.addEventListener('DOMContentLoaded', () => initLanding(), { once: true });
}
