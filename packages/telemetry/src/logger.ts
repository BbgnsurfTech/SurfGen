import { pino, type Logger, type DestinationStream } from 'pino';

export type { Logger };

export interface LoggerOptions {
  readonly service: string;
  readonly level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Test hook: capture output instead of stdout. */
  readonly destination?: DestinationStream;
}

/** Paths redacted from every log line — secrets must never reach log storage. */
const REDACT_PATHS = [
  'apiKey',
  '*.apiKey',
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger(options: LoggerOptions): Logger {
  const config = {
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service: options.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
