import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ReindexCoordinator, type ReindexTestHooks } from '../src/search/reindex/coordinator.js';
import { StagingImporter, ReindexRunError } from '../src/search/reindex/importer.js';
import { SnapshotReader } from '../src/search/reindex/snapshot-reader.js';
import { ReindexVerifier } from '../src/search/reindex/verifier.js';
import { SearchState } from '../src/search/worker.state.js';
import { validateConfig } from '../src/config.js';
import type { DatabaseService } from '../src/database.js';
import type { ReindexControlRepository } from '../src/search/reindex/control.repository.js';
import type { SearchRegistry } from '../src/search/search.registry.js';
import type { JetStreamAdapter } from '../src/messaging/jetstream.adapter.js';
import type { MeiliIndexAdapter } from '../src/search/meili.adapter.js';

afterEach(() => vi.restoreAllMocks());

function recovery(hooks: ReindexTestHooks = {}) {
  const client = { query: vi.fn(async () => ({ rows: [{ name: 'audit_test', value: '0' }] })) };
  const database = { withClient: async (work: (c: typeof client) => unknown) => work(client) };
  const control = {
    tryAcquireLocks: vi.fn(async () => true), releaseLocks: vi.fn(async () => undefined),
    beginRun: vi.fn(), heartbeat: vi.fn(), setBoundaries: vi.fn(), setPhase: vi.fn(),
    resumeWorker: vi.fn(), pauseWorker: vi.fn(), pendingAtOrBelow: vi.fn(async () => 0),
    fail: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ phase: 'ready', workerPausedAt: new Date(), workerInFlightEventId: null, outboxHighWater: 0, expectedDocuments: 0 })),
  };
  const adapter = { indexUid: 'contents', reachable: async () => true };
  const registry = { enabled: true, adapter: () => adapter, config: { instances: { a: { durable: 'a' } } } };
  const broker = { streamSequence: async () => 0, hasSequenceRange: async () => true, consumerProgress: async () => ({ ackFloorStreamSequence: 0 }) };
  vi.spyOn(SnapshotReader.prototype, 'read').mockImplementation(async (_client, metadata) => {
    const result = { highWater: 0, expectedDocuments: 0 };
    await metadata(result);
    return result;
  });
  vi.spyOn(StagingImporter.prototype, 'prepare').mockResolvedValue();
  vi.spyOn(StagingImporter.prototype, 'assertCount').mockResolvedValue();
  const swap = vi.spyOn(StagingImporter.prototype, 'swap').mockResolvedValue();
  const cleanup = vi.spyOn(StagingImporter.prototype, 'cleanupOldIndex').mockResolvedValue();
  vi.spyOn(ReindexVerifier.prototype, 'verify').mockResolvedValue({ matches: true } as never);
  const coordinator = new ReindexCoordinator(
    new ConfigService({ LOG_LEVEL: 'silent' }), database as unknown as DatabaseService,
    control as unknown as ReindexControlRepository, registry as unknown as SearchRegistry,
    new SearchState(), broker as unknown as JetStreamAdapter, hooks,
  );
  return { coordinator, control, cleanup, swap, client };
}

describe('backend audit recovery regressions', () => {
  it('cleans a failed pre-swap import and preserves the original error', async () => {
    const error = new ReindexRunError('import_timeout');
    const h = recovery({ afterImport: () => { throw error; } });
    await expect(h.coordinator.run({ runId: randomUUID(), index: 'a' })).rejects.toBe(error);
    expect(h.cleanup).toHaveBeenCalledOnce();
    expect(h.swap).not.toHaveBeenCalled();
    expect(h.control.fail).toHaveBeenCalledWith('a', 'import_timeout');
  });

  it('keeps the former live index when failure follows a swap', async () => {
    const h = recovery({ afterSwap: () => { throw new ReindexRunError('aborted'); } });
    await expect(h.coordinator.run({ runId: randomUUID(), index: 'a' })).rejects.toMatchObject({ code: 'aborted' });
    expect(h.swap).toHaveBeenCalledOnce();
    expect(h.cleanup).not.toHaveBeenCalled();
  });

  it('preserves recovery data if the swap response is lost', async () => {
    const h = recovery();
    h.swap.mockRejectedValue(new Error('response lost'));
    await expect(h.coordinator.run({ runId: randomUUID(), index: 'a' })).rejects.toThrow('response lost');
    expect(h.cleanup).not.toHaveBeenCalled();
  });

  it('keeps a successful recovery ready even when cleanup fails', async () => {
    const h = recovery();
    h.cleanup.mockRejectedValue(new Error('delete failed'));
    await expect(h.coordinator.run({ runId: randomUUID(), index: 'a' })).resolves.toMatchObject({ index: 'a' });
    expect(h.cleanup).toHaveBeenCalledOnce();
    expect(h.control.fail).not.toHaveBeenCalled();
  });

  it('classifies server-side verification statement timeouts', async () => {
    const h = recovery();
    h.client.query.mockImplementation(async (sql?: string) => {
      if (sql?.includes('pg_advisory_xact_lock')) throw Object.assign(new Error('canceled'), { code: '57014' });
      return { rows: [{ name: 'audit_test', value: '0' }] };
    });
    await expect(h.coordinator.run({ runId: randomUUID(), index: 'a' })).rejects.toMatchObject({ code: 'verify_timeout' });
    expect(h.cleanup).not.toHaveBeenCalled();
  });

  it('treats a terminal failed deletion as a cleanup failure', async () => {
    const adapter = {
      indexUid: 'contents', deleteNamedIndex: async () => 1,
      awaitTask: async () => ({ uid: 1, status: 'failed', errorCode: null }),
    } as unknown as MeiliIndexAdapter;
    await expect(new StagingImporter(adapter, {} as ReindexControlRepository, 'a', '123e4567-e89b-42d3-a456-426614174000')
      .cleanupOldIndex()).rejects.toBeInstanceOf(ReindexRunError);
  });

  it('defaults HOST to loopback and accepts a container bind address', () => {
    const base = { NODE_ENV: 'test', PORT: 0, LOG_LEVEL: 'silent', DATABASE_URL: 'postgresql://localhost/audit_test' };
    expect(validateConfig(base).HOST).toBe('127.0.0.1');
    expect(validateConfig({ ...base, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
    expect(() => validateConfig({ ...base, HOST: ' ' })).toThrow('HOST');
  });
});
