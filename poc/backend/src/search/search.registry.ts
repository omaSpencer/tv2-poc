/**
 * Owner of the two Meilisearch clients and the two projection workers (M4-04).
 *
 * The registry keeps A and B genuinely separate: two adapters built from two
 * endpoints with two keys, and two workers on two durables. It also owns the
 * search stack's *own* JetStream connection, distinct from the relay's, so
 * stopping the relay cannot take the workers down with it and a test can stop
 * one side without disturbing the other.
 */
import {
  Inject, Injectable, OnApplicationShutdown, OnModuleInit, Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SEARCH_INDEX_ALIASES, type SearchIndexAlias } from '../contracts/search.js';
import { NATS_STREAM, NATS_SUBJECT } from '../contracts/events.js';
import { DatabaseService } from '../database.js';
import { ContentRepository } from '../content/content.repository.js';
import { JetStreamAdapter } from '../messaging/jetstream.adapter.js';
import { topologyNames, type TopologyNames } from '../messaging/topology.js';
import { MeiliIndexAdapter } from './meili.adapter.js';
import { SearchProjectionWorker, type SearchWorkerOptions } from './projection.worker.js';
import { resolveSearchConfig, type SearchConfig } from './search.config.js';
import { SearchState } from './worker.state.js';
import { ReindexControlRepository } from './reindex/control.repository.js';
import type { Logger } from 'pino';
import { APP_LOGGER, componentLogger, createAppLogger } from '../observability/logger.js';

/** DI token for the search stack's own broker connection. */
export const SEARCH_BROKER = 'SEARCH_BROKER';
/** DI token for test-only worker options (shortened retry ladder, heartbeat). */
export const SEARCH_WORKER_OPTIONS = 'SEARCH_WORKER_OPTIONS';

@Injectable()
export class SearchRegistry implements OnModuleInit, OnApplicationShutdown {
  readonly config: SearchConfig;
  readonly names: TopologyNames;
  private readonly adapters = new Map<SearchIndexAlias, MeiliIndexAdapter>();
  private readonly workers = new Map<SearchIndexAlias, SearchProjectionWorker>();

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    @Inject(SearchState) private readonly state: SearchState,
    @Inject(SEARCH_BROKER) private readonly broker: JetStreamAdapter,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ContentRepository) private readonly repository: ContentRepository,
    @Inject(ReindexControlRepository) private readonly control: ReindexControlRepository,
    @Optional() @Inject(SEARCH_WORKER_OPTIONS) private readonly workerOptions: SearchWorkerOptions | null = null,
    @Optional() @Inject(APP_LOGGER) rootLogger: Logger | null = null,
  ) {
    this.names = topologyNames(
      configService.get<string>('NATS_STREAM') ?? NATS_STREAM,
      configService.get<string>('NATS_SUBJECT') ?? NATS_SUBJECT,
    );
    this.config = resolveSearchConfig(configService, this.names);
    this.state.enabled = this.config.enabled;

    if (!this.config.enabled) return;
    const logLevel = configService.get<string>('LOG_LEVEL') ?? 'info';
    const logger = componentLogger(rootLogger ?? createAppLogger(logLevel), 'search-registry');
    for (const alias of SEARCH_INDEX_ALIASES) {
      const instance = this.config.instances[alias];
      const adapter = new MeiliIndexAdapter(instance, {
        indexUid: this.config.indexUid,
        searchTimeoutMs: this.config.searchTimeoutMs,
        taskTimeoutMs: this.config.taskTimeoutMs,
        taskPollMs: this.config.taskPollMs,
      });
      this.adapters.set(alias, adapter);
      this.state.get(alias).durable = instance.durable;
      this.workers.set(alias, new SearchProjectionWorker(
        alias,
        instance.durable,
        adapter,
        this.state.get(alias),
        this.broker,
        this.names,
        this.database,
        this.repository,
        { workingMs: this.config.workingMs, logLevel, ...this.workerOptions, logger },
        this.control,
      ));
    }
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  adapter(alias: SearchIndexAlias): MeiliIndexAdapter {
    const adapter = this.adapters.get(alias);
    if (!adapter) throw new Error(`Search index ${alias} is not configured.`);
    return adapter;
  }

  worker(alias: SearchIndexAlias): SearchProjectionWorker {
    const worker = this.workers.get(alias);
    if (!worker) throw new Error(`Search worker ${alias} is not configured.`);
    return worker;
  }

  onModuleInit(): void {
    if (!this.config.enabled) return;
    // Tests set SEARCH_AUTO_START=off so hooks can be installed before the
    // first message is pulled.
    if (process.env.SEARCH_AUTO_START === 'off') return;
    this.startAll();
  }

  startAll(): void {
    for (const alias of SEARCH_INDEX_ALIASES) this.workers.get(alias)?.start();
  }

  /** Both workers stop within one shared grace period, then the connection closes. */
  async stopAll(graceMs = 5000): Promise<void> {
    await Promise.all([...this.workers.values()].map(worker => worker.stop(graceMs).catch(() => undefined)));
    await this.broker.close().catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stopAll();
  }

  /** Best-effort reachability for processing-status; never throws. */
  async probeReachability(): Promise<void> {
    if (!this.config.enabled) return;
    await Promise.all(SEARCH_INDEX_ALIASES.map(async alias => {
      const adapter = this.adapters.get(alias);
      if (!adapter) return;
      this.state.get(alias).setReachable(await adapter.reachable());
    }));
  }
}
