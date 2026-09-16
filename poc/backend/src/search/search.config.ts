/**
 * Resolved M4 search configuration.
 *
 * `validateConfig` has already proved the keys are present, well-shaped and
 * that A and B are different endpoints; this module only turns them into the
 * typed value the adapters and workers consume. Nothing here reads
 * `process.env` directly, so a test assembly can drive the whole search stack
 * through its own ConfigService.
 */
import type { ConfigService } from '@nestjs/config';
import {
  DEFAULT_SEARCH_INDEX_UID, SEARCH_INDEX_ALIASES, type SearchIndexAlias,
} from '../contracts/search.js';
import type { TopologyNames } from '../messaging/topology.js';

export type SearchInstanceConfig = {
  alias: SearchIndexAlias;
  url: string;
  /** Never logged, never put in an error message or a problem document. */
  apiKey: string;
  durable: string;
};

export type SearchConfig = {
  enabled: boolean;
  indexUid: string;
  searchTimeoutMs: number;
  taskTimeoutMs: number;
  taskPollMs: number;
  workingMs: number;
  instances: Record<SearchIndexAlias, SearchInstanceConfig>;
};

const KEYS = {
  a: { url: 'MEILI_A_URL', key: 'MEILI_A_KEY' },
  b: { url: 'MEILI_B_URL', key: 'MEILI_B_KEY' },
} as const satisfies Record<SearchIndexAlias, { url: string; key: string }>;

/**
 * The durable name for an alias comes from the topology, not from a second
 * hard-coded list: an isolated test topology prefixes its durables, and the
 * worker must consume the same consumer the stream actually has.
 */
function durableFor(alias: SearchIndexAlias, names: TopologyNames): string {
  const index = SEARCH_INDEX_ALIASES.indexOf(alias);
  const durable = names.durables[index];
  if (durable === undefined) {
    throw new Error(`The topology has no durable consumer for search index ${alias}.`);
  }
  return durable;
}

export function resolveSearchConfig(config: ConfigService, names: TopologyNames): SearchConfig {
  const enabled = config.get<string>('FEATURE_SEARCH') === 'on';
  const instance = (alias: SearchIndexAlias): SearchInstanceConfig => ({
    alias,
    url: enabled ? config.getOrThrow<string>(KEYS[alias].url) : '',
    apiKey: enabled ? config.getOrThrow<string>(KEYS[alias].key) : '',
    durable: durableFor(alias, names),
  });
  return {
    enabled,
    indexUid: config.get<string>('MEILI_INDEX_UID') ?? DEFAULT_SEARCH_INDEX_UID,
    searchTimeoutMs: Number(config.get('SEARCH_TIMEOUT_MS') ?? 1000),
    taskTimeoutMs: Number(config.get('MEILI_TASK_TIMEOUT_MS') ?? 30_000),
    taskPollMs: Number(config.get('MEILI_TASK_POLL_MS') ?? 100),
    workingMs: Number(config.get('SEARCH_CONSUMER_WORKING_MS') ?? 10_000),
    instances: { a: instance('a'), b: instance('b') },
  };
}
