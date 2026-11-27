// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_FOUND, ROUTES, createRouter, isInternalLink, matchRoute } from '../../public/js/router.js';

describe('matchRoute', () => {
  it.each([
    ['/app', 'new', []],
    ['/app/', 'new', []],
    ['/app/cards', 'cards', []],
    ['/app/cards/req-123', 'card', ['req-123']],
    ['/app/samples', 'samples', []],
    ['/app/emergency/', 'emergency', []],
    ['/app/verification', 'verification', []],
  ])('%s → %s', (path, name, params) => {
    const route = matchRoute(path);
    expect(route.name).toBe(name);
    expect(route.params).toEqual(params);
    expect(route.path).toBe(path);
    expect(route.title).toBe(ROUTES.find((r) => r.name === name)?.title);
  });

  it.each(['/app/nope', '/app/cards/a/b', '/app/cards/<script>', '/', '/appx'])('%s is not found', (path) => {
    expect(matchRoute(path)).toMatchObject({ name: NOT_FOUND.name, title: 'Page not found', params: [] });
  });
});

describe('isInternalLink', () => {
  const origin = 'http://localhost:3000';
  function link(attrs: Record<string, string>): HTMLAnchorElement {
    const a = document.createElement('a');
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    return a;
  }
  const click = (init: MouseEventInit = {}) => new MouseEvent('click', { button: 0, cancelable: true, ...init });

  it('accepts plain clicks on same-origin data-link anchors', () => {
    expect(isInternalLink(click(), link({ href: '/app/cards', 'data-link': '' }), origin)).toBe(true);
  });

  it('leaves modified, secondary, external and opted-out clicks to the browser', () => {
    const a = link({ href: '/app/cards', 'data-link': '' });
    for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) expect(isInternalLink(click({ [mod]: true }), a, origin)).toBe(false);
    expect(isInternalLink(click({ button: 1 }), a, origin)).toBe(false);
    expect(isInternalLink(click(), null, origin)).toBe(false);
    expect(isInternalLink(click(), link({ href: '/app/cards' }), origin)).toBe(false);
    expect(isInternalLink(click(), link({ href: 'https://evil.example/app', 'data-link': '' }), origin)).toBe(false);
    expect(isInternalLink(click(), link({ href: '/x.json', 'data-link': '', download: '' }), origin)).toBe(false);
    expect(isInternalLink(click(), link({ href: '/app', 'data-link': '', target: '_blank' }), origin)).toBe(false);
    expect(isInternalLink(click(), link({ href: '/app', 'data-link': '', target: '_self' }), origin)).toBe(true);
    const prevented = click();
    prevented.preventDefault();
    expect(isInternalLink(prevented, a, origin)).toBe(false);
    expect(isInternalLink(click(), link({ href: 'http://[bad', 'data-link': '' }), origin)).toBe(false);
  });
});

describe('createRouter', () => {
  let heading: HTMLHeadingElement;
  beforeEach(() => {
    window.scrollTo = vi.fn() as never;
    history.replaceState(null, '', '/app');
    document.body.innerHTML = '<h1 tabindex="-1">Page</h1><a id="cards" href="/app/cards" data-link>Cards</a><a id="ext" href="/app/cards">Plain</a>';
    heading = document.querySelector('h1') as HTMLHeadingElement;
  });
  afterEach(() => vi.restoreAllMocks());

  function setup(render = vi.fn(() => ({ heading }))) {
    const announce = vi.fn();
    const router = createRouter({ render, announce });
    return { router, render, announce };
  }

  it('renders the initial route without moving focus or announcing', () => {
    const { router, render, announce } = setup();
    router.start();
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ name: 'new' }));
    expect(document.title).toBe('New Action Card · LifeBridge');
    expect(document.activeElement).not.toBe(heading);
    expect(announce).not.toHaveBeenCalled();
    router.stop();
  });

  it('navigates with pushState, sets the title, focuses the heading and announces', () => {
    const { router, announce } = setup();
    router.start();
    const length = history.length;
    router.navigate('/app/samples');
    expect(location.pathname).toBe('/app/samples');
    expect(history.length).toBe(length + 1);
    expect(router.current.name).toBe('samples');
    expect(document.title).toBe('Samples · LifeBridge');
    expect(document.activeElement).toBe(heading);
    expect(announce).toHaveBeenLastCalledWith('Samples page');
    router.navigate('/app/samples');
    expect(history.length).toBe(length + 1); // same path: replaced, not pushed
    router.stop();
  });

  it('uses the title returned by render', () => {
    const { router } = setup(vi.fn(() => ({ title: 'Road accident', heading })));
    router.start();
    router.navigate('/app/cards/abc', { replace: true });
    expect(document.title).toBe('Road accident · LifeBridge');
  });

  it('tolerates a render without a result', () => {
    const { router } = setup(vi.fn(() => undefined) as never);
    router.start();
    router.navigate('/app/nope');
    expect(document.title).toBe('Page not found · LifeBridge');
  });

  it('intercepts data-link clicks and ignores the rest', () => {
    const { router } = setup();
    router.start();
    document.getElementById('cards')?.click();
    expect(location.pathname).toBe('/app/cards');
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.getElementById('ext')?.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    router.stop();
  });

  it('re-renders on popstate', () => {
    const { router, render } = setup();
    router.start();
    history.pushState(null, '', '/app/emergency');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'emergency' }));
    expect(document.activeElement).toBe(heading);
    router.stop();
  });
});
