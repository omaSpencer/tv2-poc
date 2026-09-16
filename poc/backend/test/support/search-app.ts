/**
 * Nest test assembly for M4 (M4-08).
 *
 * Like the M3 relay assembly, this lives only under `test/`: the shipped build
 * has no actor header, no worker hooks and no shortened retry ladder. Each app
 * gets an isolated stream, isolated durables and its own index UID on both
 * Meilisearch instances, and every dependency can be reached through a
 * controllable proxy so one instance can be taken away without touching the
 * other.
 */
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { pino } from 'pino';
import { ApiExceptionFilter, jsonBody, jsonBodyErrors, requestBoundary } from '../../src/http.js';
import type { Actor } from '../../src/identity/actor.js';
import { DatabaseModule } from '../../src/database.js';
import { ContentModule } from '../../src/content/content.module.js';
import { MessagingModule } from '../../src/messaging/messaging.module.js';
import { OpsModule } from '../../src/ops/ops.module.js';
import { SearchModule } from '../../src/search/search.module.js';
import { HealthController } from '../../src/health.js';
import { OutboxRelay } from '../../src/messaging/relay.js';
import { SearchRegistry } from '../../src/search/search.registry.js';
import { SearchState } from '../../src/search/worker.state.js';
import type { SearchIndexAlias } from '../../src/contracts/search.js';
import { SEARCH_WORKER_OPTIONS } from '../../src/search/search.registry.js';
import type { SearchWorkerOptions } from '../../src/search/projection.worker.js';
import { RelayTestConfigModule, setRelayTestConfig } from './relay-test-config.js';
import type { IsolatedTopology } from './nats.js';
import type { TestApp } from './test-app.js';

const silent = pino({ level: 'silent' });

export type SearchTestApp = TestApp & {
  registry: SearchRegistry;
  state: SearchState;
  relay: OutboxRelay;
  names: IsolatedTopology;
  indexUid: string;
  startWorkers: () => void;
  stopWorker: (alias: SearchIndexAlias, graceMs?: number) => Promise<void>;
  startWorker: (alias: SearchIndexAlias) => void;
};

export type SearchAppOptions = {
  databaseUrl: string;
  natsUrl: string;
  names: IsolatedTopology;
  indexUid: string;
  meiliA: { url: string; key: string };
  meiliB: { url: string; key: string };
  defaultActor?: Actor | null;
  featureSearch?: boolean;
  relayEnabled?: boolean;
  deferStart?: boolean;
  /** Shortened so a retry ladder can be observed inside a test timeout. */
  retryDelaysMs?: readonly number[];
  workingMs?: number;
  searchTimeoutMs?: number;
  taskTimeoutMs?: number;
  taskPollMs?: number;
  pollMs?: number;
  logLevel?: string;
};

/**
 * Global so `SearchRegistry`'s optional `SEARCH_WORKER_OPTIONS` injection
 * resolves to it: the shipped `SearchModule` declares no such provider, so the
 * production build always falls back to the D08 ladder.
 */
let workerOptions: SearchWorkerOptions = {};

@Global()
@Module({
  providers: [{ provide: SEARCH_WORKER_OPTIONS, useFactory: () => workerOptions }],
  exports: [SEARCH_WORKER_OPTIONS],
})
class SearchTestOptionsModule {}

@Module({
  imports: [
    RelayTestConfigModule, SearchTestOptionsModule, DatabaseModule,
    ContentModule, MessagingModule, SearchModule, OpsModule,
  ],
  controllers: [HealthController],
})
class SearchAppModule {}

