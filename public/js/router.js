/**
 * Tiny History API router for the /app workspace. No framework, no reloads.
 * `matchRoute` and `isInternalLink` are pure; `createRouter` wires them to a window.
 */

/** Route table. `pattern` captures parameters; titles feed `document.title`. */
export const ROUTES = Object.freeze([
  { name: 'new', pattern: /^\/app\/?$/, title: 'New Action Card' },
  { name: 'cards', pattern: /^\/app\/cards\/?$/, title: 'Action Cards' },
  { name: 'card', pattern: /^\/app\/cards\/([\w-]{1,64})\/?$/, title: 'Action Card' },
  { name: 'samples', pattern: /^\/app\/samples\/?$/, title: 'Samples' },
  { name: 'emergency', pattern: /^\/app\/emergency\/?$/, title: 'Emergency numbers' },
  { name: 'verification', pattern: /^\/app\/verification\/?$/, title: 'How verification works' },
]);
export const NOT_FOUND = Object.freeze({ name: 'not-found', title: 'Page not found' });

/**
 * Route for a pathname; unknown paths resolve to NOT_FOUND.
 * @param {string} path
 * @param {readonly { name: string, pattern: RegExp, title: string }[]} [routes]
 * @returns {{ name: string, title: string, params: string[], path: string }}
 */
export function matchRoute(path, routes = ROUTES) {
  for (const { name, pattern, title } of routes) {
    const m = pattern.exec(path);
    if (m) return { name, title, params: m.slice(1), path };
  }
  return { ...NOT_FOUND, params: [], path };
}

/**
 * Whether a click on `anchor` should be handled by the router instead of the browser:
 * primary button, no modifier keys, same origin, opted in with `data-link`, no target/download.
 * @param {MouseEvent} event
 * @param {HTMLAnchorElement | null} anchor
 * @param {string} origin `location.origin`
 * @returns {boolean}
 */
export function isInternalLink(event, anchor, origin) {
  if (!anchor || event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (!anchor.hasAttribute('data-link') || anchor.hasAttribute('download')) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  try {
    return new URL(anchor.href, origin).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Creates a router. `render(route)` shows the view and returns the heading to focus.
 * After client-side navigation the title is updated, focus moves to that heading and
 * `announce(title)` is called (the initial render does not move focus).
 * @param {{
 *   render: (route: ReturnType<typeof matchRoute>) => { title?: string, heading?: HTMLElement | null } | void,
 *   announce?: (message: string) => void,
 *   routes?: typeof ROUTES,
 *   win?: Window,
 * }} options
 */
export function createRouter({ render, announce = () => undefined, routes = ROUTES, win = window }) {
  const doc = win.document;
  let current = matchRoute(win.location.pathname, routes);

  function show(moveFocus) {
    current = matchRoute(win.location.pathname, routes);
    const result = render(current) ?? {};
    const title = result.title ?? current.title;
    doc.title = `${title} · LifeBridge`;
    if (!moveFocus) return;
    result.heading?.focus();
    win.scrollTo?.(0, 0);
    announce(`${title} page`);
  }

  function navigate(path, { replace = false } = {}) {
    const url = new URL(path, win.location.origin);
    const same = url.pathname === win.location.pathname;
    win.history[replace || same ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search + url.hash);
    show(true);
  }

  function onClick(event) {
    const anchor = event.target?.closest?.('a[href]') ?? null;
    if (!isInternalLink(event, anchor, win.location.origin)) return;
    event.preventDefault();
    navigate(anchor.getAttribute('href'));
  }

  const onPop = () => show(true);

  return {
    navigate,
    /** Current route. */
    get current() { return current; },
    /** Renders the initial URL and starts listening. */
    start() {
      doc.addEventListener('click', onClick);
      win.addEventListener('popstate', onPop);
      show(false);
    },
    stop() {
      doc.removeEventListener('click', onClick);
      win.removeEventListener('popstate', onPop);
    },
  };
}
