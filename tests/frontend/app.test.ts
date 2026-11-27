// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCard } from './fixtures.js';
import { FakeMediaRecorder, cleanNavigator, installFakeMic } from './fakes.js';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');

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

async function boot(analyze: Analyze, config: unknown = CONFIG) {
  document.body.innerHTML = new DOMParser().parseFromString(INDEX_HTML, 'text/html').body.innerHTML;
  const analyzeMock = vi.fn(analyze);
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/config') return config instanceof Response ? config : json(200, config);
    return analyzeMock(JSON.parse(String(init.body)) as Record<string, unknown>, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  await import('../../public/js/app.js');
  // Config is applied once the countries are replaced, or a status message explains why not.
  await vi.waitFor(() =>
    expect(byId<HTMLSelectElement>('country-select').options.length === 2 || byId('status').textContent !== '').toBe(true),
  );
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
  await vi.waitFor(() => expect(byId('card-region').getAttribute('aria-busy')).toBe('false'));
}

describe('app.js', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    FakeMediaRecorder.reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanNavigator();
  });

  it('populates selects from /api/config and loads text samples', async () => {
    await boot(() => json(200, makeCard()));
    expect(byId<HTMLSelectElement>('country-select').options).toHaveLength(2);
    expect(byId<HTMLSelectElement>('language-select').options[1]?.textContent).toBe('हिन्दी (Hindi)');
    expect(byId('sample-list').querySelectorAll('button')).toHaveLength(6);
    byId('sample-list').querySelectorAll('button')[2]?.click();
    await vi.waitFor(() => expect(byId('status').textContent).toContain('Live web check turned on'));
    expect(byId<HTMLTextAreaElement>('intake-text').value).toContain('Dam gates');
    expect(byId<HTMLInputElement>('live-check').checked).toBe(true);
    expect(byId('char-count').textContent).toMatch(/^\d{3} \/ 10,000 characters$/);
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

  it('attaches a generated prescription image for the photo sample', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy({}, { get: (_t, key) => (key === 'canvas' ? undefined : vi.fn()) }) as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })));
    let sent: Record<string, unknown> = {};
    await boot((body) => {
      sent = body;
      return json(200, makeCard());
    });
    const photo = Array.from(byId('sample-list').querySelectorAll('button')).find((b) => b.textContent === 'Photo of a prescription');
    photo?.click();
    await vi.waitFor(() => expect(byId('file-list').textContent).toContain('prescription-sample.png'));
    byId('status').textContent = '';
    photo?.click();
    await vi.waitFor(() => expect(byId('status').textContent).toContain('Sample loaded'));
    expect(byId('file-list').querySelectorAll('li')).toHaveLength(1);
    await submitText('Can you read this prescription?');
    expect(sent.files).toEqual([{ name: 'prescription-sample.png', mimeType: 'image/png', data: 'cG5n' }]);
  });

  it('asks for input instead of sending an empty request', async () => {
    const analyze = await boot(() => json(200, makeCard()));
    byId<HTMLFormElement>('intake-form').requestSubmit();
    expect(byId('error-text').textContent).toContain('Describe the situation');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('sends the Intake and renders the Action Card with focus on its heading', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 28.612345, longitude: 77.209876 } } as GeolocationPosition) },
    });
    const analyze = await boot(() => json(200, makeCard()));
    byId<HTMLSelectElement>('country-select').value = 'US';
    byId<HTMLInputElement>('share-location').checked = true;
    await submitText('  my father has chest pain  ');
    expect(analyze.mock.calls[0]?.[0]).toEqual({
      text: 'my father has chest pain',
      files: [],
      language: 'en',
      country: 'US',
      liveCheck: false,
      location: { lat: 28.612, lng: 77.21 },
    });
    expect(byId('card-region').querySelector('article.action-card')).not.toBeNull();
    expect(document.activeElement?.id).toBe('card-title');
    expect(byId('card-toolbar').hidden).toBe(false);
    expect(byId('status').textContent).toContain('Action Card ready. Severity Critical.');
    expect(byId('submit-btn').getAttribute('aria-disabled')).toBe('false');
  });

  it('continues without location when it is unavailable', async () => {
    const analyze = await boot(() => json(200, makeCard()));
    byId<HTMLInputElement>('share-location').checked = true;
    await submitText('flood');
    expect(analyze.mock.calls[0]?.[0]).not.toHaveProperty('location');
  });

  it('ignores a second submit while busy and keeps focus on the submit button', async () => {
    let release: (r: Response) => void = () => undefined;
    const analyze = await boot(() => new Promise<Response>((r) => { release = r; }));
    typeText('help');
    const submit = byId<HTMLButtonElement>('submit-btn');
    submit.focus();
    byId<HTMLFormElement>('intake-form').requestSubmit();
    byId<HTMLFormElement>('intake-form').requestSubmit();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.disabled).toBe(false);
    expect(document.activeElement).toBe(submit);
    expect(byId('card-region').getAttribute('aria-busy')).toBe('true');
    expect(byId('status').textContent).toContain('usually takes 5–20 seconds');
    release(json(200, makeCard()));
    await vi.waitFor(() => expect(submit.getAttribute('aria-disabled')).toBe('false'));
    expect(analyze).toHaveBeenCalledTimes(1);
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
  });

  it('shows the emergency number without retry when the AI is unavailable', async () => {
    await boot(() => apiError(503, 'AI_UNAVAILABLE'));
    byId<HTMLSelectElement>('country-select').value = 'US';
    await submitText('fire in the kitchen');
    expect(byId('error-text').textContent).toContain('not configured');
    expect(byId('retry-btn').hidden).toBe(true);
    expect(byId('card-region').querySelector('a.call-btn')?.getAttribute('href')).toBe('tel:911');
    expect(byId('card-toolbar').hidden).toBe(true);
  });

  it('shows validation details without retry and keeps the empty state', async () => {
    await boot(() => apiError(400, 'VALIDATION_ERROR', { details: ['text: too long', 'files.0: bad type'] }));
    await submitText('x');
    expect(byId('error-text').textContent).toContain('(text: too long; files.0: bad type)');
    expect(byId('retry-btn').hidden).toBe(true);
    expect(byId('empty-state')).not.toBeNull();
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

  it('attaches, lists and removes files', async () => {
    await boot(() => json(200, makeCard()));
    const input = byId<HTMLInputElement>('file-input');
    const files = [new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }), new File(['x'], 'a.txt', { type: 'text/plain' })];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(byId('file-list').querySelectorAll('li')).toHaveLength(1));
    expect(byId('error-text').textContent).toContain('a.txt: unsupported type');
    byId('file-list').querySelector<HTMLButtonElement>('button[aria-label="Remove scan.pdf"]')?.click();
    expect(byId('file-list').querySelectorAll('li')).toHaveLength(0);
    expect(document.activeElement).toBe(input);
    expect(byId('status').textContent).toBe('Removed scan.pdf.');
  });

  it('records a voice note with a stable name, aria-pressed and a double-click guard', async () => {
    let grant: (stream: unknown) => void = () => undefined;
    const track = { stop: vi.fn() };
    const { gum } = installFakeMic(() => new Promise((r) => { grant = r; }));
    await boot(() => json(200, makeCard()));
    const btn = byId<HTMLButtonElement>('record-btn');
    btn.click();
    btn.click(); // permission prompt still open
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
  });

  it('runs the toolbar: read aloud toggle, copy SMS, download JSON, print', async () => {
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
    await submitText('accident');
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
    expect(print).toHaveBeenCalled();
    window.dispatchEvent(new Event('beforeprint'));
    expect(Array.from(byId('card-region').querySelectorAll('details')).every((d) => d.open)).toBe(true);
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
});
