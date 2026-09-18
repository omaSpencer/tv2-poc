#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect } from '@nats-io/transport-node';
import { jetstreamManager } from '@nats-io/jetstream';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { DatabaseService } from '../dist/database.js';
import { SEARCH_BROKER, SearchRegistry } from '../dist/search/search.registry.js';
import { ReindexCoordinator } from '../dist/search/reindex/coordinator.js';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const count = Number(arg('count') ?? 1000);
const output = arg('output');
const databaseUrl = process.env.TEST_DATABASE_URL;
const stream = process.env.NATS_STREAM ?? '';
const indexUid = process.env.MEILI_INDEX_UID ?? '';

if (!databaseUrl || !new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must name an explicit *_test database.');
}
if (process.env.FEATURE_SEARCH !== 'on') throw new Error('FEATURE_SEARCH=on is required.');
if (!/^W4_VERIFY_[A-Z0-9_]+$/.test(stream)) {
  throw new Error('NATS_STREAM must be an isolated W4_VERIFY_* evidence stream.');
}
if (!/^w4_verifier_[a-z0-9_]+$/.test(indexUid)) {
  throw new Error('MEILI_INDEX_UID must be an isolated w4_verifier_* evidence index.');
}
if (!Number.isInteger(count) || count < 1 || count > 10_000) {
  throw new Error('count must be an integer between 1 and 10000.');
}

let context;
let database;
let registry;
const startedAt = Date.now();
try {
  context = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  database = context.get(DatabaseService);
  registry = context.get(SearchRegistry);
  const broker = context.get(SEARCH_BROKER);
  const coordinator = context.get(ReindexCoordinator);
  await broker.ensureConnected();

  const existing = await database.withClient(client => client.query(`
    select
      (select count(*)::int from content) as content_count,
      (select count(*)::int from outbox_event) as outbox_count
  `));
  if (existing.rows[0]?.content_count !== 0 || existing.rows[0]?.outbox_count !== 0) {
    throw new Error('Verifier evidence requires an empty, freshly migrated test database.');
  }

  await database.withClient(client => client.query(`
    insert into content (
      id, slug, title, summary, category, media_asset_id, tags, status, version,
      created_at, updated_at, published_at, withdrawn_at, created_by, updated_by
    )
    select
      ('f5' || lpad(to_hex(series), 30, '0'))::uuid,
      'w4-verifier-' || series,
      'W4 verifier published content ' || series,
      repeat('Bounded verifier evidence summary ', 4),
      case when series % 2 = 0 then 'film' else 'sorozat' end,
      'w4-verifier-media-' || series,
      array['w4', 'verifier', 'group-' || (series % 20)],
      'published', 1,
      clock_timestamp(), clock_timestamp(), clock_timestamp(), null,
      'w4-verifier-evidence', 'w4-verifier-evidence'
    from generate_series(1, $1) as series
  `, [count]));

  const reindex = {};
  for (const alias of ['a', 'b']) {
    const result = await coordinator.run({ runId: randomUUID(), index: alias });
    reindex[alias] = result;
  }
  const report = {
    measuredAt: new Date().toISOString(),
    catalogDocuments: count,
    totalDurationMs: Date.now() - startedAt,
    reindex,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(resolve(output), serialized);
  process.stdout.write(serialized);
} finally {
  if (registry) {
    for (const alias of ['a', 'b']) {
      const adapter = registry.adapter(alias);
      const task = await adapter.deleteNamedIndex(indexUid).catch(() => null);
      if (task !== null) await adapter.awaitTask(task).catch(() => undefined);
    }
  }
  if (database) {
    await database.withClient(client => client.query(
      `delete from content where created_by = 'w4-verifier-evidence'`,
    )).catch(() => undefined);
  }
  await context?.close().catch(() => undefined);

  if (process.env.NATS_URL) {
    const nc = await connect({ servers: process.env.NATS_URL }).catch(() => null);
    if (nc) {
      const manager = await jetstreamManager(nc).catch(() => null);
      if (manager) {
        await manager.streams.delete(stream).catch(() => undefined);
        await manager.streams.delete(`${stream}_DLQ`).catch(() => undefined);
      }
      await nc.close().catch(() => undefined);
    }
  }
}
