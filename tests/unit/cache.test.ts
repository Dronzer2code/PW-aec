import { describe, expect, it } from 'vitest';
import { cacheKey, canonicalJson, LruCache } from '../../src/services/cache.js';

/** Controllable clock for TTL tests. */
const clock = (start = 1_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('LruCache', () => {
  it('stores and returns values', () => {
    const cache = new LruCache<number>(3, 1000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new LruCache<number>(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // "a" becomes most recently used
    cache.set('c', 3); // evicts "b"
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('evicts in insertion order when nothing is read', () => {
    const cache = new LruCache<number>(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('overwriting a key refreshes its value and recency without growing', () => {
    const cache = new LruCache<number>(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3); // evicts "b", not the refreshed "a"
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined();
  });

  it('expires entries after the TTL using the injected clock', () => {
    const c = clock();
    const cache = new LruCache<string>(10, 500, c.now);
    cache.set('k', 'v');
    c.advance(499);
    expect(cache.get('k')).toBe('v');
    c.advance(1);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('restarts the TTL when a key is set again', () => {
    const c = clock();
    const cache = new LruCache<string>(10, 500, c.now);
    cache.set('k', 'v1');
    c.advance(400);
    cache.set('k', 'v2');
    c.advance(400);
    expect(cache.get('k')).toBe('v2');
  });

  it.each([
    [0, 1000],
    [10, 0],
  ])('is disabled when maxEntries=%i or ttlMs=%i', (max, ttl) => {
    const cache = new LruCache<number>(max, ttl);
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('clear() removes everything', () => {
    const cache = new LruCache<number>(5, 1000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});

describe('canonicalJson', () => {
  it('is independent of key order, at every depth', () => {
    const a = { text: 'hi', location: { lat: 1, lng: 2 }, files: [{ name: 'x', data: 'y' }] };
    const b = { files: [{ data: 'y', name: 'x' }], location: { lng: 2, lat: 1 }, text: 'hi' };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"files":[{"data":"y","name":"x"}],"location":{"lat":1,"lng":2},"text":"hi"}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('drops undefined properties like JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('serializes primitives and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson(3.5)).toBe('3.5');
    expect(canonicalJson(true)).toBe('true');
  });
});

describe('cacheKey', () => {
  it('is a stable SHA-256 hex digest', () => {
    const key = cacheKey({ text: 'help', country: 'IN' });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey({ country: 'IN', text: 'help' })).toBe(key);
  });

  it('differs for different requests', () => {
    expect(cacheKey({ text: 'help', liveCheck: false })).not.toBe(cacheKey({ text: 'help', liveCheck: true }));
  });
});
