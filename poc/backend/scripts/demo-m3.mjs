#!/usr/bin/env node
/**
 * M3-09 – reproducible outbox → JetStream demo.
 *
 * Documented sequence:
 *   1. Publish with relay stopped → pending outbox row
 *   2. Start relay → publish ACK → delivered_at
 *   3. Stop relay (simulates broker-side stall for the CMS path)
 *   4. Withdraw + publish again → two pending rows (CMS still succeeds)
 *   5. Start relay → both delivered in order
 *
 * Requires FEATURE_OUTBOX_RELAY=on, NATS_URL, DATABASE_URL. Relay auto-start is
 * forced off so the script owns the start/stop points.
 *
 *   npm run demo:m3
 */
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { ContentService } from '../dist/content/content.service.js';
import { DatabaseService } from '../dist/database.js';
import { OutboxRepository } from '../dist/outbox/outbox.repository.js';
import { OutboxRelay } from '../dist/messaging/relay.js';
import { JetStreamAdapter } from '../dist/messaging/jetstream.adapter.js';
import {
  normalizeCreateCommand, normalizeVersionedCommand,
} from '../dist/contracts/http.js';
import { DEMO_CONTENT } from '../dist/content/demo-fixture.js';

function note(step, detail = {}) {
  process.stdout.write(`${JSON.stringify({ event: 'demo_step', step, ...detail })}\n`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(label, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

process.env.RELAY_AUTO_START = 'off';
if (process.env.FEATURE_OUTBOX_RELAY !== 'on' || !process.env.NATS_URL) {
  process.stderr.write(`${JSON.stringify({
    event: 'demo_failed',
    reason: 'FEATURE_OUTBOX_RELAY=on and NATS_URL are required',
  })}\n`);
  process.exit(1);
}

const appContext = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
  abortOnError: false,
});
let failure = null;
try {
  const service = appContext.get(ContentService);
  const database = appContext.get(DatabaseService);
  const outbox = appContext.get(OutboxRepository);
  const relay = appContext.get(OutboxRelay);
  const broker = appContext.get(JetStreamAdapter);
  const operation = {
    actor: { sub: 'demo-publisher', roles: ['publisher'] },
    correlationId: `demo-m3-${randomUUID()}`,
  };

  const draft = await service.create(
    normalizeCreateCommand({
      ...DEMO_CONTENT,
      title: `M3 demo ${randomUUID().slice(0, 8)}`,
      tags: [...DEMO_CONTENT.tags],
    }),
    operation,
  );
  const published = await service.publish(
    draft.id,
    normalizeVersionedCommand({ expectedVersion: 1 }),
    operation,
  );
  let stats = await outbox.pendingStats(database.db);
  expect(stats.pending >= 1, 'expected a pending outbox event before relay start');
  note('pending-before-relay', {
    contentId: published.id,
    version: published.version,
    pending: stats.pending,
    stream: broker.names.stream,
  });

  relay.start();
  await waitFor('first delivery', async () => (await outbox.pendingStats(database.db)).pending === 0);
  note('first-delivered', { lastDeliveredAt: relay.status.snapshot().lastDeliveredAt });

  await relay.stop(2000);
  note('relay-stopped', {});

  const withdrawn = await service.withdraw(
    published.id,
    normalizeVersionedCommand({ expectedVersion: published.version }),
    operation,
  );
  const republished = await service.publish(
    published.id,
    normalizeVersionedCommand({ expectedVersion: withdrawn.version }),
    operation,
  );
  stats = await outbox.pendingStats(database.db);
  expect(stats.pending === 2, `expected 2 pending events, found ${stats.pending}`);
  note('pending-while-relay-stopped', {
    pending: stats.pending,
    versions: [withdrawn.version, republished.version],
  });

  relay.start();
  await waitFor('catch-up delivery', async () => (await outbox.pendingStats(database.db)).pending === 0);
  const snapshot = await broker.snapshot();
  note('summary', {
    contentId: published.id,
    stream: broker.names.stream,
    brokerConnected: snapshot.connected,
    consumers: snapshot.consumers,
    quarantinePending: snapshot.quarantinePending,
  });
  expect(
    snapshot.quarantinePending === 0 || snapshot.quarantinePending === null,
    'quarantine must stay empty',
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await appContext.get(OutboxRelay).stop(2000);
  } catch { /* ignore */ }
  await appContext.close();
}

if (failure) {
  process.stderr.write(`${JSON.stringify({ event: 'demo_failed', reason: failure.message })}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ event: 'demo_passed', milestone: 'M3' })}\n`);
}
