// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCard } from './fixtures.js';

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
  limits: { maxTextChars: 10_000, maxFiles: 4, maxFileBytes: 5 * 1024 * 1024 },
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

async function boot(analyze: (body: Record<string, unknown>) => Response): Promise<ReturnType<typeof vi.fn>> {
  document.body.innerHTML = new DOMParser().parseFromString(INDEX_HTML, 'text/html').body.innerHTML;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    url === '/api/config' ? json(200, CONFIG) : analyze(JSON.parse(String(init?.body)) as Record<string, unknown>),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  await import('../../public/js/app.js');
  await vi.waitFor(() => expect(byId<HTMLSelectElement>('country-select').options).toHaveLength(2));
  return fetchMock;
}

async function submitText(value: string): Promise<void> {
  const text = byId<HTMLTextAreaElement>('intake-text');
  text.value = value;
  text.dispatchEvent(new Event('input'));
  byId<HTMLFormElement>('intake-form').requestSubmit();
  await vi.waitFor(() => expect(byId('card-region').getAttribute('aria-busy')).toBe('false'));
}

describe('app.js', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('populates selects from /api/config and renders sample buttons', async () => {
    await boot(() => json(200, makeCard()));
    expect(byId<HTMLSelectElement>('language-select').options[1]?.textContent).toBe('हिन्दी (Hindi)');
    expect(byId('sample-list').querySelectorAll('button')).toHaveLength(4);
    byId('sample-list').querySelectorAll('button')[2]?.click();
    expect(byId<HTMLTextAreaElement>('intake-text').value).toContain('Dam gates');
    expect(byId<HTMLInputElement>('live-check').checked).toBe(true);
    expect(byId('char-count').textContent).toMatch(/^\d{3} \/ 10,000 characters$/);
  });

  it('asks for input instead of sending an empty request', async () => {
    const fetchMock = await boot(() => json(200, makeCard()));
    byId<HTMLFormElement>('intake-form').requestSubmit();
    expect(byId('error-text').textContent).toContain('Describe the situation');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the Intake and renders the Action Card with focus on its heading', async () => {
    let sent: Record<string, unknown> = {};
    await boot((body) => {
      sent = body;
      return json(200, makeCard());
    });
    byId<HTMLSelectElement>('country-select').value = 'US';
    await submitText('  my father has chest pain  ');
    expect(sent).toEqual({ text: 'my father has chest pain', files: [], language: 'en', country: 'US', liveCheck: false });
    expect(byId('card-region').querySelector('article.action-card')).not.toBeNull();
    expect(document.activeElement?.id).toBe('card-title');
    expect(byId('card-toolbar').hidden).toBe(false);
    expect(byId('status').textContent).toContain('Action Card ready. Severity Critical.');
    expect(byId<HTMLButtonElement>('submit-btn').disabled).toBe(false);
  });

  it('shows the emergency number when the AI is unavailable', async () => {
    await boot(() => json(503, { error: { code: 'AI_UNAVAILABLE', message: 'no key', requestId: 'r-1' } }));
    byId<HTMLSelectElement>('country-select').value = 'US';
    await submitText('fire in the kitchen');
    expect(byId('error-text').textContent).toContain('not available right now');
    expect(byId('error-text').textContent).toContain('Reference: r-1.');
    expect(byId('card-region').querySelector('a.call-btn')?.getAttribute('href')).toBe('tel:911');
    expect(byId('card-toolbar').hidden).toBe(true);
  });

  it('offers a retry on timeouts and keeps the empty state for rate limits', async () => {
    await boot(() => json(504, { error: { code: 'AI_TIMEOUT', message: 'slow', requestId: 'r-2' } }));
    await submitText('help');
    expect(byId('retry-btn').hidden).toBe(false);

    await boot(() => json(429, { error: { code: 'RATE_LIMITED', message: 'slow down', requestId: 'r-3' } }));
    await submitText('help');
    expect(byId('error-text').textContent).toContain('wait a minute');
    expect(byId('empty-state')).not.toBeNull();
  });
});
