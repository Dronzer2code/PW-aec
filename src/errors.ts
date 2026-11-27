/** Stable, machine-readable error codes returned in the API error envelope. */
export const ErrorCode = {
  VALIDATION_ERROR: { status: 400, message: 'The request is invalid.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The request is too large.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please wait a minute and try again.' },
  AI_UNAVAILABLE: { status: 503, message: 'The AI service is not configured or unavailable.' },
  AI_TIMEOUT: { status: 504, message: 'The AI service took too long to respond. Please retry.' },
  AI_BAD_OUTPUT: { status: 502, message: 'The AI service returned an unusable answer. Please retry.' },
  NOT_FOUND: { status: 404, message: 'Not found.' },
  INTERNAL: { status: 500, message: 'Something went wrong. Please retry.' },
} as const;

export type ErrorCodeName = keyof typeof ErrorCode;

/** Application error carrying an HTTP status and a safe, user-facing message. */
export class AppError extends Error {
  readonly code: ErrorCodeName;
  readonly status: number;
  readonly details: readonly string[];

  constructor(code: ErrorCodeName, message?: string, details: readonly string[] = []) {
    super(message ?? ErrorCode[code].message);
    this.name = 'AppError';
    this.code = code;
    this.status = ErrorCode[code].status;
    this.details = details;
  }
}

/** Envelope shape for every API error response. */
export interface ErrorEnvelope {
  error: { code: ErrorCodeName; message: string; requestId: string; details?: readonly string[] };
}

export function toEnvelope(err: AppError, requestId: string): ErrorEnvelope {
  return {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details.length > 0 ? { details: err.details } : {}),
    },
  };
}
