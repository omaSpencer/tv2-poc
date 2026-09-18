/**
 * M4-T01 – M4-T25: the two-index searchable catalogue.
 *
 * Everything here runs against a real PostgreSQL, a real JetStream broker and
 * two real, separately addressable Meilisearch instances. Failures are injected
 * at the network boundary (`test/support/proxy.ts`) rather than by stubbing a
 * client, so "A is down" means the worker and the read path genuinely cannot
 * reach A.
 *
 * Isolation: a fresh stream, fresh durables and a fresh index UID on both
 * instances per case; cleanup removes only those.
 */
import 'reflect-metadata';
import { processingStatusViewSchema } from '../../src/contracts/openapi.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type JetStreamManager } from '@nats-io/jetstream';
import { ConfigurationError, validateConfig } from '../../src/config.js';
import { destroyTopology, ensureTopology } from '../../src/messaging/topology.js';
import { envelopeFromRow, OutboxRepository } from '../../src/outbox/outbox.repository.js';
import { normalizeCreateCommand, normalizeVersionedCommand } from '../../src/contracts/http.js';
import { normalizeCatalogSearchQuery } from '../../src/contracts/search.js';
import {
  retryDelayMs, SEARCH_RETRY_DELAYS_MS, SEARCH_RETRY_JITTER,
} from '../../src/search/projection.worker.js';
import { projectionFor } from '../../src/search/projection.js';
import { buildQuarantine, quarantineMsgId, recoverEventId } from '../../src/search/quarantine.js';
import { DEMO_CONTENT } from '../fixtures/demo.js';
import { actor, context, createServices, testDatabaseUrl, truncateAll } from '../support/database.js';
import { hasNats, isolatedTopology, natsUrl, waitFor, type IsolatedTopology } from '../support/nats.js';
import {
  applySettings, documentCount, dropIndex, hasMeili, isolatedIndexUid, meiliEndpoints,
  readSettings, seedDocument, storedDocument,
} from '../support/meili.js';
import { createMeiliProxy, createTcpProxy, type MeiliProxy } from '../support/proxy.js';
import { createSearchTestApp, type SearchAppOptions, type SearchTestApp } from '../support/search-app.js';

const dbUrl = (() => { try { return testDatabaseUrl(); } catch { return null; } })();
const natsReady = hasNats();
const meiliReady = hasMeili();
const ready = Boolean(dbUrl) && natsReady && meiliReady;

const endpoints = meiliReady ? meiliEndpoints()! : { a: { url: '', key: '' }, b: { url: '', key: '' } };
const publisher = (correlationId: string) => context('publisher-1', correlationId, ['publisher']);

/** Short ladder so a retry sequence is observable inside a test timeout. */
const FAST_RETRIES = [120, 240, 480, 960, 1920, 3000] as const;

type Harness = {
  app: SearchTestApp;
  nc: NatsConnection;
  jsm: JetStreamManager;
  names: IsolatedTopology;
  indexUid: string;
  proxyA: MeiliProxy;
  proxyB: MeiliProxy;
  close: () => Promise<void>;
};

type HarnessOptions = Partial<SearchAppOptions> & { databaseUrl?: string };

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const names = isolatedTopology('M4');
  const indexUid = isolatedIndexUid(names.runId.toLowerCase());
  const nc = await connect({ servers: natsUrl(), name: `m4-test-${names.runId}` });
  const jsm = await jetstreamManager(nc);
  await ensureTopology(jsm, names);
  const proxyA = await createMeiliProxy(endpoints.a.url);
  const proxyB = await createMeiliProxy(endpoints.b.url);

  const app = await createSearchTestApp({
    databaseUrl: options.databaseUrl ?? dbUrl!,
    natsUrl: natsUrl(),
    names,
    indexUid,
    meiliA: { url: proxyA.url, key: endpoints.a.key },
    meiliB: { url: proxyB.url, key: endpoints.b.key },
    defaultActor: actor('publisher-1', ['publisher']),
    taskPollMs: 25,
    workingMs: 500,
    retryDelaysMs: FAST_RETRIES,
    ...options,
  });

  return {
    app, nc, jsm, names, indexUid, proxyA, proxyB,
    close: async () => {
      await app.close();
      await proxyA.close();
      await proxyB.close();
      await dropIndex(indexUid);
      await destroyTopology(jsm, names).catch(() => undefined);
      await nc.close().catch(() => undefined);
    },
  };
}

