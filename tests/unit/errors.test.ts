import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, toEnvelope, type ErrorCodeName } from '../../src/errors.js';
import { createLogger, silentLogger } from '../../src/logger.js';

describe('AppError', () => {
  it.each(Object.keys(ErrorCode) as ErrorCodeName[])('maps %s to its status and default message', (code) => {
    const err = new AppError(code);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
    expect(err.status).toBe(ErrorCode[code].status);
    expect(err.message).toBe(ErrorCode[code].message);
    expect(err.details).toEqual([]);
  });

  it('uses the expected HTTP statuses from the API contract', () => {
    expect(Object.fromEntries(Object.entries(ErrorCode).map(([k, v]) => [k, v.status]))).toEqual({
      VALIDATION_ERROR: 400,
      PAYLOAD_TOO_LARGE: 413,
      RATE_LIMITED: 429,
      AI_UNAVAILABLE: 503,
      AI_TIMEOUT: 504,
      AI_BAD_OUTPUT: 502,
      NOT_FOUND: 404,
      INTERNAL: 500,
    });
  });

  it('accepts a custom message and details', () => {
    const err = new AppError('VALIDATION_ERROR', 'Bad file.', ['files: a.png']);
    expect(err.message).toBe('Bad file.');
    expect(err.details).toEqual(['files: a.png']);
  });
});

describe('toEnvelope', () => {
  it('omits details when there are none', () => {
    expect(toEnvelope(new AppError('NOT_FOUND'), 'req-1')).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'req-1' },
    });
  });

  it('includes details when present', () => {
    const env = toEnvelope(new AppError('VALIDATION_ERROR', undefined, ['text: too long']), 'req-2');
    expect(env).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
        requestId: 'req-2',
        details: ['text: too long'],
      },
    });
  });
});

describe('createLogger', () => {
  const capture = (minSeverity?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR') => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (l) => lines.push(l), ...(minSeverity ? { minSeverity } : {}) });
    return { lines, logger, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
  };

  it('writes one JSON object per line with severity, message, time and fields', () => {
    const { lines, logger, parsed } = capture();
    logger.info('action card created', { requestId: 'r1', cached: false, latencyMs: 12 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    const [entry] = parsed();
    expect(entry).toMatchObject({ severity: 'INFO', message: 'action card created', requestId: 'r1', cached: false });
    expect(new Date(String(entry?.time)).toISOString()).toBe(entry?.time);
  });

  it('defaults to INFO and drops DEBUG', () => {
    const { logger, parsed } = capture();
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(parsed().map((e) => e.severity)).toEqual(['INFO', 'WARNING', 'ERROR']);
  });

  it('honours a custom minimum severity', () => {
    const debug = capture('DEBUG');
    debug.logger.debug('d');
    expect(debug.parsed().map((e) => e.severity)).toEqual(['DEBUG']);

    const warn = capture('WARNING');
    warn.logger.info('i');
    warn.logger.warn('w');
    warn.logger.error('e');
    expect(warn.parsed().map((e) => e.message)).toEqual(['w', 'e']);
  });

  it('writes to stdout by default', () => {
    const writes: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      createLogger().error('to stdout');
    } finally {
      process.stdout.write = original;
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(writes[0] ?? '')).toMatchObject({ severity: 'ERROR', message: 'to stdout' });
  });

  it('silentLogger never throws', () => {
    expect(() => {
      silentLogger.debug('x');
      silentLogger.info('x');
      silentLogger.warn('x');
      silentLogger.error('x');
    }).not.toThrow();
  });
});
