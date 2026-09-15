import { existsSync } from 'node:fs';
import { z } from 'zod';

const flag = z.enum(['off', 'on']).default('off');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(0).max(65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  DATABASE_URL: z.string().url().refine(value => {
    const protocol = new URL(value).protocol;
    return protocol === 'postgres:' || protocol === 'postgresql:';
  }),
  FEATURE_IDENTITY: flag,
  FEATURE_OUTBOX_RELAY: flag,
  FEATURE_SEARCH: flag,
  FEATURE_MEDIA: flag,
});
export type AppConfig = z.infer<typeof schema>;

export class ConfigurationError extends Error {
  constructor(readonly keys: string[]) {
    super(`Invalid configuration: ${keys.join(', ')}`);
  }
}

export function environmentFile(env: NodeJS.ProcessEnv): string {
  const file = env.ENV_FILE ?? '.env';
  if (env.ENV_FILE !== undefined && (!file || !existsSync(file))) {
    throw new ConfigurationError(['ENV_FILE']);
  }
  return file;
}

export function validateConfig(input: Record<string, unknown>): AppConfig {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ConfigurationError([...new Set(result.error.issues.map(issue => String(issue.path[0])))]);
  }
  const config = result.data;
  if (config.PORT === 0 && config.NODE_ENV !== 'test') throw new ConfigurationError(['PORT']);
  // No feature can be enabled until its actual adapter exists. No auth bypass.
  const unavailable = ['FEATURE_IDENTITY', 'FEATURE_OUTBOX_RELAY', 'FEATURE_SEARCH', 'FEATURE_MEDIA'] as const;
  const enabled = unavailable.filter(key => config[key] === 'on');
  if (enabled.length) throw new ConfigurationError([...enabled]);
  return config;
}
