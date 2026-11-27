// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCard } from './fixtures.js';
import { FakeMediaRecorder, cleanNavigator, installFakeMic } from './fakes.js';

const APP_HTML = readFileSync(resolve(process.cwd(), 'public/app.html'), 'utf8');

const CONFIG = {
  languages: [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  ],
  countries: [
    { code: 'IN', name: 'India', emergency: '112' },
    { code: 'US', name: 'United States', emergency: '911' },
  ],
  aiAvailable: true,
  requestTimeoutMs: 70_000,
  limits: { maxTextChars: 10_000, maxFiles: 4, maxFileBytes: 5 * 1024 * 1024 },
};

type Analyze = (body: Record<string, unknown>, init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const apiError = (status: number, code: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  json(status, { error: { code, message: `${code} message`, requestId: 'req-9', ...extra } }, headers);

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};
const visibleH1 = () => Array.from(document.querySelectorAll('h1')).find((h) => !h.closest('[hidden]'));
const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

/** Listeners added by each booted app instance, removed after every test so instances never overlap. */
const listeners: [EventTarget, string, EventListenerOrEventListenerObject][] = [];

async function boot(analyze: Analyze, config: unknown = CONFIG, path = '/app') {
  history.replaceState(null, '', path);
  document.body.innerHTML = new DOMParser().parseFromString(APP_HTML, 'text/html').body.innerHTML;
  const analyzeMock = vi.fn(analyze);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/config') return config instanceof Response ? config : json(200, config);
    return analyzeMock(JSON.parse(String(init.body)) as Record<string, unknown>, init);
  }));
  vi.resetModules();
  const spies = [vi.spyOn(document, 'addEventListener'), vi.spyOn(window, 'addEventListener')];
  await import('../../public/js/app.js');
  spies.forEach((spy, n) => {
    for (const [type, fn] of spy.mock.calls) listeners.push([n ? window : document, type, fn as EventListener]);
    spy.mockRestore();
  });
  await vi.waitFor(() =>
    expect(byId<HTMLSelectElement>('country-select').options.length === 2 || byId('status').textContent !== '').toBe(true));
  return analyzeMock;
}

function typeText(value: string): void {
  const text = byId<HTMLTextAreaElement>('intake-text');
  text.value = value;
  text.dispatchEvent(new Event('input'));
}

async function submitText(value: string): Promise<void> {
  typeText(value);
  byId<HTMLFormElement>('intake-form').requestSubmit();
  await vi.waitFor(() => expect(byId('submit-btn').getAttribute('aria-disabled')).toBe('false'));
  await vi.waitFor(() => expect(byId('card-region').getAttribute('aria-busy')).toBe('false'));
}

