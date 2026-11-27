import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies safe defaults when the environment is empty', () => {
    const config = loadConfig({});
    expect(config).toEqual({
      geminiApiKey: undefined,
      geminiModel: 'gemini-3.1-flash-lite',
      geminiFallbackModels: ['gemini-3.5-flash-lite', 'gemini-2.5-flash'],
      geminiLiveCheckModel: 'gemini-2.5-flash',
      port: 8080,
      nodeEnv: 'production',
      rateLimitPerMinute: 20,
      cacheTtlMs: 600_000,
      cacheMaxEntries: 100,
      geminiTimeoutMs: 30_000,
    });
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });

  it('coerces numeric strings and converts the cache TTL to milliseconds', () => {
    const config = loadConfig({
      GEMINI_API_KEY: '  secret-key  ',
      GEMINI_MODEL: 'gemini-2.5-pro',
      PORT: '3000',
      NODE_ENV: 'development',
      RATE_LIMIT_PER_MINUTE: '5',
      CACHE_TTL_SECONDS: '0',
      CACHE_MAX_ENTRIES: '0',
      GEMINI_TIMEOUT_MS: '1000',
    });
    expect(config.geminiApiKey).toBe('secret-key');
    expect(config.geminiModel).toBe('gemini-2.5-pro');
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.rateLimitPerMinute).toBe(5);
    expect(config.cacheTtlMs).toBe(0);
    expect(config.cacheMaxEntries).toBe(0);
    expect(config.geminiTimeoutMs).toBe(1000);
  });

  it.each(['', '   '])('treats an empty API key (%j) as not configured', (key) => {
    expect(loadConfig({ GEMINI_API_KEY: key }).geminiApiKey).toBeUndefined();
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', 'abc'],
    ['PORT', '80.5'],
    ['NODE_ENV', 'staging'],
    ['RATE_LIMIT_PER_MINUTE', '0'],
    ['RATE_LIMIT_PER_MINUTE', '1001'],
    ['CACHE_TTL_SECONDS', '-1'],
    ['CACHE_MAX_ENTRIES', '10001'],
    ['GEMINI_TIMEOUT_MS', '999'],
    ['GEMINI_TIMEOUT_MS', '120001'],
    ['GEMINI_MODEL', '   '],
  ])('rejects invalid %s=%j with a descriptive error', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(new RegExp(`Invalid configuration: .*${name}`));
  });

  it('reads process.env by default', () => {
    expect(() => loadConfig()).not.toThrow();
  });
});
