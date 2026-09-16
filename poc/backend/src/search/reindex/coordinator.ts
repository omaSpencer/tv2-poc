import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { pino, type Logger } from 'pino';
import type { SearchIndexAlias } from '../../contracts/search.js';
import { ADVISORY_LOCK_CLASS, ADVISORY_LOCK_OBJECT, type ReindexErrorCode } from '../../contracts/reindex.js';
import { DatabaseService } from '../../database.js';
import { JetStreamAdapter } from '../../messaging/jetstream.adapter.js';
import { SearchRegistry } from '../search.registry.js';
import { SearchState } from '../worker.state.js';
import { ReindexControlRepository } from './control.repository.js';
import { ReindexRunError, StagingImporter } from './importer.js';
import { SnapshotReader } from './snapshot-reader.js';
import { ReindexVerifier, type VerificationResult } from './verifier.js';

const POLL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type ReindexRunOptions = {
  index: SearchIndexAlias;
  allowSearchOutage?: boolean;
  confirmTarget?: string;
  signal?: { aborted: boolean };
};

export type ReindexRunResult = {
  runId: string;
  index: SearchIndexAlias;
  snapshotStreamSequence: number;
  catchUpStreamSequence: number;
  expectedDocuments: number;
  verification: VerificationResult;
  durationMs: number;
};

/** Test-assembly-only interruption points; no HTTP or environment trigger. */
export const REINDEX_TEST_HOOKS = 'REINDEX_TEST_HOOKS';
export type ReindexTestHooks = {
  afterImport?: (runId: string) => Promise<void> | void;
  afterSwap?: (runId: string) => Promise<void> | void;
  afterCatchUp?: (runId: string) => Promise<void> | void;
  beforeReady?: (runId: string) => Promise<void> | void;
};

