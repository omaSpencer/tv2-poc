import { existsSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_SEARCH_INDEX_UID, SEARCH_INDEX_UID_PATTERN } from './contracts/search.js';

const flag = z.enum(['off', 'on']).default('off');
// Compose represents an omitted optional mapping as an empty string. Treat it
// as absent so disabled integrations can share one production overlay; an
// enabled integration is still rejected by REQUIRED_KEYS below.
const optional = z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional());
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(0).max(65535),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
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
  // BE-F1 S1 – public edge rate limit. On by default: a public route that can
  // be hammered for free is the problem, not the limiter. The window is a
  // fixed per-process window; see src/rate-limit.ts for the proxy assumption.
  RATE_LIMIT_PUBLIC: z.enum(['off', 'on']).default('on'),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().max(1_000_000).default(120),
  RATE_LIMIT_PUBLIC_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),
  // Number of reverse proxies whose X-Forwarded-For entries may be trusted.
  // 0 means the header is ignored entirely and the transport peer is counted.
  RATE_LIMIT_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),
  FEATURE_IDENTITY: flag,
  FEATURE_OUTBOX_RELAY: flag,
  FEATURE_SEARCH: flag,
  FEATURE_MEDIA: flag,
  OIDC_ISSUER_URL: optional,
  OIDC_AUDIENCE: optional,
  OIDC_JWKS_URI: optional,
  OIDC_CLOCK_TOLERANCE_S: z.coerce.number().int().min(0).max(30).default(30),
  OIDC_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
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
  MEILI_INDEX_UID: z.string().regex(SEARCH_INDEX_UID_PATTERN).default(DEFAULT_SEARCH_INDEX_UID),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(1000),
  MEILI_TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MEILI_TASK_POLL_MS: z.coerce.number().int().positive().default(100),
  SEARCH_CONSUMER_WORKING_MS: z.coerce.number().int().positive().max(10_000).default(10_000),
  REINDEX_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(500),
  REINDEX_DRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  REINDEX_IMPORT_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  REINDEX_OWNER_HEARTBEAT_MS: z.coerce.number().int().positive().default(5000),
  REINDEX_WORKER_STALE_MS: z.coerce.number().int().positive().default(15_000),
  REINDEX_VERIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  CONTENT_WRITE_BARRIER_WAIT_MS: z.coerce.number().int().positive().default(5000),
  ANTMEDIA_BASE_URL: optional,
  ANTMEDIA_TOKEN: optional,
});

/**
 * Keys that must parse as an absolute http(s) URL once their feature is on.
 * Validated locally at startup so a typo fails with a named configuration key
 * instead of surfacing later as an IdP outage on the first token (R11). Plain
 * `http` stays allowed on purpose: the PoC runs Authentik over http on a local
 * host name.
 */
const URL_KEYS = {
  FEATURE_IDENTITY: ['OIDC_ISSUER_URL', 'OIDC_JWKS_URI'],
  FEATURE_SEARCH: ['MEILI_A_URL', 'MEILI_B_URL'],
} as const satisfies Partial<Record<string, readonly (keyof AppConfigShape)[]>>;

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return ALLOWED_URL_PROTOCOLS.has(url.protocol) && url.host.length > 0;
}

/** An enabled integration makes its own configuration keys mandatory. */
const REQUIRED_KEYS = {
  FEATURE_IDENTITY: ['OIDC_ISSUER_URL', 'OIDC_AUDIENCE'],
  FEATURE_OUTBOX_RELAY: ['NATS_URL'],
  FEATURE_SEARCH: ['MEILI_A_URL', 'MEILI_A_KEY', 'MEILI_B_URL', 'MEILI_B_KEY', 'NATS_URL'],
  FEATURE_MEDIA: ['ANTMEDIA_BASE_URL', 'ANTMEDIA_TOKEN'],
} as const satisfies Record<string, readonly (keyof AppConfigShape)[]>;

/**
 * Integrations whose verifying adapter exists. M2 adds FEATURE_IDENTITY, M3
 * FEATURE_OUTBOX_RELAY and M4 FEATURE_SEARCH. Everything else still fails
 * startup when enabled.
 */
export const IMPLEMENTED_ADAPTERS = [
  'FEATURE_IDENTITY',
  'FEATURE_OUTBOX_RELAY',
  'FEATURE_SEARCH',
] as const satisfies readonly (keyof typeof REQUIRED_KEYS)[];

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
  // Shape of the supplied URLs is a local, deterministic check; reaching the
  // IdP over the network stays lazy and is never done at startup.
  const malformedUrls = enabled.flatMap(key => {
    const keys: readonly (keyof AppConfigShape)[] = URL_KEYS[key as keyof typeof URL_KEYS] ?? [];
    return keys.filter(urlKey => {
      const value = config[urlKey];
      return typeof value === 'string' && !isAbsoluteHttpUrl(value);
    });
  });
  if (malformedUrls.length) throw new ConfigurationError([...new Set(malformedUrls.map(String))]);
  // Two index instances that resolve to the same endpoint cannot demonstrate an
  // A/B outage: the second search would hit the process that just failed. This
  // is a configuration error, not a degraded mode we accept silently.
  if (config.FEATURE_SEARCH === 'on' && sameEndpoint(config.MEILI_A_URL, config.MEILI_B_URL)) {
    throw new ConfigurationError(['MEILI_A_URL', 'MEILI_B_URL']);
  }
  if (config.REINDEX_WORKER_STALE_MS <= config.REINDEX_OWNER_HEARTBEAT_MS) {
    throw new ConfigurationError(['REINDEX_WORKER_STALE_MS']);
  }
  if (config.REINDEX_VERIFY_TIMEOUT_MS < config.CONTENT_WRITE_BARRIER_WAIT_MS) {
    throw new ConfigurationError(['REINDEX_VERIFY_TIMEOUT_MS']);
  }
  // Features without a verifying adapter still refuse to start.
  const unimplemented = enabled.filter(key => !(IMPLEMENTED_ADAPTERS as readonly string[]).includes(key));
  if (unimplemented.length) throw new ConfigurationError([...unimplemented]);
  return config;
}

/**
 * Same host, port and base path means one Meilisearch process. Compared through
 * `URL` so a trailing slash or an upper-case host is not read as a difference.
 */
function sameEndpoint(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  try {
    const a = new URL(left);
    const b = new URL(right);
    const path = (url: URL) => url.pathname.replace(/\/+$/, '');
    return a.protocol === b.protocol && a.host.toLowerCase() === b.host.toLowerCase() && path(a) === path(b);
  } catch {
    return false;
  }
}

/** Names of integrations that are currently off, for the startup diagnostic. */
export function disabledIntegrationNames(config: Pick<AppConfig, (typeof INTEGRATIONS)[number]>): string[] {
  return INTEGRATIONS
    .filter(key => config[key] !== 'on')
    .map(key => INTEGRATION_DIAGNOSTIC_NAMES[key]);
}
