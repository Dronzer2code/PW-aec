// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createCardStore } from '../../public/js/pages/store.js';
import {
  PROGRESS_STEPS, relativeTime, renderBreadcrumb, renderCallGrid, renderCardList, renderProgress, renderRecentItems,
  renderSampleGrid, renderSuggestions,
} from '../../public/js/pages/views.js';
import { directoryFor } from '../../public/js/render.js';
import { SAMPLES } from '../../public/js/samples.js';
import { makeCard } from './fixtures.js';

const XSS = '<img src=x onerror=alert(1)>';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    data,
  };
}

describe('createCardStore', () => {
  it('adds cards newest first with URL-safe, unique ids and persists them', () => {
    const storage = memoryStorage();
    const store = createCardStore(storage);
    const a = store.add(makeCard(), 1000);
    const b = store.add(makeCard(), 2000);
    expect(a).toBe('req-123');
    expect(b).toBe('req-123-2');
    expect(store.list().map((i) => i.id)).toEqual(['req-123-2', 'req-123']);
    expect(store.get('req-123')?.createdAt).toBe(1000);
    expect(store.get('missing')).toBeNull();
    const reloaded = createCardStore(storage);
    expect(reloaded.list()).toHaveLength(2);
  });

  it('derives an id when the request id is missing or unsafe, and caps the list', () => {
    const store = createCardStore(memoryStorage(), { max: 2 });
    const base = makeCard();
    expect(store.add({ ...base, meta: { ...base.meta, requestId: '../<x>' } }, 0)).toBe('x');
    expect(store.add({ ...base, meta: undefined }, 36)).toBe('card-10');
    store.add(base, 1);
    expect(store.list()).toHaveLength(2);
  });

  it('survives corrupt, invalid and throwing storage', () => {
    expect(createCardStore(memoryStorage({ 'lifebridge.cards.v1': '{not json' })).list()).toEqual([]);
    expect(createCardStore(memoryStorage({ 'lifebridge.cards.v1': '{"a":1}' })).list()).toEqual([]);
    const mixed = JSON.stringify([{ id: '../x', createdAt: 1, card: {} }, { id: 'ok', createdAt: 1, card: {} }, null]);
    expect(createCardStore(memoryStorage({ 'lifebridge.cards.v1': mixed })).list().map((i) => i.id)).toEqual(['ok']);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    const store = createCardStore(throwing);
    expect(store.add(makeCard(), 1)).toBe('req-123');
    expect(store.list()).toHaveLength(1);
    expect(createCardStore(null).list()).toEqual([]);
  });
});

describe('page views', () => {
  it('formats relative times', () => {
    expect(relativeTime(0, 30_000)).toBe('just now');
    expect(relativeTime(0, 5 * 60_000)).toBe('5 min ago');
    expect(relativeTime(0, 3 * 3_600_000)).toBe('3 h ago');
    expect(relativeTime(0, 50 * 3_600_000)).toBe('2 d ago');
    expect(relativeTime(10, 0)).toBe('just now');
  });

  it('renders recent links with severity as text, not colour alone', () => {
    const [li] = renderRecentItems([{ id: 'abc', createdAt: 0, card: makeCard({ summary: XSS }) }]);
    const a = li?.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/app/cards/abc');
    expect(a?.hasAttribute('data-link')).toBe(true);
    expect(a?.textContent).toBe(`Critical severity: Road accident — ${XSS}`);
    expect(li?.querySelector('img')).toBeNull();
    expect(li?.querySelector('.sev-icon')?.classList.contains('sev-critical')).toBe(true);
    const [odd] = renderRecentItems([{ id: 'x', createdAt: 0, card: { severity: '__proto__' } }]);
    expect(odd?.querySelector('.sev-icon')?.classList.contains('sev-unknown')).toBe(true);
  });

  it('renders the card list and its empty state', () => {
    const empty = renderCardList([], 0);
    expect(empty.querySelector('h2')?.textContent).toBe('No Action Cards yet');
    expect(empty.querySelector('a')?.getAttribute('href')).toBe('/app');
    const list = renderCardList([
      { id: 'a', createdAt: 0, card: makeCard() },
      { id: 'b', createdAt: 0, card: makeCard({ severity: 'low', verification: { status: 'verified', groundingScore: 1, checks: [] } }) },
    ], 120_000);
    const rows = list.querySelectorAll('a.card-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('href')).toBe('/app/cards/a');
    expect(rows[0]?.textContent).toContain('Severity: Critical');
    expect(rows[0]?.textContent).toContain('2 min ago · Needs review');
    expect(rows[1]?.textContent).toContain('Verified');
  });

  it('renders suggestion and sample cards wired by data-sample', () => {
    const suggestions = renderSuggestions(SAMPLES.slice(0, 3));
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]?.querySelector('button')?.dataset.sample).toBe(SAMPLES[0]?.id);
    expect(suggestions[0]?.textContent).toContain('Try sample');
    const grid = renderSampleGrid(SAMPLES);
    expect(grid).toHaveLength(6);
    const photo = grid.find((li) => li.textContent?.includes('Photo of a prescription'));
    expect(Array.from(photo?.querySelectorAll('.input-tags li') ?? []).map((l) => l.textContent)).toEqual(['Text', 'Photo']);
    expect(photo?.querySelector('button')?.textContent).toBe('Use this sample: Photo of a prescription');
    const odd = renderSampleGrid([{ id: 'z', title: 'Z', description: 'd', inputs: ['bogus'], icon: 'info' }]);
    expect(odd[0]?.querySelector('.input-tags')?.textContent).toBe('Text');
  });

  it('renders verified call cards and drops unsafe tel values', () => {
    const grid = renderCallGrid([...directoryFor({ code: 'IN', emergency: '112' }), { label: 'Bad', number: '1', tel: 'javascript:alert(1)' }]);
    const links = Array.from(grid.querySelectorAll('a'));
    expect(links).toHaveLength(7);
    expect(links[0]?.getAttribute('href')).toBe('tel:112');
    expect(links[0]?.classList.contains('call-card-main')).toBe(true);
    expect(links[0]?.textContent).toBe('Call Emergency (all services)112');
  });

  it('renders a breadcrumb of real links with the current page marked', () => {
    const ol = renderBreadcrumb([{ label: 'Workspace', href: '/app' }, { label: 'Samples', href: '/app/samples' }]);
    const links = Array.from(ol.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/app', '/app/samples']);
    expect(links[0]?.hasAttribute('aria-current')).toBe(false);
    expect(links[1]?.getAttribute('aria-current')).toBe('page');
  });

  it('renders progress steps with text states', () => {
    const ol = renderProgress(1);
    const steps = Array.from(ol.querySelectorAll('li'));
    expect(steps).toHaveLength(PROGRESS_STEPS.length);
    expect(steps[0]?.textContent).toBe('Reading input (done)');
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect(steps[1]?.textContent).toBe('Structuring with Gemini (in progress)');
    expect(steps[2]?.textContent).toBe('Verifying');
  });
});