/** Both workers bootstrapped and waiting for messages. */
async function awaitIdle(app: SearchTestApp, aliases: ReadonlyArray<'a' | 'b'> = ['a', 'b']): Promise<void> {
  try {
    await waitFor(
      `search workers ${aliases.join('/')} idle`,
      async () => aliases.every(alias => app.state.get(alias).state === 'idle'),
      20_000,
      50,
    );
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; state=${JSON.stringify(app.state.snapshot())}`);
  }
}

/** Creates and publishes one content, returning the row and its outbox events. */
async function publishContent(overrides: Record<string, unknown> = {}) {
  const services = createServices(dbUrl!);
  const op = publisher(`corr-${randomUUID()}`);
  const draft = await services.service.create(
    normalizeCreateCommand({ ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags], ...overrides }),
    op,
  );
  const published = await services.service.publish(draft.id, normalizeVersionedCommand({ expectedVersion: 1 }), op);
  return { services, published, op };
}

/**
 * Hand-delivers pending outbox rows onto the isolated stream. Using the real
 * envelope from the real row keeps this faithful to what the M3 relay would
 * publish, while leaving the test in control of *when* each event arrives.
 */
async function deliverPending(nc: NatsConnection, names: IsolatedTopology): Promise<number> {
  const outbox = new OutboxRepository();
  const services = createServices(dbUrl!);
  const js = jetstream(nc);
  const rows = await outbox.pending(services.database.db, 100);
  for (const row of rows) {
    const envelope = envelopeFromRow(row);
    await js.publish(names.subject, Buffer.from(JSON.stringify(envelope), 'utf8'), { msgID: row.eventId });
    await outbox.markDelivered(services.database.db, row.eventId);
  }
  return rows.length;
}

async function publishRaw(nc: NatsConnection, names: IsolatedTopology, body: string, msgID: string): Promise<number> {
  const ack = await jetstream(nc).publish(names.subject, Buffer.from(body, 'utf8'), { msgID });
  return ack.seq;
}

const consumerPending = async (jsm: JetStreamManager, names: IsolatedTopology, durable: string) => {
  const info = await jsm.consumers.info(names.stream, durable);
  return { pending: info.num_pending, ackPending: info.num_ack_pending, delivered: info.delivered.stream_seq };
};

describe('M4-T01: search configuration is proved before listen', () => {
  const base = {
    NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://poc@127.0.0.1:5432/poc',
    FEATURE_IDENTITY: 'off', FEATURE_OUTBOX_RELAY: 'off', FEATURE_MEDIA: 'off',
  };
  const searchOn = (extra: Record<string, string>) => ({ ...base, NATS_URL: 'nats://127.0.0.1:4222', FEATURE_SEARCH: 'on', ...extra });

  it('names the missing key, not the feature flag', () => {
    try {
      validateConfig(searchOn({ MEILI_A_URL: 'http://127.0.0.1:7700', MEILI_A_KEY: 'k' }));
      throw new Error('expected a configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).keys).toEqual(expect.arrayContaining(['MEILI_B_URL', 'MEILI_B_KEY']));
    }
  });

  it('rejects a malformed URL by name without echoing its value', () => {
    const bad = 'not-a-url-with-a-secret';
    try {
      validateConfig(searchOn({
        MEILI_A_URL: bad, MEILI_A_KEY: 'k',
        MEILI_B_URL: 'http://127.0.0.1:7701', MEILI_B_KEY: 'k2',
      }));
      throw new Error('expected a configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).keys).toContain('MEILI_A_URL');
      expect((error as Error).message).not.toContain(bad);
    }
  });

  it('refuses two index instances that resolve to the same endpoint', () => {
    for (const [a, b] of [
      ['http://127.0.0.1:7700', 'http://127.0.0.1:7700'],
      ['http://127.0.0.1:7700/', 'http://127.0.0.1:7700'],
      ['http://127.0.0.1:7700', 'http://127.0.0.1:7700/'],
    ]) {
      try {
        validateConfig(searchOn({ MEILI_A_URL: a!, MEILI_A_KEY: 'k', MEILI_B_URL: b!, MEILI_B_KEY: 'k2' }));
        throw new Error(`expected a configuration error for ${a} / ${b}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).keys).toEqual(['MEILI_A_URL', 'MEILI_B_URL']);
      }
    }
  });

  it('accepts two distinct endpoints and applies the documented defaults', () => {
    const config = validateConfig(searchOn({
      MEILI_A_URL: 'http://127.0.0.1:7700', MEILI_A_KEY: 'k',
      MEILI_B_URL: 'http://127.0.0.1:7701', MEILI_B_KEY: 'k2',
    }));
    expect(config.MEILI_INDEX_UID).toBe('contents');
    expect(config.SEARCH_TIMEOUT_MS).toBe(1000);
    expect(config.MEILI_TASK_TIMEOUT_MS).toBe(30_000);
    expect(config.MEILI_TASK_POLL_MS).toBe(100);
    expect(config.SEARCH_CONSUMER_WORKING_MS).toBe(10_000);
  });

  it('keeps an empty API key out of the accepted configuration', () => {
    try {
      validateConfig(searchOn({
        MEILI_A_URL: 'http://127.0.0.1:7700', MEILI_A_KEY: '',
        MEILI_B_URL: 'http://127.0.0.1:7701', MEILI_B_KEY: 'k2',
      }));
      throw new Error('expected a configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).keys).toContain('MEILI_A_KEY');
    }
  });
});

describe('M4: projection decisions are taken from the current row, not the event', () => {
  it('published becomes an upsert carrying the database version', () => {
    const row = {
      id: 'f8c1b4b6-1c6a-4c4e-9f2e-2f0b1d2c3a44', title: 'Cím', summary: 'Össze',
      category: 'film', tags: ['a'], status: 'published', version: 7,
    } as never;
    const decision = projectionFor('f8c1b4b6-1c6a-4c4e-9f2e-2f0b1d2c3a44', row);
    expect(decision).toEqual({
      operation: 'upsert',
      document: {
        id: 'f8c1b4b6-1c6a-4c4e-9f2e-2f0b1d2c3a44', title: 'Cím', summary: 'Össze',
        category: 'film', tags: ['a'], aggregateVersion: 7,
      },
    });
  });

  it('draft, withdrawn and missing all become a delete', () => {
    const id = 'f8c1b4b6-1c6a-4c4e-9f2e-2f0b1d2c3a44';
    for (const status of ['draft', 'withdrawn']) {
      expect(projectionFor(id, { id, status, title: 't' } as never)).toEqual({ operation: 'delete', id });
    }
    expect(projectionFor(id, undefined)).toEqual({ operation: 'delete', id });
  });

  it('a published row missing its publish minimum is rejected, not retried forever', () => {
    const id = 'f8c1b4b6-1c6a-4c4e-9f2e-2f0b1d2c3a44';
    const decision = projectionFor(id, {
      id, title: 'Cím', summary: null, category: null, tags: [], status: 'published', version: 2,
    } as never);
    expect(decision).toEqual({ operation: 'reject', id, fields: ['summary', 'category'] });
  });
});

describe('M4-T09 (ladder): the D08 backoff values and jitter', () => {
  it('follows 1, 2, 4, 8, 16, 30 s and then repeats the last step', () => {
    expect([...SEARCH_RETRY_DELAYS_MS]).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000]);
    for (const [attempt, base] of SEARCH_RETRY_DELAYS_MS.entries()) {
      expect(retryDelayMs(attempt, SEARCH_RETRY_DELAYS_MS, () => 0.5)).toBe(base);
    }
    expect(retryDelayMs(99, SEARCH_RETRY_DELAYS_MS, () => 0.5)).toBe(30_000);
  });

  it('stays inside ±20% at both extremes', () => {
    for (const [attempt, base] of SEARCH_RETRY_DELAYS_MS.entries()) {
      expect(retryDelayMs(attempt, SEARCH_RETRY_DELAYS_MS, () => 0)).toBe(Math.round(base * (1 - SEARCH_RETRY_JITTER)));
      expect(retryDelayMs(attempt, SEARCH_RETRY_DELAYS_MS, () => 1)).toBe(Math.round(base * (1 + SEARCH_RETRY_JITTER)));
      for (let i = 0; i < 50; i += 1) {
        const delay = retryDelayMs(attempt, SEARCH_RETRY_DELAYS_MS);
        expect(delay).toBeGreaterThanOrEqual(Math.round(base * 0.8));
        expect(delay).toBeLessThanOrEqual(Math.round(base * 1.2));
      }
    }
  });
});

