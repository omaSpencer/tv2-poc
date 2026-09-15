import { existsSync } from 'node:fs';
import { z } from 'zod';

const flag = z.enum(['off', 'on']).default('off');
const optional = z.string().min(1).optional();
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(0).max(65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  // Parsed defensively: a malformed value must surface as a configuration
  // error naming the key, never as a URL parser message echoing the value.
  DATABASE_URL: z.string().refine(value => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'postgres:' || protocol === 'postgresql:';
    } catch {
      return false;
    }
  }),
  FEATURE_IDENTITY: flag,
  FEATURE_OUTBOX_RELAY: flag,
  FEATURE_SEARCH: flag,
  FEATURE_MEDIA: flag,
  // Integration keys are optional here and made mandatory by the feature that
  // needs them. Their actual provider values land in M2–M4.
  OIDC_ISSUER_URL: optional,
  OIDC_AUDIENCE: optional,
  OIDC_JWKS_URI: optional,
  NATS_URL: optional,
  NATS_STREAM: optional,
  NATS_SUBJECT: optional,
  NATS_PUBLISH_ACK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  NATS_RELAY_BATCH: z.coerce.number().int().positive().default(100),
  NATS_RELAY_POLL_MS: z.coerce.number().int().positive().default(1000),
  MEILI_A_URL: optional,
  MEILI_A_KEY: optional,
  MEILI_B_URL: optional,
  MEILI_B_KEY: optional,
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  ANTMEDIA_BASE_URL: optional,
  ANTMEDIA_TOKEN: optional,
});

/** An enabled integration makes its own configuration keys mandatory. */
const REQUIRED_KEYS = {
  FEATURE_IDENTITY: ['OIDC_ISSUER_URL', 'OIDC_AUDIENCE'],
  FEATURE_OUTBOX_RELAY: ['NATS_URL'],
  FEATURE_SEARCH: ['MEILI_A_URL', 'MEILI_A_KEY', 'MEILI_B_URL', 'MEILI_B_KEY'],
  FEATURE_MEDIA: ['ANTMEDIA_BASE_URL', 'ANTMEDIA_TOKEN'],
} as const satisfies Record<string, readonly (keyof AppConfigShape)[]>;

/**
 * Integrations whose verifying adapter exists. M2 adds FEATURE_IDENTITY; M3
 * adds FEATURE_OUTBOX_RELAY. Everything else still fails startup when enabled.
 */
export const IMPLEMENTED_ADAPTERS = ['FEATURE_OUTBOX_RELAY'] as const satisfies readonly (keyof typeof REQUIRED_KEYS)[];

export const INTEGRATIONS = Object.keys(REQUIRED_KEYS) as (keyof typeof REQUIRED_KEYS)[];

/** Short names used in the startup `integrations_disabled` diagnostic. */
export const INTEGRATION_DIAGNOSTIC_NAMES = {
  FEATURE_IDENTITY: 'identity',
  FEATURE_OUTBOX_RELAY: 'outbox',
  FEATURE_SEARCH: 'search',
  FEATURE_MEDIA: 'media',
} as const satisfies Record<(typeof INTEGRATIONS)[number], string>;

type AppConfigShape = z.infer<typeof schema>;
export type AppConfig = AppConfigShape;

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

  const enabled = INTEGRATIONS.filter(key => config[key] === 'on');
  // An enabled integration must carry its keys before anything else is judged,
  // so a missing key is reported as that key and not as the feature flag.
  const missing = enabled.flatMap(key => REQUIRED_KEYS[key].filter(required => config[required] === undefined));
  if (missing.length) throw new ConfigurationError([...new Set(missing)]);
  // Features without a verifying adapter still refuse to start.
  const unimplemented = enabled.filter(key => !(IMPLEMENTED_ADAPTERS as readonly string[]).includes(key));
  if (unimplemented.length) throw new ConfigurationError([...unimplemented]);
  return config;
}

/** Names of integrations that are currently off, for the startup diagnostic. */
export function disabledIntegrationNames(config: Pick<AppConfig, (typeof INTEGRATIONS)[number]>): string[] {
  return INTEGRATIONS
    .filter(key => config[key] !== 'on')
    .map(key => INTEGRATION_DIAGNOSTIC_NAMES[key]);
}
