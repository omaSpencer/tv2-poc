#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { ContentService } from '../dist/content/content.service.js';
import { normalizeCreateCommand, normalizeVersionedCommand } from '../dist/contracts/http.js';
import { SearchRegistry, SEARCH_BROKER } from '../dist/search/search.registry.js';
import { OutboxRepository } from '../dist/outbox/outbox.repository.js';
import { DatabaseService } from '../dist/database.js';
import { ReindexCoordinator } from '../dist/search/reindex/coordinator.js';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const outputArg = arg('output');
if (!outputArg || process.env.FEATURE_SEARCH !== 'on' || process.env.FEATURE_OUTBOX_RELAY !== 'on') {
  process.stderr.write('baseline_requires_output_and_enabled_relay_search\n');
  process.exit(1);
}

const count = Number(arg('count') ?? 1000);
const cycles = Number(arg('cycles') ?? 100);
const concurrency = Number(arg('concurrency') ?? 4);
if (!Number.isInteger(count) || count < cycles || !Number.isInteger(cycles) || cycles < 1
  || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  process.stderr.write('invalid_baseline_arguments\n');
  process.exit(1);
}

const output = resolve(outputArg);
await mkdir(output, { recursive: true });
const context = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
const runId = randomUUID();
const raw = {
  runId,
  startedAt: new Date().toISOString(),
  parameters: { count, cycles, concurrency, pollMs: 50, sampleMs: 1000, timeoutMs: 30000 },
  environment: {
    gitCommit: safeExec('git', ['rev-parse', 'HEAD']),
    gitDirty: safeExec('git', ['status', '--porcelain']).length > 0,
    node: process.version,
    npm: safeExec('npm', ['--version']),
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    memoryBytes: os.totalmem(),
  },
  latency: { publish: { a: [], b: [] }, withdraw: { a: [], b: [] } },
  lagSamples: [],
  reindex: {},
  errors: [],
};

function safeExec(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); } catch { return 'unavailable'; }
}

function fixture(index) {
  return normalizeCreateCommand({
    title: `Magyar próbatartalom ${String(index).padStart(4, '0')}`,
    summary: `Determinista összefoglaló a(z) ${index}. szintetikus tartalomhoz és keresési méréshez.`,
    category: ['film', 'sorozat', 'hir', 'sport', 'szorakozas'][index % 5],
    mediaAssetId: `synthetic-${String(index).padStart(4, '0')}`,
    tags: ['magyar', `csoport-${index % 20}`, `minta-${index % 7}`],
  });
}

async function mapLimit(values, limit, work) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      await work(values[index], index);
    }
  }));
}

async function waitFor(label, probe, timeoutMs = 30000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  throw new Error(`timeout:${label}`);
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(ratio * sorted.length) - 1)];
}

