import 'reflect-metadata';
import { z } from 'zod';
import { NestFactory } from '@nestjs/core';
import { ContentRepairService } from '../content-repair.service.js';
import { QuarantineService } from '../quarantine.service.js';
import { SEARCH_INDEX_ALIASES, type SearchIndexAlias } from '../../contracts/search.js';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function sequence(): number {
  const value = Number(option('sequence'));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid_sequence');
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const { AppModule } = await import('../../app.module.js');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    if (command === 'inspect') {
      process.stdout.write(`${JSON.stringify(await app.get(QuarantineService).inspect(sequence()), null, 2)}\n`);
      return;
    }
    if (command === 'replay') {
      const reason = option('reason')?.trim();
      if (!reason || reason.length < 3 || reason.length > 500) throw new Error('quarantine_reason_required');
      const result = await app.get(QuarantineService).replay(sequence(), reason, 'cli');
      process.stdout.write(`${JSON.stringify({ ...result, reason }, null, 2)}\n`);
      return;
    }
    if (command === 'repair') {
      const contentId = option('id');
      const target = option('index');
      if (!z.uuid().safeParse(contentId).success) throw new Error('repair_target_unknown');
      if (target !== 'both' && !(SEARCH_INDEX_ALIASES as readonly string[]).includes(target ?? '')) {
        throw new Error('invalid_index');
      }
      const result = await app.get(ContentRepairService).repair(
        contentId!,
        target as SearchIndexAlias | 'both',
      );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    throw new Error('invalid_command');
  } finally {
    await app.close();
  }
}

main().catch(error => {
  const code = (error as { code?: unknown }).code;
  process.stderr.write(`${typeof code === 'string' ? code : error instanceof Error ? error.message : 'internal_error'}\n`);
  process.exitCode = 1;
});
