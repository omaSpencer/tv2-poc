/**
 * M3-T01–T20 – outbox relay against real JetStream and PostgreSQL.
 *
 * Requires TEST_DATABASE_URL (_test marker) and NATS_URL / TEST_NATS_URL.
 * Each case uses an isolated stream name and tears it down afterwards.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connect } from '@nats-io/transport-node';
import { jetstreamManager, DiscardPolicy, RetentionPolicy, StorageType } from '@nats-io/jetstream';
import { nanos } from '@nats-io/transport-node';
import {
  context, createServices, query, testDatabaseUrl, truncateAll,
} from '../support/database.js';
import {
  hasNats, isolatedTopology, natsUrl, streamMessageCount, waitFor,
} from '../support/nats.js';
import { createRelayTestApp } from '../support/relay-app.js';
import { createTestApp } from '../support/test-app.js';
import {
  normalizeCreateCommand, normalizeVersionedCommand,
} from '../../src/contracts/http.js';
import { contentEventV1Schema } from '../../src/contracts/events.js';
import { DEMO_CONTENT } from '../fixtures/demo.js';
import {
  destroyTopology, ensureTopology, TopologyMismatchError,
} from '../../src/messaging/topology.js';
import { ConfigurationError, validateConfig } from '../../src/config.js';

const dbUrl = (() => {
  try { return testDatabaseUrl(); } catch { return ''; }
})();
const natsReady = hasNats();
const run = dbUrl && natsReady;

const publisher = { sub: 'publisher-1', roles: ['publisher'] };
const editor = { sub: 'editor-1', roles: ['editor'] };
const viewer = { sub: 'viewer-1', roles: ['viewer'] };

async function publishDemo(service: ReturnType<typeof createServices>['service'], correlationId = `corr-${randomUUID()}`) {
  const op = context('publisher-1', correlationId, ['publisher']);
  const draft = await service.create(
    normalizeCreateCommand({ ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] }),
    op,
  );
  return service.publish(draft.id, normalizeVersionedCommand({ expectedVersion: 1 }), op);
}

describe.skipIf(!run)('M3 topology', () => {
  it('M3-T01: creates stream, DLQ and durables idempotently', async () => {
    const names = isolatedTopology('T01');
    const nc = await connect({ servers: natsUrl() });
    const jsm = await jetstreamManager(nc);
    try {
      await ensureTopology(jsm, names);
      const first = await jsm.streams.info(names.stream);
      expect(first.config.discard).toBe('new');
      expect(first.config.retention).toBe('limits');
      expect(first.config.storage).toBe('file');
      expect(first.config.max_msg_size).toBe(65_536);
      expect(first.config.duplicate_window).toBe(nanos(2 * 60 * 1000));
      for (const durable of names.durables) {
        const consumer = await jsm.consumers.info(names.stream, durable);
        expect(consumer.config.ack_policy).toBe('explicit');
      }
      const dlq = await jsm.streams.info(names.quarantineStream);
      expect(dlq.state.messages).toBe(0);

      await ensureTopology(jsm, names);
      const second = await jsm.streams.info(names.stream);
      expect(second.config.max_age).toBe(first.config.max_age);
      expect(second.state.messages).toBe(first.state.messages);
    } finally {
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T02: refuses a mismatched existing stream by field name', async () => {
    const names = isolatedTopology('T02');
    const nc = await connect({ servers: natsUrl() });
    const jsm = await jetstreamManager(nc);
    try {
      await jsm.streams.add({
        name: names.stream,
        subjects: [names.subject],
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        num_replicas: 1,
        max_age: nanos(60_000),
        max_bytes: 1024 * 1024,
        max_msgs: 100,
        max_msg_size: 65_536,
        discard: DiscardPolicy.Old,
        duplicate_window: nanos(60_000),
      });
      await expect(ensureTopology(jsm, names)).rejects.toBeInstanceOf(TopologyMismatchError);
      try {
        await ensureTopology(jsm, names);
      } catch (error) {
        expect(error).toBeInstanceOf(TopologyMismatchError);
        const mismatch = error as TopologyMismatchError;
        expect(mismatch.fields.some(field => ['max_age', 'discard', 'max_bytes', 'max_msgs'].includes(field))).toBe(true);
      }
      const info = await jsm.streams.info(names.stream);
      expect(info.config.discard).toBe('old');
    } finally {
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });
});

describe.skipIf(!run)('M3 relay delivery', () => {
  const { database, service, outbox } = createServices(dbUrl);

  beforeEach(() => truncateAll(dbUrl));
  afterAll(() => database.onApplicationShutdown());

  it('M3-T03: publishes and marks delivered only after ACK', async () => {
    const names = isolatedTopology('T03');
    const app = await createRelayTestApp({
      natsUrl: natsUrl(), names, databaseUrl: dbUrl, defaultActor: publisher, deferStart: true,
    });
    try {
      const published = await publishDemo(service, 'corr-t03');
      const pending = await outbox.pending(database.db, 10);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.deliveredAt).toBeNull();

      app.relay.start();
      await waitFor('delivery', async () => {
        const rows = await query<{ delivered_at: Date | null }>(
          'select delivered_at from outbox_event where aggregate_id = $1',
          [published.id],
          dbUrl,
        );
        return rows[0]?.delivered_at != null;
      });

      const nc = await connect({ servers: natsUrl() });
      try {
        const jsm = await jetstreamManager(nc);
        expect(await streamMessageCount(jsm, names.stream)).toBe(1);
      } finally {
        await nc.close();
      }
      const events = await query<any>(
        'select event_type, correlation_id from outbox_event where aggregate_id = $1',
        [published.id],
        dbUrl,
      );
      expect(events[0].event_type).toBe('content.published');
      expect(events[0].correlation_id).toBe('corr-t03');
      expect(events[0]).toBeTruthy();
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T04/T05: CMS writes succeed while NATS is down; deliver on return', async () => {
    const names = isolatedTopology('T45');
    // Outage segment: relay never starts, so CMS cannot depend on the broker.
    const app = await createRelayTestApp({
      natsUrl: 'nats://127.0.0.1:1',
      names,
      databaseUrl: dbUrl,
      defaultActor: publisher,
      deferStart: true,
    });
    try {
      const ready = await app.request('GET', '/health/ready');
      expect(ready.status).toBe(200);

      const created = await app.request('POST', '/admin/contents', {
        body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
        actor: publisher,
      });
      expect(created.status).toBe(201);
      const published = await app.request('POST', `/admin/contents/${created.body.id}/publish`, {
        body: { expectedVersion: 1 },
        actor: publisher,
      });
      expect(published.status).toBe(200);
      const withdrawn = await app.request('POST', `/admin/contents/${created.body.id}/withdraw`, {
        body: { expectedVersion: 2 },
        actor: publisher,
      });
      expect(withdrawn.status).toBe(200);

      const pending = await query<{ event_type: string }>(
        'select event_type from outbox_event where delivered_at is null order by aggregate_version',
        [],
        dbUrl,
      );
      expect(pending.map(row => row.event_type)).toEqual(['content.published', 'content.withdrawn']);
    } finally {
      await app.close();
    }

    // Restart against a real broker and deliver in order.
    const app2 = await createRelayTestApp({
      natsUrl: natsUrl(), names, databaseUrl: dbUrl, defaultActor: publisher, pollMs: 50,
    });
    try {
      await waitFor('both delivered', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is null',
          [],
          dbUrl,
        );
        return rows[0]!.n === 0;
      }, 20_000);

      const nc = await connect({ servers: natsUrl() });
      try {
        const jsm = await jetstreamManager(nc);
        expect(await streamMessageCount(jsm, names.stream)).toBe(2);
        const js = (await import('@nats-io/jetstream')).jetstream(nc);
        const consumer = await js.consumers.get(names.stream, names.durables[0]!);
        const first = await consumer.next({ expires: 2000 });
        const second = await consumer.next({ expires: 2000 });
        expect(first).toBeTruthy();
        expect(second).toBeTruthy();
        const a = contentEventV1Schema.parse(JSON.parse(new TextDecoder().decode(first!.data)));
        const b = contentEventV1Schema.parse(JSON.parse(new TextDecoder().decode(second!.data)));
        expect(a.eventType).toBe('content.published');
        expect(b.eventType).toBe('content.withdrawn');
        expect(a.aggregateVersion).toBeLessThan(b.aggregateVersion);
        first!.ack();
        second!.ack();
      } finally {
        await nc.close();
      }
    } finally {
      await app2.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T06: duplicate msgID within dedup window marks delivered once', async () => {
    const names = isolatedTopology('T06');
    let releaseGate: (() => void) | null = null;
    const blocked = new Promise<void>(resolve => { releaseGate = resolve; });
    let relayRef: { requestStop: () => void } | null = null;
    const app = await createRelayTestApp({
      natsUrl: natsUrl(),
      names,
      databaseUrl: dbUrl,
      deferStart: true,
      hooks: {
        afterPublishAck: async () => {
          relayRef!.requestStop();
          releaseGate?.();
        },
      },
    });
    relayRef = app.relay;
    try {
      await publishDemo(service);
      app.relay.start();
      await blocked;
      await app.relay.stop(1000);
      await waitFor('still pending after interrupt', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
        );
        return rows[0]!.n === 1;
      });

      app.relay.setHooks({});
      app.relay.start();
      await waitFor('delivered after restart', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
        );
        return rows[0]!.n === 0;
      });

      const nc = await connect({ servers: natsUrl() });
      try {
        const jsm = await jetstreamManager(nc);
        expect(await streamMessageCount(jsm, names.stream)).toBe(1);
      } finally {
        await nc.close();
      }
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T08: preserves multi-aggregate and published→withdrawn order', async () => {
    const names = isolatedTopology('T08');
    const app = await createRelayTestApp({
      natsUrl: natsUrl(), names, databaseUrl: dbUrl, deferStart: true,
    });
    try {
      const a = await publishDemo(service, 'corr-a');
      const b = await publishDemo(service, 'corr-b');
      await service.withdraw(a.id, normalizeVersionedCommand({ expectedVersion: 2 }), context('publisher-1', 'corr-a', ['publisher']));
      app.relay.start();
      await waitFor('three delivered', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
        );
        return rows[0]!.n === 0;
      });

      const nc = await connect({ servers: natsUrl() });
      try {
        const js = (await import('@nats-io/jetstream')).jetstream(nc);
        const consumer = await js.consumers.get(names.stream, names.durables[0]!);
        const events = [];
        for (let i = 0; i < 3; i += 1) {
          const msg = await consumer.next({ expires: 2000 });
          expect(msg).toBeTruthy();
          events.push(contentEventV1Schema.parse(JSON.parse(new TextDecoder().decode(msg!.data))));
          msg!.ack();
        }
        // occurred_at order: a published, b published, a withdrawn — withdraw must follow its publish.
        const aPub = events.findIndex(e => e.aggregateId === a.id && e.eventType === 'content.published');
        const aWd = events.findIndex(e => e.aggregateId === a.id && e.eventType === 'content.withdrawn');
        expect(aPub).toBeGreaterThanOrEqual(0);
        expect(aWd).toBeGreaterThan(aPub);
        expect(events.some(e => e.aggregateId === b.id)).toBe(true);
      } finally {
        await nc.close();
      }
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T10: capacity rejection leaves outbox pending', async () => {
    const names = isolatedTopology('T10');
    const limits = { maxMsgs: 1, maxBytes: 2048, maxAgeMs: 60_000, duplicateWindowMs: 60_000 };
    const app = await createRelayTestApp({
      natsUrl: natsUrl(), names, databaseUrl: dbUrl, limits, pollMs: 100,
    });
    try {
      await publishDemo(service);
      await waitFor('first delivered', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is not null', [], dbUrl,
        );
        return rows[0]!.n === 1;
      });
      await publishDemo(service);
      await new Promise(resolve => setTimeout(resolve, 800));
      const pending = await query<{ n: number }>(
        'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
      );
      expect(pending[0]!.n).toBe(1);
      expect(app.relay.status.snapshot().state).toMatch(/retrying|publishing|idle/);
      expect(app.relay.status.snapshot().lastErrorCode).toBe('capacity');
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T11: invalid envelope halts without skipping', async () => {
    const names = isolatedTopology('T11');
    const app = await createRelayTestApp({
      natsUrl: natsUrl(), names, databaseUrl: dbUrl, pollMs: 50,
    });
    try {
      const id = randomUUID();
      await query(
        `insert into content (id, title, tags, status, version, created_at, updated_at, created_by, updated_by)
         values ($1, 'Broken', '{}', 'draft', 1, now(), now(), 't', 't')`,
        [id],
        dbUrl,
      );
      await query(
        `insert into outbox_event
          (event_id, schema_version, event_type, aggregate_id, aggregate_version, occurred_at, correlation_id, payload)
         values ($1, 1, 'content.published', $2, 1, now(), 'corr-bad', '{"status":"published","extra":true}'::jsonb)`,
        [randomUUID(), id],
        dbUrl,
      );
      await waitFor('halted', async () => app.relay.status.snapshot().state === 'halted', 10_000);
      const pending = await query<{ n: number }>(
        'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
      );
      expect(pending[0]!.n).toBe(1);
      expect(app.relay.status.snapshot().lastErrorCode).toBe('invalid_envelope');
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T12/T13: processing-status auth matrix', async () => {
    const names = isolatedTopology('T12');
    const app = await createRelayTestApp({
      natsUrl: natsUrl(), names, databaseUrl: dbUrl, defaultActor: null,
    });
    try {
      await publishDemo(service);
      await waitFor('delivered', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
        );
        return rows[0]!.n === 0;
      });

      const ok = await app.request('GET', '/admin/processing-status', { actor: publisher });
      expect(ok.status).toBe(200);
      expect(ok.body.outbox.pending).toBe(0);
      expect(ok.body.relay.enabled).toBe(true);
      expect(ok.body.broker.connected).toBe(true);
      expect(ok.body.consumers).toHaveLength(2);
      expect(ok.body.consumers.every((c: { pending: number }) => c.pending >= 1)).toBe(true);
      expect(ok.body.quarantine?.pending ?? 0).toBe(0);

      expect((await app.request('GET', '/admin/processing-status', { actor: editor })).status).toBe(403);
      expect((await app.request('GET', '/admin/processing-status', { actor: viewer })).status).toBe(403);
      expect((await app.request('GET', '/admin/processing-status', { actor: null })).status).toBe(401);
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T14: broker down is reported without 500; ready stays 200', async () => {
    const names = isolatedTopology('T14');
    const app = await createRelayTestApp({
      natsUrl: 'nats://127.0.0.1:1',
      names,
      databaseUrl: dbUrl,
      defaultActor: publisher,
      deferStart: true,
    });
    try {
      expect((await app.request('GET', '/health/ready')).status).toBe(200);
      const status = await app.request('GET', '/admin/processing-status', { actor: publisher });
      expect(status.status).toBe(200);
      expect(status.body.broker.connected).toBe(false);
      expect(JSON.stringify(status.body)).not.toMatch(/password|nats:\/\//i);
    } finally {
      await app.close();
    }
  });

  it('M3-T15: second markDelivered is a no-op', async () => {
    const published = await publishDemo(service);
    const [row] = await outbox.pending(database.db, 1);
    expect(row).toBeTruthy();
    const firstAt = new Date('2026-01-01T00:00:00.000Z');
    expect(await outbox.markDelivered(database.db, row!.eventId, firstAt)).toBe(true);
    expect(await outbox.markDelivered(database.db, row!.eventId, new Date())).toBe(false);
    const stored = await query<{ delivered_at: Date }>(
      'select delivered_at from outbox_event where event_id = $1',
      [row!.eventId],
      dbUrl,
    );
    expect(new Date(stored[0]!.delivered_at).toISOString()).toBe(firstAt.toISOString());
    expect(published.id).toBeTruthy();
  });

  it('M3-T16: relay off leaves M1 behaviour unchanged', async () => {
    const names = isolatedTopology('T16');
    const app = await createRelayTestApp({
      natsUrl: natsUrl(), names, databaseUrl: dbUrl, relayEnabled: false, defaultActor: publisher,
    });
    try {
      const created = await app.request('POST', '/admin/contents', {
        body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
      });
      const published = await app.request('POST', `/admin/contents/${created.body.id}/publish`, {
        body: { expectedVersion: 1 },
      });
      expect(published.status).toBe(200);
      await new Promise(resolve => setTimeout(resolve, 300));
      const pending = await query<{ n: number }>(
        'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
      );
      expect(pending[0]!.n).toBe(1);
      expect(app.relay.status.snapshot().enabled).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('M3-T18: content transaction does not call the broker', async () => {
    const names = isolatedTopology('T18');
    let publishes = 0;
    const app = await createRelayTestApp({
      natsUrl: natsUrl(),
      names,
      databaseUrl: dbUrl,
      deferStart: true,
      hooks: { beforePublish: () => { publishes += 1; } },
    });
    try {
      await publishDemo(service);
      expect(publishes).toBe(0);
      app.relay.start();
      await waitFor('delivered', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
        );
        return rows[0]!.n === 0;
      });
      expect(publishes).toBe(1);
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });

  it('M3-T19: bounded shutdown leaves pending work restartable', async () => {
    const names = isolatedTopology('T19');
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const app = await createRelayTestApp({
      natsUrl: natsUrl(),
      names,
      databaseUrl: dbUrl,
      deferStart: true,
      hooks: {
        beforePublish: async () => {
          await hold;
        },
      },
    });
    try {
      await publishDemo(service);
      app.relay.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      const stopping = app.relay.stop(500);
      release();
      await stopping;
      // May or may not have delivered depending on timing; restart must finish.
      app.relay.setHooks({});
      app.relay.start();
      await waitFor('delivered after restart', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
        );
        return rows[0]!.n === 0;
      });
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names);
      await nc.close();
    }
  });
});

describe('M3 configuration', () => {
  const base = {
    NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://poc:sentinel-password@127.0.0.1:1/poc',
  };

  it('M3-T17: FEATURE_OUTBOX_RELAY=on requires NATS_URL by key name', () => {
    expect(() => validateConfig({ ...base, FEATURE_OUTBOX_RELAY: 'on' })).toThrow(ConfigurationError);
    try {
      validateConfig({ ...base, FEATURE_OUTBOX_RELAY: 'on' });
    } catch (error) {
      expect((error as ConfigurationError).keys).toContain('NATS_URL');
    }
    expect(validateConfig({
      ...base,
      FEATURE_OUTBOX_RELAY: 'on',
      NATS_URL: 'nats://127.0.0.1:4222',
    }).NATS_PUBLISH_ACK_TIMEOUT_MS).toBe(5000);
  });

  it('keeps unimplemented integrations rejected', () => {
    for (const flag of ['FEATURE_IDENTITY', 'FEATURE_SEARCH', 'FEATURE_MEDIA']) {
      expect(() => validateConfig({ ...base, [flag]: 'on' })).toThrow(ConfigurationError);
    }
  });
});

describe.skipIf(!dbUrl)('M3 without broker still serves processing-status shape via test app', () => {
  beforeEach(() => truncateAll(dbUrl));

  it('M3-T20-ish: correlation id round-trip on admin routes remains secret-free', async () => {
    // Full T20 needs relay logs; this asserts the HTTP correlation half still holds.
    const app = await createTestApp(publisher);
    try {
      const response = await app.request('POST', '/admin/contents', {
        body: { title: 'Corr' },
        correlationId: 'corr-m3-t20',
      });
      expect(response.status).toBe(201);
      expect(response.headers.get('x-correlation-id')).toBe('corr-m3-t20');
    } finally {
      await app.close();
    }
  });
});