export async function createSearchTestApp(options: SearchAppOptions): Promise<SearchTestApp> {
  const searchOn = options.featureSearch !== false;
  const relayOn = options.relayEnabled === true;

  setRelayTestConfig({
    NODE_ENV: 'test',
    PORT: 0,
    LOG_LEVEL: options.logLevel ?? 'silent',
    DATABASE_URL: options.databaseUrl,
    FEATURE_IDENTITY: 'off',
    FEATURE_OUTBOX_RELAY: relayOn ? 'on' : 'off',
    FEATURE_SEARCH: searchOn ? 'on' : 'off',
    FEATURE_MEDIA: 'off',
    NATS_URL: options.natsUrl,
    NATS_STREAM: options.names.stream,
    NATS_SUBJECT: options.names.subject,
    NATS_RELAY_POLL_MS: options.pollMs ?? 50,
    NATS_RELAY_BATCH: 100,
    NATS_PUBLISH_ACK_TIMEOUT_MS: 2000,
    MEILI_A_URL: options.meiliA.url,
    MEILI_A_KEY: options.meiliA.key,
    MEILI_B_URL: options.meiliB.url,
    MEILI_B_KEY: options.meiliB.key,
    MEILI_INDEX_UID: options.indexUid,
    SEARCH_TIMEOUT_MS: options.searchTimeoutMs ?? 1000,
    MEILI_TASK_TIMEOUT_MS: options.taskTimeoutMs ?? 30_000,
    MEILI_TASK_POLL_MS: options.taskPollMs ?? 50,
    SEARCH_CONSUMER_WORKING_MS: options.workingMs ?? 10_000,
  });

  workerOptions = {
    workingMs: options.workingMs ?? 10_000,
    logLevel: options.logLevel ?? 'silent',
    ...(options.retryDelaysMs ? { retryDelaysMs: options.retryDelaysMs } : {}),
  };

  const previousRelayAuto = process.env.RELAY_AUTO_START;
  const previousSearchAuto = process.env.SEARCH_AUTO_START;
  process.env.RELAY_AUTO_START = 'off';
  process.env.SEARCH_AUTO_START = 'off';
  process.env.FEATURE_OUTBOX_RELAY = relayOn ? 'on' : 'off';

  const app: INestApplication = await NestFactory.create(SearchAppModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  app.use(requestBoundary(silent, { blockAdmin: false }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.headers['x-test-actor'];
    if (typeof header === 'string' && header.length > 0) {
      res.locals.actor = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Actor;
    } else if (header === undefined && options.defaultActor) {
      res.locals.actor = options.defaultActor;
    }
    next();
  });
  app.use(jsonBody());
  app.use(jsonBodyErrors());
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');

  const registry = app.get(SearchRegistry);
  const state = app.get(SearchState);
  const relay = app.get(OutboxRelay);

  if (relayOn) relay.start();
  if (searchOn && options.deferStart !== true) registry.startAll();

  const url = await app.getUrl();
  return {
    url,
    registry,
    state,
    relay,
    names: options.names,
    indexUid: options.indexUid,
    startWorkers: () => registry.startAll(),
    startWorker: alias => registry.worker(alias).start(),
    stopWorker: (alias, graceMs = 3000) => registry.worker(alias).stop(graceMs),
    close: async () => {
      await registry.stopAll(3000).catch(() => undefined);
      await relay.stop(2000).catch(() => undefined);
      await app.close().catch(() => undefined);
      if (previousRelayAuto === undefined) delete process.env.RELAY_AUTO_START;
      else process.env.RELAY_AUTO_START = previousRelayAuto;
      if (previousSearchAuto === undefined) delete process.env.SEARCH_AUTO_START;
      else process.env.SEARCH_AUTO_START = previousSearchAuto;
    },
    async request(method, path, requestOptions = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (requestOptions.actor !== undefined) {
        headers['x-test-actor'] = requestOptions.actor === null
          ? ''
          : Buffer.from(JSON.stringify(requestOptions.actor), 'utf8').toString('base64');
      }
      if (requestOptions.correlationId) headers['x-correlation-id'] = requestOptions.correlationId;
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(20_000) };
      if (requestOptions.body !== undefined) {
        init.body = typeof requestOptions.body === 'string'
          ? requestOptions.body
          : JSON.stringify(requestOptions.body);
      }
      const response = await fetch(url + path, init);
      const text = await response.text();
      let body: unknown = null;
      try { body = text.length > 0 ? JSON.parse(text) : null; } catch { body = text; }
      return { status: response.status, body, headers: response.headers };
    },
  };
}
