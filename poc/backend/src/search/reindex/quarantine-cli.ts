import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module.js';
import { JetStreamAdapter } from '../../messaging/jetstream.adapter.js';
import { contentEventV1Schema } from '../../contracts/events.js';
import { searchQuarantineV1Schema, SEARCH_INDEX_ALIASES, type SearchIndexAlias } from '../../contracts/search.js';
import { ContentRepository } from '../../content/content.repository.js';
import { DatabaseService } from '../../database.js';
import { SearchRegistry } from '../search.registry.js';
import { projectionFor } from '../projection.js';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function sequence(): number {
  const value = Number(option('sequence'));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid_sequence');
  return value;
}

function parseJson(data: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(data));
}

async function inspect(broker: JetStreamAdapter, value: number) {
  const stored = await broker.storedMessage(broker.names.quarantineStream, value);
  if (stored === null) throw new Error('quarantine_not_found');
  const parsed = searchQuarantineV1Schema.safeParse(parseJson(stored.data));
  if (!parsed.success) throw new Error('quarantine_schema_invalid');
  const record = parsed.data;
  return {
    quarantineId: record.quarantineId,
    errorCode: record.errorCode,
    eventId: record.originalEventId,
    subject: record.originalSubject,
    sequence: record.originalStreamSequence,
    durable: record.durable,
  };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const broker = app.get(JetStreamAdapter);
    if (command === 'inspect' || command === 'replay') {
      const quarantineSequence = sequence();
      const summary = await inspect(broker, quarantineSequence);
      if (command === 'inspect') {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        return;
      }
      const reason = option('reason')?.trim();
      if (!reason) throw new Error('quarantine_reason_required');
      const original = await broker.storedMessage(broker.names.stream, summary.sequence);
      if (original === null) throw new Error('quarantine_original_expired');
      const parsed = contentEventV1Schema.safeParse(parseJson(original.data));
      if (!parsed.success) throw new Error('quarantine_schema_invalid');
      const repository = app.get(ContentRepository);
      const database = app.get(DatabaseService);
      if (!(await repository.findById(database.db, parsed.data.aggregateId))) {
        throw new Error('quarantine_aggregate_unknown');
      }
      const published = await broker.publishTo(
        broker.names.subject,
        original.data,
        `replay:${summary.quarantineId}`,
      );
      process.stdout.write(`${JSON.stringify({ ...summary, replaySequence: published.streamSeq, reason }, null, 2)}\n`);
      return;
    }

    if (command === 'repair') {
      const id = option('id');
      const target = option('index');
      if (!id) throw new Error('repair_target_unknown');
      if (target !== 'both' && !(SEARCH_INDEX_ALIASES as readonly string[]).includes(target ?? '')) {
        throw new Error('invalid_index');
      }
      const repository = app.get(ContentRepository);
      const database = app.get(DatabaseService);
      const row = await repository.findById(database.db, id);
      if (!row) throw new Error('repair_target_unknown');
      const decision = projectionFor(id, row);
      if (decision.operation === 'reject') throw new Error('repair_task_failed');
      const aliases: SearchIndexAlias[] = target === 'both' ? ['a', 'b'] : [target as SearchIndexAlias];
      const registry = app.get(SearchRegistry);
      const tasks = [];
      for (const alias of aliases) {
        const adapter = registry.adapter(alias);
        const uid = decision.operation === 'upsert'
          ? await adapter.submitUpsert(decision.document)
          : await adapter.submitDelete(decision.id);
        const task = await adapter.awaitTask(uid);
        if (task.status !== 'succeeded') throw new Error('repair_task_failed');
        tasks.push({ alias, taskUid: task.uid });
      }
      process.stdout.write(`${JSON.stringify({ id, tasks }, null, 2)}\n`);
      return;
    }
    throw new Error('invalid_command');
  } finally {
    await app.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'internal_error'}\n`);
  process.exitCode = 1;
});