describe('M4-T12 (envelope): the quarantine record is a locator, not a copy', () => {
  it('validates, carries the stream locator and holds no payload', () => {
    const envelope = buildQuarantine({
      errorCode: 'invalid_json',
      originalEventId: null,
      originalStream: 'CONTENT',
      originalStreamSequence: 42,
      originalSubject: 'poc.content.changed.v1',
      durable: 'search-a-v1',
    });
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.originalStreamSequence).toBe(42);
    const serialised = JSON.stringify(envelope);
    for (const secret of ['payload', 'apiKey', 'postgresql://', 'Bearer']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('derives a msgID that is stable per durable and sequence', () => {
    expect(quarantineMsgId('search-a-v1', 7)).toBe('quarantine.search-a-v1.7');
    expect(quarantineMsgId('search-a-v1', 7)).toBe(quarantineMsgId('search-a-v1', 7));
    expect(quarantineMsgId('search-b-v1', 7)).not.toBe(quarantineMsgId('search-a-v1', 7));
  });

  it('recovers an event id only when the raw message really carries one', () => {
    expect(recoverEventId({ eventId: 'b3dc0396-828c-4aad-af55-5b495e8fa04e' }))
      .toBe('b3dc0396-828c-4aad-af55-5b495e8fa04e');
    expect(recoverEventId({ eventId: 'not-a-uuid' })).toBeNull();
    expect(recoverEventId('a string')).toBeNull();
    expect(recoverEventId(null)).toBeNull();
  });
});

describe.skipIf(!ready)('M4: index bootstrap', () => {
  let h: Harness;
  beforeEach(async () => { await truncateAll(dbUrl!); });
  afterEach(async () => { await h?.close(); });

  it('M4-T02: provisions both empty indexes and repeats without a further settings task', async () => {
    h = await harness({ deferStart: true });
    h.app.startWorkers();
    await awaitIdle(h.app);

    for (const endpoint of [endpoints.a, endpoints.b]) {
      const settings = await readSettings(endpoint, h.indexUid);
      expect(settings.searchableAttributes).toEqual(['title', 'tags', 'summary']);
      expect(settings.filterableAttributes).toEqual(['category']);
      expect(settings.displayedAttributes).toEqual(['id']);
    }

    // Second bootstrap on an already provisioned index: create-or-verify only.
    const { bootstrapIndex } = await import('../../src/search/index-bootstrap.js');
    for (const alias of ['a', 'b'] as const) {
      const outcome = await bootstrapIndex(h.app.registry.adapter(alias));
      expect(outcome).toEqual({ created: false, settingsApplied: false, primaryKeyApplied: false });
    }
  });

  it('M4-T03: halts on an existing index with different settings and rewrites nothing', async () => {
    const names = isolatedTopology('M4');
    const indexUid = isolatedIndexUid(names.runId.toLowerCase());
    // A is provisioned by somebody else, with a different searchable order.
    await applySettings(endpoints.a, indexUid, {
      searchableAttributes: ['summary', 'title'],
      filterableAttributes: ['tags'],
      displayedAttributes: ['*'],
    });
    await seedDocument(endpoints.a, indexUid, { id: randomUUID(), title: 'Idegen', summary: 's' });
    const before = await readSettings(endpoints.a, indexUid);
    const beforeCount = await documentCount(endpoints.a, indexUid);

    const nc = await connect({ servers: natsUrl(), name: `m4-t03-${names.runId}` });
    const jsm = await jetstreamManager(nc);
    await ensureTopology(jsm, names);
    const proxyA = await createMeiliProxy(endpoints.a.url);
    const proxyB = await createMeiliProxy(endpoints.b.url);
    const app = await createSearchTestApp({
      databaseUrl: dbUrl!, natsUrl: natsUrl(), names, indexUid,
      meiliA: { url: proxyA.url, key: endpoints.a.key },
      meiliB: { url: proxyB.url, key: endpoints.b.key },
      taskPollMs: 25, retryDelaysMs: FAST_RETRIES,
    });
    h = {
      app, nc, jsm, names, indexUid, proxyA, proxyB,
      close: async () => {
        await app.close(); await proxyA.close(); await proxyB.close();
        await dropIndex(indexUid);
        await destroyTopology(jsm, names).catch(() => undefined);
        await nc.close().catch(() => undefined);
      },
    };

    await waitFor('index a halted', async () => app.state.get('a').state === 'halted', 20_000, 50);
    expect(app.state.get('a').lastErrorCode).toBe('config_mismatch');
    // B is unaffected and provisions itself normally.
    await awaitIdle(app, ['b']);

    expect(await readSettings(endpoints.a, indexUid)).toEqual(before);
    expect(await documentCount(endpoints.a, indexUid)).toBe(beforeCount);
  });
});

describe.skipIf(!ready)('M4: projection through both indexes', () => {
  let h: Harness;
  beforeEach(async () => { await truncateAll(dbUrl!); });
  afterEach(async () => { await h?.close(); });

  it('M4-T04: a publish event reaches both indexes with the current projection', async () => {
    h = await harness();
    await awaitIdle(h.app);
    const { published } = await publishContent({ title: 'Ékezetes Magyar Cím', summary: 'Rövid összefoglaló szöveg' });
    await deliverPending(h.nc, h.names);

    await waitFor('both indexes hold the document', async () => {
      const a = await storedDocument(endpoints.a, h.indexUid, published.id);
      const b = await storedDocument(endpoints.b, h.indexUid, published.id);
      return a !== null && b !== null;
    });

    for (const endpoint of [endpoints.a, endpoints.b]) {
      const document = await storedDocument(endpoint, h.indexUid, published.id);
      expect(document).toEqual({
        id: published.id,
        title: 'Ékezetes Magyar Cím',
        summary: 'Rövid összefoglaló szöveg',
        category: published.category,
        tags: published.tags,
        aggregateVersion: published.version,
      });
      // The projection is narrower than the aggregate on purpose.
      expect(document).not.toHaveProperty('slug');
      expect(document).not.toHaveProperty('mediaAssetId');
    }
  });

  it('M4-T05: a withdraw deletes from both, and no ACK precedes the delete task', async () => {
    h = await harness();
    await awaitIdle(h.app);
    const { services, published, op } = await publishContent();
    await deliverPending(h.nc, h.names);
    await waitFor('indexed', async () => (await storedDocument(endpoints.a, h.indexUid, published.id)) !== null);

    let ackPendingDuringSubmit = -1;
    h.app.registry.worker('a').setHooks({
      beforeSubmit: async () => {
        const info = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
        ackPendingDuringSubmit = info.ackPending;
      },
    });

    await services.service.withdraw(
      published.id,
      normalizeVersionedCommand({ expectedVersion: published.version }),
      op,
    );
    await deliverPending(h.nc, h.names);

    await waitFor('both indexes dropped the document', async () =>
      (await storedDocument(endpoints.a, h.indexUid, published.id)) === null
      && (await storedDocument(endpoints.b, h.indexUid, published.id)) === null);

    // While the delete task was being submitted the message was delivered and
    // still unacknowledged; afterwards the durable has nothing outstanding.
    expect(ackPendingDuringSubmit).toBe(1);
    await waitFor('durable drained', async () => {
      const info = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
      return info.pending === 0 && info.ackPending === 0;
    });
  });

  it('M4-T06: an old publish event replayed after a withdrawal converges on a delete', async () => {
    h = await harness();
    await awaitIdle(h.app);
    const { services, published, op } = await publishContent();
    const outbox = new OutboxRepository();
    const pendingRows = await outbox.pending(services.database.db, 10);
    const publishEnvelope = envelopeFromRow(pendingRows[0]!) as { eventId: string };
    await deliverPending(h.nc, h.names);
    await waitFor('indexed', async () => (await storedDocument(endpoints.a, h.indexUid, published.id)) !== null);

    await services.service.withdraw(
      published.id, normalizeVersionedCommand({ expectedVersion: published.version }), op,
    );
    await deliverPending(h.nc, h.names);
    await waitFor('removed', async () => (await storedDocument(endpoints.a, h.indexUid, published.id)) === null);

    // Replay the original publish event verbatim, with a fresh msgID so the
    // stream's dedup window does not swallow it.
    await publishRaw(h.nc, h.names, JSON.stringify(publishEnvelope), `replay-${publishEnvelope.eventId}`);

    await waitFor('replay consumed by both indexes', async () => {
      const progress = await Promise.all((['a', 'b'] as const).map(alias =>
        consumerPending(h.jsm, h.names, h.app.state.get(alias).durable)));
      return progress.every(info => info.pending === 0 && info.ackPending === 0);
    });
    // The current row is withdrawn, so the replay must not resurrect it.
    expect(await storedDocument(endpoints.a, h.indexUid, published.id)).toBeNull();
    expect(await storedDocument(endpoints.b, h.indexUid, published.id)).toBeNull();
  });

  it('M4-T07: a stop between task success and ACK redelivers and converges', async () => {
    h = await harness({ deferStart: true });
    h.app.startWorkers();
    await awaitIdle(h.app);
    const { published } = await publishContent();

    let stopped = false;
    h.app.registry.worker('a').setHooks({
      afterTaskSucceeded: async () => {
        if (stopped) return;
        stopped = true;
        // Interrupt exactly between the successful index write and the ACK.
        h.app.registry.worker('a').requestStop();
      },
    });

    await deliverPending(h.nc, h.names);
    await waitFor('worker a stopped short of the ACK', async () => stopped, 20_000, 25);
    await h.app.stopWorker('a');

    // The document is written but the message was never acknowledged.
    expect(await storedDocument(endpoints.a, h.indexUid, published.id)).not.toBeNull();
    const before = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
    expect(before.pending + before.ackPending).toBeGreaterThanOrEqual(1);

    h.app.registry.worker('a').setHooks({});
    h.app.startWorker('a');
    // Nothing was NAKed, so JetStream redelivers only once ack_wait (30 s)
    // expires. That delay is the contract, not a test artefact.
    await waitFor('redelivery acknowledged', async () => {
      const info = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
      return info.pending === 0 && info.ackPending === 0;
    }, 60_000, 250);
    // Idempotent: the end state is the same single document.
    expect(await storedDocument(endpoints.a, h.indexUid, published.id)).not.toBeNull();
    expect(await documentCount(endpoints.a, h.indexUid)).toBe(1);
  }, 120_000);
});

describe.skipIf(!ready)('M4: long tasks, retries and quarantine', () => {
  let h: Harness;
  beforeEach(async () => { await truncateAll(dbUrl!); });
  afterEach(async () => { await h?.close(); });

  it('M4-T08: a long task is kept alive with working() instead of redelivering', async () => {
    h = await harness({ workingMs: 2000, taskTimeoutMs: 120_000 });
    await awaitIdle(h.app);
    const { published } = await publishContent();

    const worker = h.app.registry.worker('a');
    const before = worker.workingSignals;
    let submittedTasks = 0;
    worker.setHooks({ beforeSubmit: () => { submittedTasks += 1; } });
    // The task really succeeds upstream; the proxy keeps reporting `processing`
    // for longer than ack_wait, which is exactly the situation working() exists
    // for. B is untouched and finishes normally.
    h.proxyA.holdTasks(true);
    await deliverPending(h.nc, h.names);

    await waitFor('worker a is processing', async () => h.app.state.get('a').state === 'processing', 15_000, 50);
    const heldFor = 34_000;
    const start = Date.now();
    while (Date.now() - start < heldFor) {
      const info = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
      // One message outstanding the whole time: no redelivery past ack_wait.
      expect(info.ackPending).toBe(1);
      expect(info.pending).toBe(0);
      expect(submittedTasks).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    expect(worker.workingSignals - before).toBeGreaterThanOrEqual(10);
    // No second index operation was started while the first was unfinished.
    expect(h.app.state.get('a').inFlightEventId).not.toBeNull();

    h.proxyA.holdTasks(false);
    await waitFor('a acknowledges after the task reports success', async () => {
      const info = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
      return info.ackPending === 0 && info.pending === 0;
    }, 20_000, 100);
    expect(await storedDocument(endpoints.a, h.indexUid, published.id)).not.toBeNull();
  }, 120_000);

  it('M4-T09: a transient Meilisearch failure retries on the ladder and never ACKs', async () => {
    // A flat ladder, so every observed gap has the same expected value and a
    // wake signal arriving mid-backoff is unambiguous evidence either way.
    const FLAT = [1200, 1200, 1200, 1200, 1200, 1200] as const;
    h = await harness({ workingMs: 500, retryDelaysMs: FLAT });
    await awaitIdle(h.app);
    await publishContent();

    const worker = h.app.registry.worker('a');
    const submits: number[] = [];
    worker.setHooks({ beforeSubmit: () => { submits.push(Date.now()); } });

    const retryGaps: number[] = [];
    for (const mode of ['status503', 'status429', 'down', 'hang'] as const) {
      h.proxyA.setMode(mode);
      await deliverPending(h.nc, h.names).catch(() => undefined);
      // Two submissions under the same mode, so one full backoff is observed
      // for every failure class rather than only the first transition.
      const seen = submits.length;
      await waitFor(`two failed attempts under ${mode}`, async () => submits.length >= seen + 2, 25_000, 25);
      // Both attempts belong to this same failing mode, before recovery.
      retryGaps.push(submits[seen + 1]! - submits[seen]!);
      // The snapshot is taken right after a resubmission, so the state is
      // either the new attempt or the backoff between attempts; what matters is
      // that a failure was recorded and nothing was acknowledged.
      expect(['retrying', 'processing']).toContain(h.app.state.get('a').state);
      expect(h.app.state.get('a').lastErrorCode).not.toBeNull();
      // Nothing acknowledged while the instance is failing.
      const info = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
      expect(info.pending + info.ackPending).toBeGreaterThanOrEqual(1);
      expect(h.app.state.get('a').lastAckedAt).toBeNull();
    }

    // R06 applied to M4: five new CMS events must not shorten the backoff the
    // worker is currently serving. 800 ms is comfortably inside 1200 ms ±20%.
    await waitFor('a is inside a backoff', async () => h.app.state.get('a').state === 'retrying', 20_000, 25);
    const beforeWake = submits.length;
    const wokeAt = Date.now();
    for (let i = 0; i < 5; i += 1) await publishContent();
    await deliverPending(h.nc, h.names).catch(() => undefined);
    while (Date.now() - wokeAt < 800) {
      expect(submits.length).toBe(beforeWake);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    h.proxyA.setMode('pass');
    await waitFor('a recovers and acknowledges everything', async () => {
      const info = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
      return info.pending === 0 && info.ackPending === 0;
    }, 90_000, 100);
    expect(h.app.state.get('a').lastAckedAt).not.toBeNull();

    // Measure retries within each outage, not gaps between unrelated messages
    // processed successfully after recovery.
    expect(retryGaps).toHaveLength(4);
    for (const gap of retryGaps) {
      expect(gap).toBeGreaterThanOrEqual(Math.round(1200 * 0.8));
      // Submit-to-submit time also includes SDK/network and scheduler latency.
      // Its upper bound is not the backoff bound; the exact timer is covered
      // with a controlled clock in m4-review.test.ts.
    }
  }, 180_000);

  it('M4-T10: B can be away while A keeps up, then catches up in its own order', async () => {
    h = await harness();
    await awaitIdle(h.app);

    h.proxyB.setMode('down');
    const { services, published, op } = await publishContent();
    await deliverPending(h.nc, h.names);
    await waitFor('a indexed the publish', async () =>
      (await storedDocument(endpoints.a, h.indexUid, published.id)) !== null, 30_000, 100);

    await services.service.withdraw(
      published.id, normalizeVersionedCommand({ expectedVersion: published.version }), op,
    );
    await deliverPending(h.nc, h.names);
    await waitFor('a applied the withdraw', async () =>
      (await storedDocument(endpoints.a, h.indexUid, published.id)) === null, 30_000, 100);

    // B's durable is behind while A has drained.
    const bBehind = await consumerPending(h.jsm, h.names, h.app.state.get('b').durable);
    expect(bBehind.pending + bBehind.ackPending).toBeGreaterThanOrEqual(1);

    h.proxyB.setMode('pass');
    await waitFor('b caught up', async () => {
      const info = await consumerPending(h.jsm, h.names, h.app.state.get('b').durable);
      return info.pending === 0 && info.ackPending === 0;
    }, 60_000, 200);
    // Same end state: B processed publish then withdraw, in its own order.
    expect(await storedDocument(endpoints.b, h.indexUid, published.id)).toBeNull();
    expect(await documentCount(endpoints.b, h.indexUid)).toBe(0);
  }, 120_000);

  it('M4-T12/T13: a poison message is quarantined, and a failing DLQ blocks the ACK', async () => {
    h = await harness();
    await awaitIdle(h.app);

    // T13 first: with the quarantine stream gone, the original must stay put.
    await h.jsm.streams.delete(h.names.quarantineStream);
    const badJsonSeq = await publishRaw(h.nc, h.names, '{ this is not json', `bad-json-${randomUUID()}`);
    await waitFor('worker a is retrying the quarantine publish', async () =>
      h.app.state.get('a').lastErrorCode === 'quarantine_publish_failed', 30_000, 50);
    const blocked = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
    expect(blocked.pending + blocked.ackPending).toBeGreaterThanOrEqual(1);
    expect(h.app.state.get('a').lastAckedAt).toBeNull();

    // Restore the DLQ: both durables quarantine the same message separately.
    await ensureTopology(h.jsm, h.names);
    const validEnvelope = {
      eventId: randomUUID(), schemaVersion: 1, eventType: 'content.published',
      aggregateId: randomUUID(), aggregateVersion: 0,
      occurredAt: new Date().toISOString(), correlationId: 'corr-bad-schema',
      payload: { status: 'published' },
    };
    const badSchemaSeq = await publishRaw(
      h.nc, h.names, JSON.stringify(validEnvelope), `bad-schema-${randomUUID()}`,
    );

    await waitFor('both durables drained the poison messages', async () => {
      const a = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
      const b = await consumerPending(h.jsm, h.names, h.app.state.get('b').durable);
      return a.pending === 0 && a.ackPending === 0 && b.pending === 0 && b.ackPending === 0;
    }, 60_000, 200);

    const quarantined = await readQuarantine(h.nc, h.names, 4);
    const codes = quarantined.map(entry => entry.errorCode).sort();
    expect(codes).toEqual(['invalid_event_schema', 'invalid_event_schema', 'invalid_json', 'invalid_json']);
    for (const entry of quarantined) {
      expect(entry.originalStream).toBe(h.names.stream);
      expect([badJsonSeq, badSchemaSeq]).toContain(entry.originalStreamSequence);
      expect(entry.originalSubject).toBe(h.names.subject);
      expect(h.names.durables).toContain(entry.durable);
    }
    // A and B record the same poisoned message separately, one per durable.
    const perDurable = new Set(quarantined.map(entry => `${entry.durable}:${entry.originalStreamSequence}`));
    expect(perDurable.size).toBe(4);
    // The schema failure recovered the original event id; the JSON failure could not.
    const schemaEntry = quarantined.find(entry => entry.errorCode === 'invalid_event_schema')!;
    expect(schemaEntry.originalEventId).toBe(validEnvelope.eventId);
    expect(quarantined.find(entry => entry.errorCode === 'invalid_json')!.originalEventId).toBeNull();
  }, 120_000);
});

/** Reads the isolated DLQ with a throwaway ephemeral consumer. */
async function readQuarantine(
  nc: NatsConnection,
  names: IsolatedTopology,
  count: number,
  timeoutMs = 10_000,
): Promise<Array<Record<string, any>>> {
  const js = jetstream(nc);
  const consumer = await js.consumers.get(names.quarantineStream);
  const found: Array<Record<string, any>> = [];
  const deadline = Date.now() + timeoutMs;
  while (found.length < count && Date.now() < deadline) {
    const msg = await consumer.next({ expires: 1000 });
    if (!msg) continue;
    found.push(JSON.parse(new TextDecoder().decode(msg.data)));
    msg.ack();
  }
  return found;
}

describe('M4-T14 (contract): the search query is normalised in one place', () => {
  it('applies the documented defaults', () => {
    expect(normalizeCatalogSearchQuery({ q: '  ősz  ' })).toEqual({
      q: 'ősz', category: null, limit: 20, offset: 0,
    });
  });

  it('names every offending parameter and rejects unknown and repeated ones', () => {
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{}, ['q']],
      [{ q: '   ' }, ['q']],
      [{ q: 'a'.repeat(201) }, ['q']],
      [{ q: 'ok', category: 'nincs-ilyen' }, ['category']],
      [{ q: 'ok', limit: '0' }, ['limit']],
      [{ q: 'ok', limit: '101' }, ['limit']],
      [{ q: 'ok', limit: '1e2' }, ['limit']],
      [{ q: 'ok', limit: '-1' }, ['limit']],
      [{ q: 'ok', offset: '1001' }, ['offset']],
      [{ q: 'ok', page: '2' }, ['page']],
      [{ q: ['a', 'b'] }, ['q']],
      [{ q: 'ok', category: ['film', 'sport'] }, ['category']],
      [{ q: 'a'.repeat(201), limit: '0', nope: '1' }, ['limit', 'nope', 'q']],
    ];
    for (const [input, fields] of cases) {
      try {
        normalizeCatalogSearchQuery(input);
        throw new Error(`expected 422 for ${JSON.stringify(input)}`);
      } catch (error) {
        expect((error as { code?: string }).code).toBe('validation_failed');
        expect((error as { extras: { fields: string[] } }).extras.fields).toEqual(fields);
      }
    }
  });

  it('accepts the documented boundary values', () => {
    expect(normalizeCatalogSearchQuery({ q: 'a', limit: '1', offset: '0' }).limit).toBe(1);
    expect(normalizeCatalogSearchQuery({ q: 'a'.repeat(200), limit: '100', offset: '1000' }))
      .toEqual({ q: 'a'.repeat(200), category: null, limit: 100, offset: 1000 });
  });
});

describe.skipIf(!ready)('M4: the public search route', () => {
  let h: Harness;
  beforeEach(async () => { await truncateAll(dbUrl!); });
  afterEach(async () => { await h?.close(); });

  /** Publishes one content and waits for both indexes to carry it. */
  async function indexOne(overrides: Record<string, unknown> = {}) {
    const result = await publishContent(overrides);
    await deliverPending(h.nc, h.names);
    await waitFor('both indexes hold the new document', async () =>
      (await storedDocument(endpoints.a, h.indexUid, result.published.id)) !== null
      && (await storedDocument(endpoints.b, h.indexUid, result.published.id)) !== null, 30_000, 100);
    // Direct document visibility can precede the worker's terminal task poll
    // and ACK. Wait for both workers before injecting a read-path failure, or
    // the synthetic 401/400 may halt a still-polling projection worker and make
    // the request route directly to B instead of exercising A's no-fallback rule.
    await awaitIdle(h.app);
    return result;
  }

  it('M4-T14: a rejected query is a 422 and never reaches Meilisearch', async () => {
    h = await harness();
    await awaitIdle(h.app);
    h.proxyA.resetCounters();
    h.proxyB.resetCounters();

    for (const query of ['', '?q=', '?q=' + 'a'.repeat(201), '?q=ok&limit=0', '?q=ok&page=2', '?q=a&q=b']) {
      const response = await h.app.request('GET', `/catalog/search${query}`);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('validation_failed');
      expect(Array.isArray(response.body.fields)).toBe(true);
    }
    expect(h.proxyA.searches).toBe(0);
    expect(h.proxyB.searches).toBe(0);
  });

  it('M4-T15: Hungarian title, accent-insensitive fragment, summary and tag all match', async () => {
    h = await harness();
    await awaitIdle(h.app);
    const { published } = await indexOne();

    const cases: Array<[string, string]> = [
      ['Őrségi', 'accented title fragment'],
      ['orsegi', 'the same fragment without accents'],
      ['Vadon', 'title word'],
      ['élővilágáról', 'summary word'],
      ['természetfilm', 'tag'],
    ];
    for (const [term, description] of cases) {
      const response = await h.app.request('GET', `/catalog/search?q=${encodeURIComponent(term)}`);
      expect(response.status, `${description}: ${term}`).toBe(200);
      expect(response.body.items.map((item: { id: string }) => item.id), description).toEqual([published.id]);
    }
    // The response carries public fields only, read from PostgreSQL.
    const item = (await h.app.request('GET', '/catalog/search?q=Vadon')).body.items[0];
    expect(Object.keys(item).sort())
      .toEqual(['category', 'id', 'publishedAt', 'slug', 'summary', 'tags', 'title']);
    expect(item).not.toHaveProperty('mediaAssetId');
    expect(item).not.toHaveProperty('aggregateVersion');
    expect(item).not.toHaveProperty('createdBy');
  });

  it('M4-T16: the category filter applies in the index and against the current row', async () => {
    h = await harness();
    await awaitIdle(h.app);
    const { published } = await indexOne();

    const match = await h.app.request('GET', '/catalog/search?q=Vadon&category=film');
    expect(match.status).toBe(200);
    expect(match.body.items.map((i: { id: string }) => i.id)).toEqual([published.id]);

    const other = await h.app.request('GET', '/catalog/search?q=Vadon&category=sport');
    expect(other.status).toBe(200);
    expect(other.body.items).toEqual([]);

    // The index still says `film`; the database is what decides.
    const services = createServices(dbUrl!);
    await services.database.db.execute(
      `update content set category = 'sport' where id = '${published.id}'` as never,
    );
    const stale = await h.app.request('GET', '/catalog/search?q=Vadon&category=film');
    expect(stale.status).toBe(200);
    expect(stale.body.items).toEqual([]);
  });

  it('M4-T17: an empty but successful A answer is not a reason to try B', async () => {
    h = await harness();
    await awaitIdle(h.app);
    await indexOne();
    h.proxyB.resetCounters();

    const response = await h.app.request('GET', '/catalog/search?q=teljesenmasvalami');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [], offset: 0, limit: 20, returned: 0, estimatedTotalHits: 0,
    });
    expect(h.proxyB.searches).toBe(0);
  });

  it('M4-T18: a transient A failure makes exactly one B attempt', async () => {
    h = await harness({ searchTimeoutMs: 600 });
    await awaitIdle(h.app);
    const { published } = await indexOne();

    for (const mode of ['down', 'hang', 'status429', 'status503', 'status500'] as const) {
      h.proxyA.setMode(mode);
      h.proxyB.resetCounters();
      const response = await h.app.request('GET', '/catalog/search?q=Vadon');
      expect(response.status, mode).toBe(200);
      expect(response.body.items.map((i: { id: string }) => i.id), mode).toEqual([published.id]);
      expect(h.proxyB.searches, `${mode}: exactly one B attempt`).toBe(1);
    }
    h.proxyA.setMode('pass');
  }, 120_000);

  it('M4-T11: with A away the B worker keeps indexing and serves the read path', async () => {
    h = await harness({ searchTimeoutMs: 600 });
    await awaitIdle(h.app);
    h.proxyA.setMode('down');

    const { published } = await publishContent();
    await deliverPending(h.nc, h.names);
    await waitFor('b indexed while a is away', async () =>
      (await storedDocument(endpoints.b, h.indexUid, published.id)) !== null, 30_000, 100);

    const response = await h.app.request('GET', '/catalog/search?q=Vadon');
    expect(response.status).toBe(200);
    expect(response.body.items.map((i: { id: string }) => i.id)).toEqual([published.id]);
    // A's own durable made no progress; nothing was acknowledged for it.
    const aInfo = await consumerPending(h.jsm, h.names, h.app.state.get('a').durable);
    expect(aInfo.pending + aInfo.ackPending).toBeGreaterThanOrEqual(1);
    h.proxyA.setMode('pass');
  }, 120_000);

  it('M4-T19: an auth or client error on A is never masked by a fallback', async () => {
    h = await harness({ searchTimeoutMs: 600 });
    await awaitIdle(h.app);
    await indexOne();

    for (const mode of ['status401', 'status400'] as const) {
      h.proxyA.setMode(mode);
      h.proxyB.resetCounters();
      const response = await h.app.request('GET', '/catalog/search?q=Vadon');
      expect(response.status, mode).toBe(503);
      expect(response.body.code, mode).toBe('search_unavailable');
      expect(h.proxyB.searches, `${mode}: no fallback`).toBe(0);
      // Nothing about the endpoint, key or raw error reaches the client.
      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain(endpoints.a.key);
      expect(serialised).not.toContain('127.0.0.1');
      expect(serialised).not.toContain(h.indexUid);
    }
    h.proxyA.setMode('pass');
  });

  it('M4-T20: with both instances gone search is 503 while writes and readiness continue', async () => {
    h = await harness({ searchTimeoutMs: 600 });
    await awaitIdle(h.app);
    h.proxyA.setMode('down');
    h.proxyB.setMode('down');

    const response = await h.app.request('GET', '/catalog/search?q=Vadon');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('search_unavailable');

    // The CMS write path and readiness depend on PostgreSQL, not on the index.
    const created = await h.app.request('POST', '/admin/contents', {
      body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
    });
    expect(created.status).toBe(201);
    const publishedResponse = await h.app.request('POST', `/admin/contents/${created.body.id}/publish`, {
      body: { expectedVersion: 1 },
    });
    expect(publishedResponse.status).toBe(200);
    expect((await h.app.request('GET', '/health/ready')).status).toBe(200);
    h.proxyA.setMode('pass');
    h.proxyB.setMode('pass');
  }, 120_000);

  it('M4-T21/T22: stale index hits are filtered out and the surviving order is stable', async () => {
    h = await harness({ searchTimeoutMs: 600 });
    await awaitIdle(h.app);
    const first = await indexOne();
    const second = await indexOne({ title: 'Vadon élő Alföld – tavaszi ébredés', summary: 'Vadon a pusztán.' });

    // Keep a real stale projection while both workers remain routable.
    const stale = await storedDocument(endpoints.b, h.indexUid, first.published.id);
    await first.services.service.withdraw(
      first.published.id,
      normalizeVersionedCommand({ expectedVersion: first.published.version }),
      first.op,
    );
    await deliverPending(h.nc, h.names);
    await waitFor('a dropped the withdrawn document', async () =>
      (await storedDocument(endpoints.a, h.indexUid, first.published.id)) === null, 30_000, 100);
    await waitFor('b dropped the withdrawn document', async () =>
      (await storedDocument(endpoints.b, h.indexUid, first.published.id)) === null, 30_000, 100);
    await seedDocument(endpoints.b, h.indexUid, stale!);

    // Serve the read from the stale instance on purpose.
    h.proxyA.setMode('down');
    const response = await h.app.request('GET', '/catalog/search?q=Vadon');
    h.proxyA.setMode('pass');

    expect(response.status).toBe(200);
    const ids = response.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(first.published.id);
    expect(ids).toEqual([second.published.id]);
    // The page is shorter than the index's own estimate; that is documented.
    expect(response.body.returned).toBe(1);
    expect(response.body.estimatedTotalHits).toBeGreaterThanOrEqual(2);

    // And the withdrawn content is a 404 on the public detail route.
    const detail = await h.app.request('GET', `/catalog/contents/${first.published.id}`);
    expect(detail.status).toBe(404);
    expect(detail.body.code).toBe('content_not_found');

    // An id that no longer exists in the database at all drops out too.
    const ghost = randomUUID();
    await seedDocument(endpoints.a, h.indexUid, {
      id: ghost, title: 'Vadon szellem', summary: 'Nincs sor mögötte.', category: 'film', tags: [],
    });
    const withGhost = await h.app.request('GET', '/catalog/search?q=Vadon');
    expect(withGhost.status).toBe(200);
    expect(withGhost.body.items.map((i: { id: string }) => i.id)).toEqual([second.published.id]);
  }, 120_000);

  it('M4-T23: a database outage after a successful index hit is 503, never a partial answer', async () => {
    const pgUrl = new URL(dbUrl!);
    const proxy = await createTcpProxy(pgUrl.hostname, Number(pgUrl.port || 5432));
    const proxied = new URL(dbUrl!);
    proxied.hostname = '127.0.0.1';
    proxied.port = String(proxy.port);

    h = await harness({ searchTimeoutMs: 600 });
    await awaitIdle(h.app);
    const { published } = await indexOne();

    // A second application, identical except that its PostgreSQL is proxied.
    const app = await createSearchTestApp({
      databaseUrl: proxied.toString(),
      natsUrl: natsUrl(),
      names: h.names,
      indexUid: h.indexUid,
      meiliA: { url: h.proxyA.url, key: endpoints.a.key },
      meiliB: { url: h.proxyB.url, key: endpoints.b.key },
      taskPollMs: 25,
      retryDelaysMs: FAST_RETRIES,
      deferStart: true,
    });
    try {
      app.startWorkers();
      await awaitIdle(app);
      expect((await app.request('GET', '/catalog/search?q=Vadon')).body.items.map((i: { id: string }) => i.id))
        .toEqual([published.id]);

      proxy.setMode('down');
      const response = await app.request('GET', '/catalog/search?q=Vadon');
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('dependency_unavailable');
      expect(response.body).not.toHaveProperty('items');
    } finally {
      await app.close();
      await proxy.close();
    }
  }, 120_000);

  it('M4-T25: processing-status reports both indexes, with pending work and an outage', async () => {
    h = await harness({ relayEnabled: false });
    await awaitIdle(h.app);
    // A pending outbox row is exactly the R02 regression shape.
    await publishContent();

    const ops = actor('publisher-1', ['publisher']);
    const normal = await h.app.request('GET', '/admin/processing-status', { actor: ops });
    expect(processingStatusViewSchema.safeParse(normal.body).success).toBe(true);
    expect(normal.status).toBe(200);
    expect(normal.body.outbox.pending).toBeGreaterThanOrEqual(1);
    expect(normal.body.outbox.oldestOccurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(normal.body.outbox.oldestAgeMs).toBeGreaterThanOrEqual(0);
    for (const alias of ['a', 'b'] as const) {
      const index = normal.body.indexes[alias];
      expect(index.state).toBe('idle');
      expect(index.durable).toBe(h.app.state.get(alias).durable);
      expect(index.reachable).toBe(true);
      expect(index.inFlightEventId).toBeNull();
      expect(index).toHaveProperty('lastAckedAt');
      expect(index).toHaveProperty('lastErrorCode');
    }

    // One instance goes away: the endpoint still answers 200 and says so.
    h.proxyA.setMode('down');
    await deliverPending(h.nc, h.names);
    await waitFor('a is retrying', async () => h.app.state.get('a').state === 'retrying', 30_000, 50);
    const degraded = await h.app.request('GET', '/admin/processing-status', { actor: ops });
    expect(processingStatusViewSchema.safeParse(degraded.body).success).toBe(true);
    expect(degraded.status).toBe(200);
    expect(degraded.body.indexes.a.state).toBe('retrying');
    expect(degraded.body.indexes.a.reachable).toBe(false);
    expect(degraded.body.indexes.a.lastErrorCode).not.toBeNull();
    expect(degraded.body.indexes.b.reachable).toBe(true);
    // No secret anywhere in the operator view.
    const serialised = JSON.stringify(degraded.body);
    expect(serialised).not.toContain(endpoints.a.key);
    expect(serialised).not.toContain(endpoints.b.key);
    h.proxyA.setMode('pass');
  }, 120_000);

  it('M4-T24: search is public without a token and 503s cleanly while the feature is off', async () => {
    h = await harness();
    await awaitIdle(h.app);
    await indexOne();

    // No Authorization header at all: public.
    const anonymous = await h.app.request('GET', '/catalog/search?q=Vadon', { actor: null });
    expect(anonymous.status).toBe(200);

    // FEATURE_SEARCH=off: a stable 503, and no Meilisearch call is attempted.
    const offNames = isolatedTopology('M4OFF');
    const nc = await connect({ servers: natsUrl(), name: `m4-off-${offNames.runId}` });
    const jsm = await jetstreamManager(nc);
    await ensureTopology(jsm, offNames);
    const proxy = await createMeiliProxy(endpoints.a.url);
    const offApp = await createSearchTestApp({
      databaseUrl: dbUrl!, natsUrl: natsUrl(), names: offNames,
      indexUid: isolatedIndexUid(offNames.runId.toLowerCase()),
      meiliA: { url: proxy.url, key: endpoints.a.key },
      meiliB: { url: proxy.url, key: endpoints.b.key },
      featureSearch: false,
    });
    try {
      const response = await offApp.request('GET', '/catalog/search?q=Vadon');
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('search_unavailable');
      expect(proxy.requests).toBe(0);
      // A malformed query is still a 422: validation happens before routing.
      expect((await offApp.request('GET', '/catalog/search')).status).toBe(422);
    } finally {
      await offApp.close();
      await proxy.close();
      await destroyTopology(jsm, offNames).catch(() => undefined);
      await nc.close().catch(() => undefined);
    }
  }, 120_000);
});
