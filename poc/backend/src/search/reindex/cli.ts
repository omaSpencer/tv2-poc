import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module.js';
import { ReindexCoordinator } from './coordinator.js';
import { ReindexControlRepository } from './control.repository.js';
import { REINDEX_INDEX_ALIASES, type ReindexIndexAlias } from '../../contracts/reindex.js';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requestedIndex(): ReindexIndexAlias {
  const value = option('index');
  if (!(REINDEX_INDEX_ALIASES as readonly string[]).includes(value ?? '')) {
    throw new Error('invalid_index');
  }
  return value as ReindexIndexAlias;
}

const interrupted = { aborted: false };
process.once('SIGINT', () => { interrupted.aborted = true; });
process.once('SIGTERM', () => { interrupted.aborted = true; });

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'reindex';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    if (command === 'status') {
      const rows = await app.get(ReindexControlRepository).all();
      process.stdout.write(`${JSON.stringify(rows.map(row => ({
        ...row,
        ownerId: row.ownerId === null ? null : 'active',
      })), null, 2)}\n`);
      return;
    }
    if (command !== 'reindex') throw new Error('invalid_command');
    const result = await app.get(ReindexCoordinator).run({
      runId: randomUUID(),
      index: requestedIndex(),
      allowSearchOutage: flag('allow-search-outage'),
      confirmTarget: option('confirm-target'),
      signal: interrupted,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

main().catch(error => {
  const code = (error as { code?: unknown }).code;
  process.stderr.write(`${typeof code === 'string' ? code : (error instanceof Error ? error.message : 'internal_error')}\n`);
  process.exitCode = 1;
});