function stats(values) {
  return {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

let sampler;
try {
  const content = context.get(ContentService);
  const registry = context.get(SearchRegistry);
  const database = context.get(DatabaseService);
  const outbox = context.get(OutboxRepository);
  const broker = context.get(SEARCH_BROKER);
  const coordinator = context.get(ReindexCoordinator);
  const operation = {
    actor: { sub: `baseline-${runId}`, roles: ['publisher'] },
    correlationId: `baseline-${runId}`,
  };
  await broker.ensureConnected();
  const postgresVersion = await database.withClient(client => client.query('select version() as version'));
  raw.environment.services = {
    postgres: postgresVersion.rows[0]?.version ?? 'unknown',
    nats: broker.serverVersion ?? 'unknown',
    meiliA: await registry.adapter('a').version(),
    meiliB: await registry.adapter('b').version(),
    authentik: process.env.FEATURE_IDENTITY === 'on' ? 'enabled; live evidence recorded separately' : 'disabled',
  };

  sampler = setInterval(() => {
    void (async () => {
      const outboxStats = await outbox.pendingStats(database.db);
      const consumers = {};
      for (const alias of ['a', 'b']) {
        consumers[alias] = await broker.consumerProgress(registry.config.instances[alias].durable).catch(() => null);
      }
      raw.lagSamples.push({ atMs: performance.now(), outboxPending: outboxStats.pending, consumers });
    })().catch(error => raw.errors.push({ stage: 'sample', code: error.message }));
  }, 1000);

  const drafts = Array.from({ length: count });
  await mapLimit(Array.from({ length: count }, (_, index) => index), concurrency, async index => {
    drafts[index] = await content.create(fixture(index), operation);
  });

  // Seed is a separate phase. The last `cycles` drafts stay unpublished for
  // the measured publish→visible→withdraw→absent pairs.
  await mapLimit(drafts.slice(0, count - cycles), concurrency, async draft => {
    await content.publish(draft.id, normalizeVersionedCommand({ expectedVersion: draft.version }), operation);
  });
  await waitFor('seed drain', async () => {
    const a = await broker.consumerProgress(registry.config.instances.a.durable);
    const b = await broker.consumerProgress(registry.config.instances.b.durable);
    return a.pending === 0 && a.ackPending === 0 && b.pending === 0 && b.ackPending === 0;
  }, 300000);

  await mapLimit(drafts.slice(count - cycles), concurrency, async draft => {
    try {
      const published = await content.publish(
        draft.id, normalizeVersionedCommand({ expectedVersion: draft.version }), operation,
      );
      const committed = performance.now();
      for (const alias of ['a', 'b']) {
        await waitFor(`publish:${alias}:${draft.id}`, async () =>
          (await registry.adapter(alias).documentVersion(draft.id)) === published.version);
        raw.latency.publish[alias].push(performance.now() - committed);
      }
      const withdrawn = await content.withdraw(
        draft.id, normalizeVersionedCommand({ expectedVersion: published.version }), operation,
      );
      const withdrawnAt = performance.now();
      for (const alias of ['a', 'b']) {
        await waitFor(`withdraw:${alias}:${draft.id}`, async () =>
          (await registry.adapter(alias).documentVersion(draft.id)) === null);
        raw.latency.withdraw[alias].push(performance.now() - withdrawnAt);
      }
      if (withdrawn.status !== 'withdrawn') throw new Error('withdraw_state');
    } catch (error) {
      raw.errors.push({ stage: 'cycle', id: draft.id, code: error.message });
    }
  });

  for (const alias of ['a', 'b']) {
    const startedAt = performance.now();
    const result = await coordinator.run({ index: alias });
    raw.reindex[alias] = { durationMs: performance.now() - startedAt, ...result };
  }

  raw.finishedAt = new Date().toISOString();
  raw.summary = {
    publishA: stats(raw.latency.publish.a),
    publishB: stats(raw.latency.publish.b),
    withdrawA: stats(raw.latency.withdraw.a),
    withdrawB: stats(raw.latency.withdraw.b),
    errorCount: raw.errors.length,
  };
  await writeFile(resolve(output, 'm5-baseline.raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
  const markdown = `# M5 baseline\n\nRun: \`${runId}\`\n\n` +
    `This is a developer baseline, not a production SLO.\n\n` +
    `| Series | count | min ms | p50 ms | p95 ms | max ms |\n| --- | ---: | ---: | ---: | ---: | ---: |\n` +
    Object.entries(raw.summary).filter(([, value]) => typeof value === 'object').map(([name, value]) =>
      `| ${name} | ${value.count} | ${value.min} | ${value.p50} | ${value.p95} | ${value.max} |`).join('\n') +
    `\n\nErrors: ${raw.summary.errorCount}.\n`;
  await writeFile(resolve(output, 'm5-baseline.md'), markdown);
  process.stdout.write(`${JSON.stringify({ runId, output, summary: raw.summary })}\n`);
} finally {
  if (sampler) clearInterval(sampler);
  await context.close();
}
