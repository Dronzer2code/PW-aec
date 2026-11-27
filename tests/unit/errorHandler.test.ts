import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { createLogger } from '../../src/logger.js';
import { errorHandler, notFound, toAppError } from '../../src/middleware/errorHandler.js';
import { requestId } from '../../src/middleware/requestId.js';

/** Minimal Response double recording status, headers and JSON body. */
const fakeRes = () => {
  const state: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return res;
    },
  };
  return { res: res as unknown as Response, state };
};

const fakeReq = (headers: Record<string, string> = {}, id = 'req-abc12345') =>
  ({ requestId: id, get: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

describe('toAppError', () => {
  it('passes AppError through unchanged', () => {
    const err = new AppError('AI_TIMEOUT');
    expect(toAppError(err)).toBe(err);
  });

  it.each([{ type: 'entity.too.large' }, { status: 413 }])('maps %j to PAYLOAD_TOO_LARGE', (err) => {
    expect(toAppError(err).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it.each([{ type: 'entity.parse.failed' }, { status: 400 }])('maps %j to VALIDATION_ERROR', (err) => {
    const appErr = toAppError(err);
    expect(appErr.code).toBe('VALIDATION_ERROR');
    expect(appErr.message).toBe('The request body is not valid JSON.');
  });

  it.each([new Error('boom'), new TypeError('x'), 'string', 42, { status: 418 }, { type: 'stream.encoding.unsupported' }])(
    'maps unknown error %j to INTERNAL',
    (err) => {
      const appErr = toAppError(err);
      expect(appErr.code).toBe('INTERNAL');
      expect(appErr.status).toBe(500);
    },
  );
});

describe('errorHandler', () => {
  const run = (err: unknown) => {
    const lines: string[] = [];
    const handler = errorHandler(createLogger({ sink: (l) => lines.push(l) }));
    const { res, state } = fakeRes();
    handler(err, fakeReq(), res, (() => undefined) as NextFunction);
    return { state, logs: lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
  };

  it('responds with the envelope and logs server errors without leaking details', () => {
    const { state, logs } = run(new Error('secret stack info'));
    expect(state.status).toBe(500);
    expect(state.body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Please retry.', requestId: 'req-abc12345' },
    });
    expect(JSON.stringify(state.body)).not.toContain('secret');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ severity: 'ERROR', code: 'INTERNAL', requestId: 'req-abc12345', error: 'secret stack info' });
  });

  it('logs "unknown" for non-Error throwables', () => {
    expect(run('oops').logs[0]?.error).toBe('unknown');
  });

  it('does not log client errors', () => {
    const { state, logs } = run(new AppError('VALIDATION_ERROR', undefined, ['text: required']));
    expect(state.status).toBe(400);
    expect(state.body).toMatchObject({ error: { details: ['text: required'] } });
    expect(logs).toHaveLength(0);
  });
});

describe('notFound', () => {
  it('responds 404 with the envelope', () => {
    const { res, state } = fakeRes();
    notFound(fakeReq(), res);
    expect(state.status).toBe(404);
    expect(state.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'req-abc12345' } });
  });
});

describe('requestId middleware', () => {
  const run = (incoming?: string) => {
    const req = fakeReq(incoming === undefined ? {} : { 'x-request-id': incoming }, '');
    const { res, state } = fakeRes();
    let called = false;
    requestId(req, res, () => {
      called = true;
    });
    return { id: req.requestId, header: state.headers['x-request-id'], called };
  };

  it('reuses a well-formed incoming id and echoes it', () => {
    expect(run('client-trace-0001')).toEqual({ id: 'client-trace-0001', header: 'client-trace-0001', called: true });
  });

  it.each([undefined, 'short', 'has spaces in it', '<script>alert(1)</script>', 'x'.repeat(65)])(
    'generates a UUID for missing or unsafe id %j',
    (incoming) => {
      const { id, header, called } = run(incoming);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(header).toBe(id);
      expect(called).toBe(true);
    },
  );
});

describe('toAppError with non-object values', () => {
  it('maps null and undefined to INTERNAL instead of throwing', () => {
    expect(toAppError(null).code).toBe('INTERNAL');
    expect(toAppError(undefined).code).toBe('INTERNAL');
  });
});
