/**
 * Minimal structured logger. Emits one JSON object per line to stdout, which
 * Google Cloud Logging on Cloud Run parses automatically (the `severity` field
 * maps to log levels). Callers MUST NOT pass user Intake content as fields.
 */
export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export function createLogger(options: { sink?: LogSink; minSeverity?: Severity } = {}): Logger {
  const sink = options.sink ?? defaultSink;
  const order: Severity[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
  const min = order.indexOf(options.minSeverity ?? 'INFO');

  const write = (severity: Severity, message: string, fields: LogFields = {}): void => {
    if (order.indexOf(severity) < min) return;
    sink(JSON.stringify({ severity, message, time: new Date().toISOString(), ...fields }));
  };

  return {
    debug: (m, f) => write('DEBUG', m, f),
    info: (m, f) => write('INFO', m, f),
    warn: (m, f) => write('WARNING', m, f),
    error: (m, f) => write('ERROR', m, f),
  };
}

/** Logger that discards everything; used in tests. */
export const silentLogger: Logger = createLogger({ sink: () => undefined, minSeverity: 'ERROR' });