@Injectable()
export class ReindexCoordinator {
  private readonly log: Logger;
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ReindexControlRepository) private readonly control: ReindexControlRepository,
    @Inject(SearchRegistry) private readonly registry: SearchRegistry,
    @Inject(SearchState) private readonly state: SearchState,
    @Inject('SEARCH_BROKER') private readonly broker: JetStreamAdapter,
    @Optional() @Inject(REINDEX_TEST_HOOKS) private readonly hooks: ReindexTestHooks | null = null,
  ) {
    this.log = pino({ level: this.config.get<string>('LOG_LEVEL') ?? 'info' });
  }

  async run(options: ReindexRunOptions): Promise<ReindexRunResult> {
    if (!this.registry.enabled) throw new ReindexRunError('index_unreachable', 'search_disabled');
    const started = Date.now();
    const runId = randomUUID();
    const ownerId = randomUUID();
    let began = false;
    let importer: StagingImporter | null = null;
    // A lost response can leave a successfully submitted swap unresolved.
    // Preserve the staging UID once submission starts: it may hold the old live index.
    let swapStarted = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    return this.database.withClient(async client => {
      if (!(await this.control.tryAcquireLocks(client, options.index))) {
        throw new ReindexRunError('reindex_already_running');
      }
      try {
        await this.assertTarget(client, options);
        await this.assertOtherIndex(options.index, options.allowSearchOutage === true);
        await this.control.beginRun(options.index, runId, ownerId);
        began = true;
        heartbeat = setInterval(() => {
          void this.control.heartbeat(options.index, ownerId).catch(() => undefined);
        }, this.config.get<number>('REINDEX_OWNER_HEARTBEAT_MS') ?? 5000);

        await this.waitForDrain(options.index, this.config.get<number>('REINDEX_DRAIN_TIMEOUT_MS') ?? 30_000, options.signal);
        this.assertNotAborted(options.signal);

        const s0 = await this.broker.streamSequence();
        await this.control.setBoundaries(options.index, { snapshotStreamSequence: s0 });
        await this.control.setPhase(options.index, 'importing');

        const adapter = this.registry.adapter(options.index);
        const staging = new StagingImporter(adapter, this.control, options.index, runId);
        importer = staging;
        const batchSize = this.config.get<number>('REINDEX_BATCH_SIZE') ?? 500;
        const importTimeout = this.config.get<number>('REINDEX_IMPORT_TIMEOUT_MS') ?? 300_000;
        const importDeadline = Date.now() + importTimeout;
        const reader = new SnapshotReader(batchSize, importTimeout);
        try {
          await reader.read(client, async metadata => {
            await this.control.setBoundaries(options.index, {
              outboxHighWater: metadata.highWater,
              expectedDocuments: metadata.expectedDocuments,
            });
            await staging.prepare();
          }, async documents => {
            this.assertNotAborted(options.signal);
            if (Date.now() >= importDeadline) throw new ReindexRunError('import_timeout');
            await staging.import(documents);
          });
        } catch (error) {
          if (error instanceof ReindexRunError) throw error;
          if ((error as { code?: unknown }).code === '57014') throw new ReindexRunError('snapshot_timeout');
          throw error;
        }
        const current = await this.control.get(options.index);
        const highWater = current?.outboxHighWater ?? 0;
        const expected = current?.expectedDocuments ?? 0;
        await staging.assertCount(expected);
        await this.hooks?.afterImport?.(runId);

        await this.waitForRelay(highWater, importDeadline, options.signal);
        const s1 = await this.broker.streamSequence();
        await this.control.setBoundaries(options.index, { catchUpStreamSequence: s1 });
        if (!(await this.broker.hasSequenceRange(s0 + 1, s1))) {
          throw new ReindexRunError('stream_history_gap');
        }

        await this.control.setPhase(options.index, 'swapping');
        swapStarted = true;
        await staging.swap();
        await this.hooks?.afterSwap?.(runId);
        await this.control.setPhase(options.index, 'catching_up');
        await this.control.resumeWorker(options.index);
        await this.waitForCatchUp(options.index, s1, this.config.get<number>('REINDEX_VERIFY_TIMEOUT_MS') ?? 30_000, options.signal);
        await this.hooks?.afterCatchUp?.(runId);

        const verification = await this.verifyUnderBarrier(client, options.index, runId, options.signal);
        // The swap leaves the former live index at the staging UID. Cleanup is
        // deliberately after the atomic ready commit; failure is a maintenance
        // warning, never a reason to invalidate a verified live index.
        await this.cleanup(staging, runId);
        return {
          runId,
          index: options.index,
          snapshotStreamSequence: s0,
          catchUpStreamSequence: s1,
          expectedDocuments: expected,
          verification,
          durationMs: Date.now() - started,
        };
      } catch (error) {
        if (began && importer !== null && !swapStarted) await this.cleanup(importer, runId);
        if (began) await this.control.fail(options.index, this.errorCode(error)).catch(() => undefined);
        throw error;
      } finally {
        if (heartbeat !== null) clearInterval(heartbeat);
        await this.control.releaseLocks(client, options.index).catch(() => undefined);
      }
    });
  }

  private async assertTarget(client: PoolClient, options: ReindexRunOptions): Promise<void> {
    const database = (await client.query<{ name: string }>('select current_database() as name')).rows[0]?.name;
    const confirmationRequired = options.allowSearchOutage
      || this.config.get<string>('NODE_ENV') === 'production';
    if (confirmationRequired && (!database || options.confirmTarget !== database)) {
      throw new ReindexRunError('target_confirmation_required');
    }
  }

  private async assertOtherIndex(alias: SearchIndexAlias, outageAllowed: boolean): Promise<void> {
    const other: SearchIndexAlias = alias === 'a' ? 'b' : 'a';
    const control = await this.control.get(other);
    const reachable = await this.registry.adapter(other).reachable();
    if ((control?.phase !== 'ready' || !reachable) && !outageAllowed) {
      throw new ReindexRunError('other_index_unavailable');
    }
  }

  private async waitForDrain(alias: SearchIndexAlias, timeoutMs: number, signal?: { aborted: boolean }): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const staleMs = this.config.get<number>('REINDEX_WORKER_STALE_MS') ?? 15_000;
    while (Date.now() < deadline) {
      this.assertNotAborted(signal);
      const row = await this.control.get(alias);
      if (row === null) throw new ReindexRunError('control_row_missing');
      if (row.workerPausedAt !== null && row.workerInFlightEventId === null) return;
      const heartbeatAge = row.workerHeartbeatAt === null ? Number.POSITIVE_INFINITY : Date.now() - row.workerHeartbeatAt.getTime();
      if (heartbeatAge > staleMs && row.workerInFlightEventId === null) return;
      await delay(POLL_MS);
    }
    throw new ReindexRunError('worker_drain_timeout');
  }

  private async waitForRelay(highWater: number, deadline: number, signal?: { aborted: boolean }): Promise<void> {
    while (Date.now() < deadline) {
      this.assertNotAborted(signal);
      if (await this.control.pendingAtOrBelow(highWater) === 0) return;
      await delay(POLL_MS);
    }
    throw new ReindexRunError('relay_drain_timeout');
  }

  private async waitForCatchUp(
    alias: SearchIndexAlias,
    boundary: number,
    timeoutMs: number,
    signal?: { aborted: boolean },
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const durable = this.registry.config.instances[alias].durable;
    while (Date.now() < deadline) {
      this.assertNotAborted(signal);
      const runtime = this.state.get(alias);
      if (runtime.state === 'halted') throw new ReindexRunError('catch_up_worker_unhealthy');
      const progress = await this.broker.consumerProgress(durable);
      const control = await this.control.get(alias);
      if (progress.ackFloorStreamSequence >= boundary
        && control?.workerInFlightEventId === null
        && runtime.state !== 'retrying') return;
      await delay(POLL_MS);
    }
    throw new ReindexRunError('catch_up_timeout');
  }

  private async verifyUnderBarrier(
    client: PoolClient,
    alias: SearchIndexAlias,
    runId: string,
    signal?: { aborted: boolean },
  ): Promise<VerificationResult> {
    const timeout = this.config.get<number>('REINDEX_VERIFY_TIMEOUT_MS') ?? 30_000;
    const deadline = Date.now() + timeout;
    await this.control.setPhase(alias, 'verifying');
    await client.query('begin');
    try {
      await client.query(`set local lock_timeout = '${timeout}ms'`);
      await client.query(`set local statement_timeout = '${timeout}ms'`);
      await client.query('select pg_advisory_xact_lock($1, $2)', [
        ADVISORY_LOCK_CLASS.writeBarrier, ADVISORY_LOCK_OBJECT.writeBarrier,
      ]);
      const highWaterResult = await client.query<{ value: string }>(
        'select coalesce(max(outbox_sequence), 0)::text as value from outbox_event',
      );
      const highWater = Number.parseInt(highWaterResult.rows[0]?.value ?? '0', 10);
      await this.waitForRelay(highWater, deadline, signal);
      const s2 = await this.broker.streamSequence();
      await this.control.setBoundaries(alias, { catchUpStreamSequence: s2, outboxHighWater: highWater });
      await this.control.resumeWorker(alias);
      await this.waitForCatchUp(alias, s2, Math.max(1, deadline - Date.now()), signal);
      await this.control.pauseWorker(alias);
      await this.waitForDrain(alias, Math.max(1, deadline - Date.now()), signal);
      if (Date.now() >= deadline) throw new ReindexRunError('verify_timeout');

      const result = await new ReindexVerifier(this.config.get<number>('REINDEX_BATCH_SIZE') ?? 500)
        .verify(client, this.registry.adapter(alias));
      if (!result.matches) throw new ReindexRunError('verify_mismatch');
      await this.hooks?.beforeReady?.(runId);
      const now = new Date();
      await client.query(`
        update search_index_control set
          phase = 'ready', desired_worker_state = 'running', owner_id = null,
          owner_heartbeat_at = null, worker_paused_at = null,
          last_error_code = null, completed_at = $2, updated_at = $2
        where index_alias = $1
      `, [alias, now]);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (['55P03', '57014'].includes((error as { code?: string }).code ?? '')) throw new ReindexRunError('verify_timeout');
      throw error;
    }
  }

  private assertNotAborted(signal?: { aborted: boolean }): void {
    if (signal?.aborted) throw new ReindexRunError('aborted');
  }

  private async cleanup(importer: StagingImporter, runId: string): Promise<void> {
    await importer.cleanupOldIndex().catch(() => {
      this.log.warn({ event: 'reindex_cleanup_failed', runId, stagingUid: importer.stagingUid });
    });
  }

  private errorCode(error: unknown): ReindexErrorCode {
    return error instanceof ReindexRunError ? error.code : 'internal_error';
  }
}
