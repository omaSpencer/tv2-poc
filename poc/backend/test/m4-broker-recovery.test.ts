import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { expect, it, vi } from 'vitest';
import { connect } from '@nats-io/transport-node';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import { JetStreamAdapter } from '../src/messaging/jetstream.adapter.js';
import { destroyTopology, topologyNames } from '../src/messaging/topology.js';
import { SearchProjectionWorker } from '../src/search/projection.worker.js';
import { SearchIndexState } from '../src/search/worker.state.js';
import { CONTENT_EVENT_V1_EXAMPLES } from '../src/contracts/events.js';
import type { MeiliIndexAdapter } from '../src/search/meili.adapter.js';
import type { DatabaseService } from '../src/database.js';
import type { ContentRepository } from '../src/content/content.repository.js';

it.skipIf(!process.env.NATS_URL)('R01 both workers recover after their real NATS connection closes', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const names = topologyNames(`REVIEW_${suffix}`, `review.${suffix}.changed`);
  const broker = new JetStreamAdapter(new ConfigService({
    NATS_URL: process.env.NATS_URL,
    NATS_STREAM: names.stream,
    NATS_SUBJECT: names.subject,
    NATS_PUBLISH_ACK_TIMEOUT_MS: 1000,
  }));
  const nc = await connect({ servers: process.env.NATS_URL });
  const js = jetstream(nc);
  const jsm = await jetstreamManager(nc);
  const workers = (['a', 'b'] as const).map((alias, index) => {
    const adapter = {
      alias,
      indexExists: async () => true,
      primaryKey: async () => 'id',
      managedSettings: async () => ({ searchableAttributes: ['title', 'tags', 'summary'], filterableAttributes: ['category'], displayedAttributes: ['id'], sortableAttributes: [] }),
      submitDelete: async () => 1,
      awaitTask: async () => ({ uid: 1, status: 'succeeded', errorCode: null }),
    } as unknown as MeiliIndexAdapter;
    return new SearchProjectionWorker(alias, names.durables[index]!, adapter, new SearchIndexState(), broker, names, { db: {} } as DatabaseService, { findById: async () => undefined } as unknown as ContentRepository, { logLevel: 'silent', retryDelaysMs: [20] });
  });
  try {
    workers.forEach(worker => worker.start());
    await vi.waitFor(() => expect(workers.every(worker => worker.state.state === 'idle')).toBe(true), { timeout: 10000 });
    await broker.abort(); // Only the test's connection; the shared server stays running.
    const event = { ...CONTENT_EVENT_V1_EXAMPLES[1], eventId: randomUUID() };
    await js.publish(names.subject, Buffer.from(JSON.stringify(event)));
    await vi.waitFor(async () => {
      for (const worker of workers) {
        const info = await jsm.consumers.info(names.stream, worker.durable);
        expect(worker.state.lastAckedAt).not.toBeNull();
        expect(info.num_pending).toBe(0);
        expect(info.num_ack_pending).toBe(0);
      }
    }, { timeout: 15000 });
    expect(broker.isConnected).toBe(true);
  } finally {
    await Promise.all(workers.map(worker => worker.stop()));
    await broker.close();
    await destroyTopology(jsm, names);
    await nc.close();
  }
}, 30000);
