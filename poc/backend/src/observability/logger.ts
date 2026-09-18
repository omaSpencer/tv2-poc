import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export const APP_LOGGER = 'APP_LOGGER';
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'accesstoken',
  'idtoken',
  'refreshtoken',
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'apikey',
  'dsn',
  'databaseurl',
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function redactString(value: string): string {
  return value
    .replaceAll(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replaceAll(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`);
}

/**
 * Recursively sanitise structured log input before Pino serializers run.
 * Unknown nesting is covered deliberately; redaction is not tied to a fixed
 * request or error shape.
 */
export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map(item => redactLogValue(item, seen));

  const source = value instanceof Error
    ? {
        type: value.name,
        message: value.message,
        stack: value.stack,
        ...Object.fromEntries(Object.entries(value)),
      }
    : value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(source)) {
    result[key] = SENSITIVE_KEYS.has(normalizedKey(key))
      ? REDACTED
      : redactLogValue(nested, seen);
  }
  return result;
}

export function createAppLogger(
  level: string,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level,
    hooks: {
      logMethod(inputArgs, method) {
        const sanitized = inputArgs.map(value => redactLogValue(value)) as [
          value: unknown,
          message?: string,
          ...args: unknown[],
        ];
        method.apply(this, sanitized);
      },
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export function componentLogger(root: Logger, component: string): Logger {
  return root.child({ component });
}

@Injectable()
export class AppLogger {
  constructor(@Inject(APP_LOGGER) readonly root: Logger) {}

  child(component: string): Logger {
    return componentLogger(this.root, component);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_LOGGER,
      useFactory: (config: ConfigService) => createAppLogger(config.get<string>('LOG_LEVEL') ?? 'info'),
      inject: [ConfigService],
    },
    AppLogger,
  ],
  exports: [APP_LOGGER, AppLogger],
})
export class ObservabilityModule {}
