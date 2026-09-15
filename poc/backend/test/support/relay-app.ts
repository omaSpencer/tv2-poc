/**
 * Nest test assembly with the outbox relay enabled against an isolated stream.
 */
import { Module } from '@nestjs/common';
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
import { HealthController } from '../../src/health.js';
import { OutboxRelay, type RelayTestHooks } from '../../src/messaging/relay.js';
import { JetStreamAdapter } from '../../src/messaging/jetstream.adapter.js';
import type { TopologyLimits } from '../../src/messaging/topology.js';
import { RelayTestConfigModule, setRelayTestConfig } from './relay-test-config.js';
import type { IsolatedTopology } from './nats.js';
import type { TestApp } from './test-app.js';

const silent = pino({ level: 'silent' });

export type RelayTestApp = TestApp & {
  relay: OutboxRelay;
  broker: JetStreamAdapter;
  names: IsolatedTopology;
};

export type RelayAppOptions = {
  natsUrl: string;
  names: IsolatedTopology;
  databaseUrl: string;
  defaultActor?: Actor | null;
  hooks?: RelayTestHooks;
  limits?: TopologyLimits;
  pollMs?: number;
  batch?: number;
  ackTimeoutMs?: number;
  relayEnabled?: boolean;
  deferStart?: boolean;
};

@Module({
  imports: [RelayTestConfigModule, DatabaseModule, ContentModule, MessagingModule, OpsModule],
  controllers: [HealthController],
})
class RelayAppModule {}

export async function createRelayTestApp(options: RelayAppOptions): Promise<RelayTestApp> {
  const relayOn = options.relayEnabled !== false;
  setRelayTestConfig({
    NODE_ENV: 'test',
    PORT: 0,
    LOG_LEVEL: options.hooks ? 'info' : 'silent',
    DATABASE_URL: options.databaseUrl,
    FEATURE_IDENTITY: 'off',
    FEATURE_OUTBOX_RELAY: relayOn ? 'on' : 'off',
    FEATURE_SEARCH: 'off',
    FEATURE_MEDIA: 'off',
    NATS_URL: options.natsUrl,
    NATS_STREAM: options.names.stream,
    NATS_SUBJECT: options.names.subject,
    NATS_RELAY_POLL_MS: options.pollMs ?? 50,
    NATS_RELAY_BATCH: options.batch ?? 100,
    NATS_PUBLISH_ACK_TIMEOUT_MS: options.ackTimeoutMs ?? 2000,
  });

  const previousAuto = process.env.RELAY_AUTO_START;
  process.env.RELAY_AUTO_START = 'off';
  process.env.FEATURE_OUTBOX_RELAY = relayOn ? 'on' : 'off';

  const app: INestApplication = await NestFactory.create(RelayAppModule, {
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

  const relay = app.get(OutboxRelay);
  const broker = app.get(JetStreamAdapter);
  if (options.hooks) relay.setHooks(options.hooks);
  if (options.limits) broker.setTopologyLimits(options.limits);
  if (relayOn && options.deferStart !== true) relay.start();

  const url = await app.getUrl();
  return {
    url,
    relay,
    broker,
    names: options.names,
    close: async () => {
      await relay.stop(2000).catch(() => undefined);
      await app.close().catch(() => undefined);
      if (previousAuto === undefined) delete process.env.RELAY_AUTO_START;
      else process.env.RELAY_AUTO_START = previousAuto;
    },
    async request(method, path, requestOptions = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (requestOptions.actor !== undefined) {
        headers['x-test-actor'] = requestOptions.actor === null
          ? ''
          : Buffer.from(JSON.stringify(requestOptions.actor), 'utf8').toString('base64');
      }
      if (requestOptions.correlationId) headers['x-correlation-id'] = requestOptions.correlationId;
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(8000) };
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