/** Submits and waits for the card page. */
async function createCard(value = 'accident'): Promise<void> {
  await submitText(value);
  await vi.waitFor(() => expect(location.pathname).toMatch(/^\/app\/cards\//));
}

const click = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.click();

describe('app.js', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.scrollTo = vi.fn() as never;
    sessionStorage.clear();
    FakeMediaRecorder.reset();
  });
  afterEach(() => {
    for (const [target, type, fn] of listeners.splice(0)) target.removeEventListener(type, fn);
    vi.unstubAllGlobals();
    cleanNavigator();
  });

  describe('config and samples', () => {
    it('populates every language and country select from /api/config', async () => {
      await boot(() => json(200, makeCard()));
      expect(byId<HTMLSelectElement>('language-select').options[1]?.textContent).toBe('हिन्दी (Hindi)');
      expect(byId<HTMLSelectElement>('qs-language').options).toHaveLength(2);
      expect(Array.from(byId<HTMLSelectElement>('country-select').options).map((o) => o.textContent)).toEqual(['IN · 112', 'US · 911']);
      expect(byId<HTMLSelectElement>('qs-country').options[1]?.textContent).toBe('United States · 911');
      expect(byId<HTMLSelectElement>('emergency-country').options).toHaveLength(2);
      expect(byId('char-count').textContent).toBe('0 / 10,000 characters');
    });

    it('falls back to defaults when /api/config fails', async () => {
      await boot(() => json(200, makeCard()), new Response('nope', { status: 500 }));
      expect(byId('status').textContent).toContain('Using defaults');
      expect(byId<HTMLSelectElement>('country-select').value).toBe('IN');
    });

    it('announces when the AI is not configured', async () => {
      await boot(() => json(200, makeCard()), { ...CONFIG, aiAvailable: false });
      expect(byId('status').textContent).toContain('not configured');
    });

    it('shows three suggestion cards that load a sample into the composer', async () => {
      await boot(() => json(200, makeCard()));
      const buttons = byId('sample-list').querySelectorAll('button');
      expect(buttons).toHaveLength(3);
      buttons[1]?.click();
      await vi.waitFor(() => expect(byId('status').textContent).toContain('Sample loaded: Chest pain'));
      expect(byId<HTMLTextAreaElement>('intake-text').value).toContain('chest pain');
      expect(document.activeElement?.id).toBe('intake-text');
      expect(byId('char-count').textContent).toMatch(/^\d{3} \/ 10,000 characters$/);
    });

    it('uses a sample from the samples page: navigates to /app and turns on the live check', async () => {
      await boot(() => json(200, makeCard()), CONFIG, '/app/samples');
      expect(byId('sample-grid').querySelectorAll(':scope > li')).toHaveLength(6);
      const flood = Array.from(byId('sample-grid').querySelectorAll('button')).find((b) => b.textContent?.includes('Flood warning'));
      flood?.click();
      expect(location.pathname).toBe('/app');
      await vi.waitFor(() => expect(byId('status').textContent).toContain('Live web check turned on'));
      expect(byId('live-btn').getAttribute('aria-pressed')).toBe('true');
      expect(byId<HTMLTextAreaElement>('intake-text').value).toContain('Dam gates');
    });

    it('attaches a generated prescription image for the photo sample', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        new Proxy({}, { get: (_t, k) => (k === 'canvas' ? undefined : vi.fn()) }) as CanvasRenderingContext2D,
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })));
      let sent: Record<string, unknown> = {};
      await boot((body) => {
        sent = body;
        return json(200, makeCard());
      });
      click('[data-sample="prescription-photo"]');
      await vi.waitFor(() => expect(byId('file-list').textContent).toContain('prescription-sample.png'));
      byId('status').textContent = '';
      click('[data-sample="prescription-photo"]');
      await vi.waitFor(() => expect(byId('status').textContent).toContain('Sample loaded'));
      expect(byId('file-list').querySelectorAll('li')).toHaveLength(1);
      await createCard('Can you read this prescription?');
      expect(sent.files).toEqual([{ name: 'prescription-sample.png', mimeType: 'image/png', data: 'cG5n' }]);
    });
  });

  describe('submit', () => {
    it('asks for input instead of sending an empty request', async () => {
      const analyze = await boot(() => json(200, makeCard()));
      byId<HTMLFormElement>('intake-form').requestSubmit();
      expect(byId('intake-error').textContent).toContain('Describe the situation');
      expect(byId('intake-text').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement?.id).toBe('intake-text');
      expect(analyze).not.toHaveBeenCalled();
      typeText('help');
      expect(byId('intake-error').hidden).toBe(true);
      expect(byId('intake-text').getAttribute('aria-invalid')).toBe('false');
    });

    it('sends the Intake, stores the card and opens its page with focus on the heading', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 28.612345, longitude: 77.209876 } } as GeolocationPosition) },
      });
      const analyze = await boot(() => json(200, makeCard()));
      const country = byId<HTMLSelectElement>('country-select');
      country.value = 'US';
      country.dispatchEvent(new Event('change'));
      byId('location-btn').click();
      expect(byId('location-btn').getAttribute('aria-pressed')).toBe('true');
      await createCard('  my father has chest pain  ');
      expect(analyze.mock.calls[0]?.[0]).toEqual({
        text: 'my father has chest pain',
        files: [],
        language: 'en',
        country: 'US',
        liveCheck: false,
        location: { lat: 28.612, lng: 77.21 },
      });
      expect(location.pathname).toBe('/app/cards/req-123');
      expect(document.title).toBe('Road accident · LifeBridge');
      expect(document.activeElement?.id).toBe('card-title');
      expect(byId('card-title').tagName).toBe('H1');
      expect(byId('summary-title').textContent).toBe('Road accident');
      expect(Array.from(byId('breadcrumb').querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/app', '/app/cards', '/app/cards/req-123']);
      expect(byId('breadcrumb').hidden).toBe(false);
      expect(byId('recent-list').querySelector('a')?.getAttribute('href')).toBe('/app/cards/req-123');
      expect(byId('status').textContent).toContain('Action Card ready. Severity Critical.');
      expect(byId<HTMLTextAreaElement>('intake-text').value).toBe('');
      expect(JSON.parse(sessionStorage.getItem('lifebridge.cards.v1') ?? '[]')).toHaveLength(1);
    });

    it('continues without location when it is unavailable', async () => {
      const analyze = await boot(() => json(200, makeCard()));
      byId('location-btn').click();
      await createCard('flood');
      expect(analyze.mock.calls[0]?.[0]).not.toHaveProperty('location');
    });

    it('shows progress, ignores a second submit while busy and keeps focus on the send button', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let release: (r: Response) => void = () => undefined;
      const analyze = await boot(() => new Promise<Response>((r) => { release = r; }));
      typeText('help');
      const submit = byId<HTMLButtonElement>('submit-btn');
      submit.focus();
      byId<HTMLFormElement>('intake-form').requestSubmit();
      byId<HTMLFormElement>('intake-form').requestSubmit();
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
      expect(submit.getAttribute('aria-disabled')).toBe('true');
      expect(byId('submit-label').textContent).toBe('Creating Action Card…');
      expect(document.activeElement).toBe(submit);
      expect(byId('card-region').getAttribute('aria-busy')).toBe('true');
      expect(byId('suggestions').hidden).toBe(true);
      expect(byId('card-region').querySelector('[aria-current="step"]')?.textContent).toContain('Structuring with Gemini');
      vi.advanceTimersByTime(4000);
      expect(byId('card-region').querySelector('[aria-current="step"]')?.textContent).toContain('Verifying');
      expect(byId('status').textContent).toContain('usually takes 5–20 seconds');
      vi.useRealTimers();
      release(json(200, makeCard()));
      await vi.waitFor(() => expect(submit.getAttribute('aria-disabled')).toBe('false'));
      expect(analyze).toHaveBeenCalledTimes(1);
    });

    it('stays on the current page when the user navigated away while waiting', async () => {
      let release: (r: Response) => void = () => undefined;
      const analyze = await boot(() => new Promise<Response>((r) => { release = r; }));
      typeText('help');
      byId<HTMLFormElement>('intake-form').requestSubmit();
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
      click('[data-nav="emergency"]');
      release(json(200, makeCard()));
      await vi.waitFor(() => expect(byId('recent-list').children).toHaveLength(1));
      expect(location.pathname).toBe('/app/emergency');
    });

    it.each([
      ['AI_TIMEOUT', 504],
      ['AI_BAD_OUTPUT', 502],
      ['AI_UPSTREAM_ERROR', 502],
      ['INTERNAL', 500],
    ])('offers retry and the emergency number for %s', async (code, status) => {
      await boot(() => apiError(status, code));
      await submitText('help');
      expect(byId('retry-btn').hidden).toBe(false);
      expect(byId('error-text').textContent).toContain('Reference: req-9.');
      expect(byId('card-region').querySelector('a.call-btn')?.getAttribute('href')).toBe('tel:112');
      expect(byId('card-region').querySelector('h2')?.textContent).toBe('Emergency number for India');
      expect(location.pathname).toBe('/app');
    });

    it('shows the emergency number without retry when the AI is unavailable', async () => {
      await boot(() => apiError(503, 'AI_UNAVAILABLE'));
      byId<HTMLSelectElement>('country-select').value = 'US';
      await submitText('fire in the kitchen');
      expect(byId('error-text').textContent).toContain('not configured');
      expect(byId('retry-btn').hidden).toBe(true);
      expect(byId('card-region').querySelector('a.call-btn')?.getAttribute('href')).toBe('tel:911');
    });

    it('shows validation details without retry or fallback', async () => {
      await boot(() => apiError(400, 'VALIDATION_ERROR', { details: ['text: too long', 'files.0: bad type'] }));
      await submitText('x');
      expect(byId('error-text').textContent).toContain('(text: too long; files.0: bad type)');
      expect(byId('retry-btn').hidden).toBe(true);
      expect(byId('card-region').children).toHaveLength(0);
      expect(byId('suggestions').hidden).toBe(false);
    });

    it('shows retry for rate limits only after the Retry-After wait', async () => {
      await boot(() => apiError(429, 'RATE_LIMITED', {}, { 'Retry-After': '0' }));
      await submitText('help');
      expect(byId('error-text').textContent).toContain('wait a moment');
      await vi.waitFor(() => expect(byId('retry-btn').hidden).toBe(false));
    });

    it('maps a 413 without an error envelope to PAYLOAD_TOO_LARGE', async () => {
      await boot(() => new Response('<html>too big</html>', { status: 413 }));
      await submitText('x');
      expect(byId('error-text').textContent).toContain('too large');
    });

    it('reports network errors and retries on click', async () => {
      const analyze = await boot(() => {
        throw new TypeError('Failed to fetch');
      });
      await submitText('help');
      expect(byId('error-text').textContent).toContain('Could not reach LifeBridge');
      byId('retry-btn').click();
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
    });

    it('aborts after the timeout from /api/config', async () => {
      await boot(
        (_body, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
        { ...CONFIG, requestTimeoutMs: 30 },
      );
      await submitText('help');
      expect(byId('error-text').textContent).toContain('took too long');
      expect(byId('retry-btn').hidden).toBe(false);
    });

    it('treats an unexpected failure while building the request as INTERNAL', async () => {
      await boot(() => json(200, makeCard()));
      const input = byId<HTMLInputElement>('file-input');
      Object.defineProperty(input, 'files', { value: [new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })], configurable: true });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(byId('file-list').children).toHaveLength(1));
      vi.stubGlobal('FileReader', class { readAsDataURL() { throw new Error('boom'); } });
      await submitText('x');
      expect(byId('error-text').textContent).toContain('Something went wrong');
    });
  });

  describe('files and voice', () => {
    it('opens the hidden file picker from the + button', async () => {
      await boot(() => json(200, makeCard()));
      const pick = vi.spyOn(byId<HTMLInputElement>('file-input'), 'click').mockImplementation(() => undefined);
      byId('attach-btn').click();
      expect(pick).toHaveBeenCalled();
    });

    it('attaches, lists and removes files', async () => {
      await boot(() => json(200, makeCard()));
      const input = byId<HTMLInputElement>('file-input');
      const files = [
        new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }),
        new File(['x'], 'a.txt', { type: 'text/plain' }),
        new File(['a'], 'note.webm', { type: 'audio/webm' }),
      ];
      Object.defineProperty(input, 'files', { value: files, configurable: true });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(byId('file-list').querySelectorAll('li')).toHaveLength(2));
      expect(byId('error-text').textContent).toContain('a.txt: unsupported type');
      expect(Array.from(byId('file-list').querySelectorAll('.file-icon')).map((i) => i.textContent)).toEqual(['PDF', 'AUD']);
      click('#file-list button[aria-label="Remove scan.pdf"]');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove note.webm');
      click('#file-list button[aria-label="Remove note.webm"]');
      expect(byId('file-list').querySelectorAll('li')).toHaveLength(0);
      expect(document.activeElement?.id).toBe('attach-btn');
      expect(byId('status').textContent).toBe('Removed note.webm.');
    });

    it('records a voice note with a stable name, aria-pressed and a double-click guard', async () => {
      let grant: (stream: unknown) => void = () => undefined;
      const track = { stop: vi.fn() };
      const { gum } = installFakeMic(() => new Promise((r) => { grant = r; }));
      await boot(() => json(200, makeCard()));
      const btn = byId<HTMLButtonElement>('record-btn');
      btn.click();
      btn.click();
      expect(gum).toHaveBeenCalledTimes(1);
      grant({ getTracks: () => [track] });
      await vi.waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
      expect(byId('record-label').textContent).toBe('Record voice note');
      expect(byId('record-timer').hidden).toBe(false);
      btn.click();
      await vi.waitFor(() => expect(byId('file-list').textContent).toContain('voice-note-1.webm'));
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect(track.stop).toHaveBeenCalled();
    });

    it('stops an active recording and includes it when submitting', async () => {
      installFakeMic();
      const analyze = await boot(() => json(200, makeCard()));
      byId('record-btn').click();
      await vi.waitFor(() => expect(byId('record-btn').getAttribute('aria-pressed')).toBe('true'));
      byId<HTMLFormElement>('intake-form').requestSubmit();
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
      expect(analyze.mock.calls[0]?.[0].files).toEqual([expect.objectContaining({ mimeType: 'audio/webm' })]);
    });

    it('explains microphone denial', async () => {
      installFakeMic(async () => {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      });
      await boot(() => json(200, makeCard()));
      byId('record-btn').click();
      await vi.waitFor(() => expect(byId('error-text').textContent).toContain('Microphone access was blocked'));
      expect(byId('record-btn').getAttribute('aria-pressed')).toBe('false');
    });

    it('disables recording when unsupported', async () => {
      await boot(() => json(200, makeCard()));
      expect(byId<HTMLButtonElement>('record-btn').disabled).toBe(true);
      expect(byId('record-label').textContent).toContain('not supported');
    });
  });

  describe('pages and navigation', () => {
    it('lists created cards and links back to them; handles unknown ids and routes', async () => {
      await boot(() => json(200, makeCard()), CONFIG, '/app/cards');
      expect(visibleH1()?.textContent).toBe('Action Cards');
      expect(byId('card-list-slot').textContent).toContain('No Action Cards yet');
      expect(byId('breadcrumb').querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/app/cards');
      expect(document.querySelector('[data-nav="cards"]')?.getAttribute('aria-current')).toBe('page');
      click('#card-list-slot a');
      expect(location.pathname).toBe('/app');
      expect(document.querySelector('[data-nav="new"]')?.getAttribute('aria-current')).toBe('page');
      expect(byId('breadcrumb').hidden).toBe(true);
      await createCard();
      click('[data-nav="cards"]');
      expect(byId('card-list-slot').querySelectorAll('a.card-row')).toHaveLength(1);
      click('#card-list-slot a.card-row');
      expect(document.activeElement?.id).toBe('card-title');
      expect(document.querySelector('[data-nav="cards"]')?.getAttribute('aria-current')).toBe('page');

      history.pushState(null, '', '/app/cards/missing');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(visibleH1()?.textContent).toBe('Action Card not found');
      expect(byId('summary-slot').hidden).toBe(true);
      expect(document.title).toBe('Action Card not found · LifeBridge');

      history.pushState(null, '', '/app/nope');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(visibleH1()?.textContent).toBe('Page not found');
      expect(document.activeElement).toBe(visibleH1());
      expect(byId('status').textContent).toBe('Page not found page');
    });

    it('restores cards from sessionStorage on reload', async () => {
      sessionStorage.setItem('lifebridge.cards.v1', JSON.stringify([{ id: 'saved', createdAt: Date.now(), card: makeCard({ domain: 'fire' }) }]));
      await boot(() => json(200, makeCard()), CONFIG, '/app/cards/saved');
      expect(byId('card-title').textContent).toBe('Fire');
      expect(byId('recent-list').textContent).toContain('Fire');
    });

    it('switches country on the emergency page and keeps every country control in sync', async () => {
      await boot(() => json(200, makeCard()), CONFIG, '/app/emergency');
      expect(byId('call-slot').querySelectorAll('a.call-card')).toHaveLength(7);
      expect(byId('sos-link').getAttribute('href')).toBe('tel:112');
      const select = byId<HTMLSelectElement>('emergency-country');
      select.value = 'US';
      select.dispatchEvent(new Event('change'));
      expect(Array.from(byId('call-slot').querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['tel:911']);
      expect(byId<HTMLSelectElement>('country-select').value).toBe('US');
      expect(byId<HTMLSelectElement>('qs-country').value).toBe('US');
      expect(byId('sos-link').getAttribute('href')).toBe('tel:911');
      expect(byId('sos-link').textContent).toContain('Emergency · 911');
      expect(byId('country-name').textContent).toBe('United States, emergency number 911');
    });

    it('opens quick settings from the brand card and syncs the language', async () => {
      await boot(() => json(200, makeCard()));
      const brand = byId('brand-btn');
      brand.click();
      expect(byId('quick-settings').hidden).toBe(false);
      expect(brand.getAttribute('aria-expanded')).toBe('true');
      const qs = byId<HTMLSelectElement>('qs-language');
      qs.value = 'hi';
      qs.dispatchEvent(new Event('change', { bubbles: true }));
      expect(byId<HTMLSelectElement>('language-select').value).toBe('hi');
      expect(byId('quick-settings').hidden).toBe(false);
      key(qs, 'Escape');
      expect(byId('quick-settings').hidden).toBe(true);
      expect(document.activeElement).toBe(brand);
      brand.click();
      document.body.click();
      expect(byId('quick-settings').hidden).toBe(true);
    });

    it('filters suggestions, samples and recent cards from the sidebar search', async () => {
      await boot(() => json(200, makeCard()));
      await createCard();
      click('[data-nav="new"]');
      const search = byId<HTMLInputElement>('search');
      key(document.body, '/');
      expect(document.activeElement).toBe(search);
      key(byId('intake-text'), '/');
      search.value = 'chest';
      search.dispatchEvent(new Event('input'));
      const shown = (id: string) => Array.from(byId(id).children).filter((li) => !(li as HTMLElement).hidden).length;
      expect(shown('sample-list')).toBe(1);
      expect(shown('sample-grid')).toBe(1);
      expect(shown('recent-list')).toBe(0);
      expect(byId('search-empty').hidden).toBe(true);
      search.value = 'road accident';
      search.dispatchEvent(new Event('input'));
      expect(shown('recent-list')).toBe(1);
      search.value = 'zzz';
      search.dispatchEvent(new Event('input'));
      expect(byId('search-empty').hidden).toBe(false);
      key(search, 'Escape');
      expect(search.value).toBe('');
      expect(shown('sample-list')).toBe(3);
      key(search, 'Escape');
    });

    it('collapses Recent and shows overflow on demand', async () => {
      const entries = Array.from({ length: 7 }, (_, n) => ({ id: `c${n}`, createdAt: Date.now(), card: makeCard() }));
      sessionStorage.setItem('lifebridge.cards.v1', JSON.stringify(entries));
      await boot(() => json(200, makeCard()));
      const shown = () => Array.from(byId('recent-list').children).filter((li) => !(li as HTMLElement).hidden).length;
      expect(shown()).toBe(5);
      expect(byId('recent-more-label').textContent).toBe('Show 2 more');
      byId('recent-more').click();
      expect(shown()).toBe(7);
      expect(byId('recent-more-label').textContent).toBe('Show less');
      byId('recent-toggle').click();
      expect(byId('recent-body').hidden).toBe(true);
      expect(byId('recent-toggle').getAttribute('aria-expanded')).toBe('false');
      byId('recent-toggle').click();
      expect(byId('recent-body').hidden).toBe(false);
    });

    it('runs the mobile drawer: open, Escape, backdrop, "/" and navigation close it', async () => {
      await boot(() => json(200, makeCard()));
      const menu = byId('menu-btn');
      const sidebar = byId('sidebar');
      menu.click();
      expect(sidebar.classList.contains('is-open')).toBe(true);
      expect(menu.getAttribute('aria-expanded')).toBe('true');
      expect(sidebar.contains(document.activeElement)).toBe(true);
      key(document.body, 'Escape');
      expect(sidebar.classList.contains('is-open')).toBe(false);
      expect(document.activeElement).toBe(menu);
      menu.click();
      byId('sidebar-backdrop').click();
      expect(byId('sidebar-backdrop').hidden).toBe(true);
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      key(document.body, '/');
      expect(sidebar.classList.contains('is-open')).toBe(true);
      click('[data-nav="samples"]');
      expect(sidebar.classList.contains('is-open')).toBe(false);
      key(document.body, 'Escape');
    });
  });

  describe('card tools', () => {
    it('reads aloud, copies SMS, downloads JSON and prints', async () => {
      const speak = vi.fn();
      const cancel = vi.fn();
      vi.stubGlobal('speechSynthesis', { speak, cancel });
      vi.stubGlobal(
        'SpeechSynthesisUtterance',
        class extends EventTarget {
          lang = '';
          rate = 1;
          constructor(public text: string) {
            super();
          }
        },
      );
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const createObjectURL = vi.fn(() => 'blob:card');
      const revokeObjectURL = vi.fn();
      Object.assign(URL, { createObjectURL, revokeObjectURL });
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);

      await boot(() => json(200, makeCard()));
      await createCard();
      const speakBtn = byId('speak-btn');
      expect(speakBtn.hidden).toBe(false);
      speakBtn.click();
      expect(speakBtn.getAttribute('aria-pressed')).toBe('true');
      expect(speakBtn.textContent?.trim()).toBe('Read aloud');
      const utterance = speak.mock.calls[0]?.[0] as { text: string; lang: string } & EventTarget;
      expect(utterance.text).toContain('Severity: Critical');
      expect(utterance.lang).toBe('en');
      utterance.dispatchEvent(new Event('end'));
      expect(speakBtn.getAttribute('aria-pressed')).toBe('false');
      speakBtn.click();
      speakBtn.click();
      expect(speakBtn.getAttribute('aria-pressed')).toBe('false');

      byId('copy-btn').click();
      await vi.waitFor(() => expect(byId('status').textContent).toContain('copied'));
      expect(writeText).toHaveBeenCalledWith(makeCard().smsText);
      writeText.mockRejectedValueOnce(new Error('blocked'));
      byId('copy-btn').click();
      await vi.waitFor(() => expect(byId('error-text').textContent).toContain('Copy failed'));

      vi.useFakeTimers();
      byId('download-btn').click();
      expect(createObjectURL).toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:card');
      vi.useRealTimers();

      byId('print-btn').click();
      byId('top-print').click();
      expect(print).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new Event('beforeprint'));
      expect(Array.from(byId('card-doc').querySelectorAll('details')).every((d) => d.open)).toBe(true);
      byId('summary-slot').click();
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    });
  });
});
