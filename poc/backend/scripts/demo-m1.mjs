#!/usr/bin/env node
/**
 * M1-09 – the reproducible demo run (M1 §7.1).
 *
 * It walks the documented sequence through the service layer without an HTTP
 * listener, using an explicit demo actor: draft v1 → edit v2 → publish v3 →
 * withdraw v4 → edit v5 → republish v6, ending with six audit rows and three
 * pending outbox events. No-op and rejected side probes must not move those
 * numbers. Run `npm run demo:m1` after `npm run db:migrate`.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { ContentService } from '../dist/content/content.service.js';
import { DatabaseService } from '../dist/database.js';
import { contentAudit, outboxEvent } from '../dist/schema.js';
import {
  normalizeCreateCommand, normalizePatchCommand, normalizeVersionedCommand,
} from '../dist/contracts/http.js';
import { DEMO_CONTENT, DEMO_EDIT, DEMO_SLUG, DEMO_WITHDRAWN_EDIT, NEGATIVE_CASES } from '../dist/content/demo-fixture.js';

const steps = [];
const note = (step, detail) => {
  steps.push({ step, ...detail });
  process.stdout.write(`${JSON.stringify({ event: 'demo_step', step, ...detail })}\n`);
};

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejected(work, code) {
  try {
    await work();
  } catch (error) {
    expect(error.code === code, `expected ${code}, received ${error.code ?? error.message}`);
    return;
  }
  throw new Error(`expected the operation to fail with ${code}`);
}

const context = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
let failure = null;
try {
  const service = context.get(ContentService);
  const database = context.get(DatabaseService);
  const operation = {
    actor: { sub: 'demo-publisher', roles: ['publisher'] },
    correlationId: `demo-${randomUUID()}`,
  };

  const draft = await service.create(
    normalizeCreateCommand({ ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] }), operation,
  );
  expect(draft.version === 1 && draft.status === 'draft', 'the draft was not created at version 1');
  note('draft', { id: draft.id, version: draft.version, status: draft.status, slug: draft.slug });

  const edited = await service.patch(
    draft.id, normalizePatchCommand({ expectedVersion: 1, summary: DEMO_EDIT.summary, tags: [...DEMO_EDIT.tags] }), operation,
  );
  expect(edited.version === 2, 'the metadata edit did not reach version 2');
  note('edit', { version: edited.version });

  // Side probes: a no-op, a stale version and the publish minimum. None of them
  // may create a version, an audit row or an event.
  const noop = await service.patch(
    draft.id, normalizePatchCommand({ expectedVersion: 2, summary: DEMO_EDIT.summary, tags: [...DEMO_EDIT.tags] }), operation,
  );
  expect(noop.version === 2, 'the no-op changed the version');
  await rejected(() => service.patch(draft.id, normalizePatchCommand({ expectedVersion: 1, title: 'X' }), operation), 'version_conflict');
  const incomplete = await service.create(normalizeCreateCommand(NEGATIVE_CASES.missingMediaAsset), operation);
  await rejected(() => service.publish(incomplete.id, normalizeVersionedCommand({ expectedVersion: 1 }), operation), 'validation_failed');
  note('side-probes', { noopVersion: noop.version, incompleteId: incomplete.id });

  const published = await service.publish(draft.id, normalizeVersionedCommand({ expectedVersion: 2 }), operation);
  expect(published.version === 3 && published.slug === DEMO_SLUG, `publish produced ${published.slug} at v${published.version}`);
  note('publish', { version: published.version, slug: published.slug });

  const readable = await service.findPublished(draft.id);
  expect(readable.id === draft.id, 'the published content is not publicly readable');

  const withdrawn = await service.withdraw(draft.id, normalizeVersionedCommand({ expectedVersion: 3 }), operation);
  expect(withdrawn.version === 4 && withdrawn.slug === DEMO_SLUG, 'withdrawal changed the slug or the version');
  note('withdraw', { version: withdrawn.version, slug: withdrawn.slug });

  const editedAfterWithdraw = await service.patch(
    draft.id, normalizePatchCommand({ expectedVersion: 4, title: DEMO_WITHDRAWN_EDIT.title }), operation,
  );
  expect(editedAfterWithdraw.version === 5, 'the withdrawn edit did not reach version 5');
  note('withdrawn-edit', { version: editedAfterWithdraw.version });

  const republished = await service.publish(draft.id, normalizeVersionedCommand({ expectedVersion: 5 }), operation);
  expect(republished.version === 6 && republished.slug === DEMO_SLUG, 'republish did not keep the slug at version 6');
  note('republish', { version: republished.version, slug: republished.slug });

  const [audits] = await database.db
    .select({ count: sql`count(*)::int` }).from(contentAudit).where(eq(contentAudit.contentId, draft.id));
  const events = await database.db
    .select().from(outboxEvent).where(eq(outboxEvent.aggregateId, draft.id));
  expect(audits.count === 6, `expected 6 audit rows, found ${audits.count}`);
  expect(events.length === 3, `expected 3 outbox events, found ${events.length}`);
  expect(events.every(event => event.deliveredAt === null), 'an outbox event was already marked delivered');
  expect(
    events.map(event => event.eventType).join(',') === 'content.published,content.withdrawn,content.published',
    'the event sequence does not match the lifecycle',
  );
  note('summary', {
    contentId: draft.id, finalVersion: republished.version,
    audits: audits.count, pendingEvents: events.length,
    eventTypes: events.map(event => event.eventType),
  });
} catch (error) {
  failure = error;
} finally {
  await context.close();
}

if (failure) {
  process.stderr.write(`${JSON.stringify({ event: 'demo_failed', reason: failure.message })}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ event: 'demo_finished', steps: steps.length })}\n`);
