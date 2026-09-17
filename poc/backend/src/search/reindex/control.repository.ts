import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import type { SearchIndexAlias } from '../../contracts/search.js';
import {
  ADVISORY_LOCK_CLASS, ADVISORY_LOCK_OBJECT, reindexLockObject,
  type ReindexErrorCode,
} from '../../contracts/reindex.js';
import type { Executor } from '../../database.js';
import { DatabaseService } from '../../database.js';
import {
  searchIndexControl, type ReindexPhase, type SearchIndexControlRow,
} from '../../schema.js';

function integer(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number.parseInt(value, 10);
  return 0;
}

@Injectable()
export class ReindexControlRepository {
  constructor(private readonly database: DatabaseService) {}

  async get(alias: SearchIndexAlias, executor: Executor = this.database.db): Promise<SearchIndexControlRow | null> {
    const rows = await executor.select().from(searchIndexControl)
      .where(eq(searchIndexControl.indexAlias, alias)).limit(1);
    return rows[0] ?? null;
  }

  async all(executor: Executor = this.database.db): Promise<SearchIndexControlRow[]> {
    return executor.select().from(searchIndexControl);
  }

  async beginRun(alias: SearchIndexAlias, runId: string, ownerId: string): Promise<void> {
    const now = new Date();
    const updated = await this.database.db.update(searchIndexControl).set({
      phase: 'draining',
      desiredWorkerState: 'paused',
      runId,
      ownerId,
      ownerHeartbeatAt: now,
      workerPausedAt: null,
      snapshotStreamSequence: null,
      outboxHighWater: null,
      catchUpStreamSequence: null,
      importedDocuments: 0,
      expectedDocuments: null,
      lastErrorCode: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    }).where(eq(searchIndexControl.indexAlias, alias)).returning({ alias: searchIndexControl.indexAlias });
    if (updated.length !== 1) throw new Error('control_row_missing');
  }

  async setPhase(alias: SearchIndexAlias, phase: ReindexPhase): Promise<void> {
    await this.database.db.update(searchIndexControl).set({ phase, updatedAt: new Date() })
      .where(eq(searchIndexControl.indexAlias, alias));
  }

  async setBoundaries(alias: SearchIndexAlias, values: {
    snapshotStreamSequence?: number;
    outboxHighWater?: number;
    catchUpStreamSequence?: number;
    expectedDocuments?: number;
  }): Promise<void> {
    await this.database.db.update(searchIndexControl).set({ ...values, updatedAt: new Date() })
      .where(eq(searchIndexControl.indexAlias, alias));
  }

  async addImported(alias: SearchIndexAlias, count: number): Promise<void> {
    await this.database.db.update(searchIndexControl).set({
      importedDocuments: sql`${searchIndexControl.importedDocuments} + ${count}`,
      updatedAt: new Date(),
    }).where(eq(searchIndexControl.indexAlias, alias));
  }

  async heartbeat(alias: SearchIndexAlias, ownerId: string): Promise<void> {
    await this.database.db.update(searchIndexControl).set({ ownerHeartbeatAt: new Date(), updatedAt: new Date() })
      .where(and(eq(searchIndexControl.indexAlias, alias), eq(searchIndexControl.ownerId, ownerId)));
  }

  async observeWorker(alias: SearchIndexAlias, inFlightEventId: string | null): Promise<void> {
    await this.database.db.update(searchIndexControl).set({
      workerHeartbeatAt: new Date(),
      workerInFlightEventId: inFlightEventId,
      updatedAt: new Date(),
    }).where(eq(searchIndexControl.indexAlias, alias));
  }

  async acknowledgePaused(alias: SearchIndexAlias): Promise<void> {
    await this.database.db.update(searchIndexControl).set({
      workerPausedAt: new Date(),
      workerHeartbeatAt: new Date(),
      workerInFlightEventId: null,
      updatedAt: new Date(),
    }).where(eq(searchIndexControl.indexAlias, alias));
  }

  async resumeWorker(alias: SearchIndexAlias): Promise<void> {
    await this.database.db.update(searchIndexControl).set({
      desiredWorkerState: 'running', workerPausedAt: null, updatedAt: new Date(),
    }).where(eq(searchIndexControl.indexAlias, alias));
  }

  async pauseWorker(alias: SearchIndexAlias): Promise<void> {
    await this.database.db.update(searchIndexControl).set({
      desiredWorkerState: 'paused', workerPausedAt: null, updatedAt: new Date(),
    }).where(eq(searchIndexControl.indexAlias, alias));
  }

  async complete(alias: SearchIndexAlias): Promise<void> {
    const now = new Date();
    await this.database.db.update(searchIndexControl).set({
      phase: 'ready', desiredWorkerState: 'running', ownerId: null,
      ownerHeartbeatAt: null, workerPausedAt: null, lastErrorCode: null,
      completedAt: now, updatedAt: now,
    }).where(eq(searchIndexControl.indexAlias, alias));
  }

  async fail(
    alias: SearchIndexAlias,
    code: ReindexErrorCode,
    executor: Executor = this.database.db,
  ): Promise<void> {
    await executor.update(searchIndexControl).set({
      phase: 'failed', desiredWorkerState: 'paused', ownerId: null,
      ownerHeartbeatAt: null, lastErrorCode: code, updatedAt: new Date(),
    }).where(eq(searchIndexControl.indexAlias, alias));
  }

  async highWater(executor: Executor = this.database.db): Promise<number> {
    const rows = await executor.execute(sql`select coalesce(max(outbox_sequence), 0) as value from outbox_event`);
    return integer((rows.rows[0] as { value?: unknown } | undefined)?.value);
  }

  async pendingAtOrBelow(highWater: number): Promise<number> {
    const rows = await this.database.db.execute(sql`
      select count(*)::int as value from outbox_event
      where outbox_sequence <= ${highWater}
        and delivered_at is null
    `);
    return integer((rows.rows[0] as { value?: unknown } | undefined)?.value);
  }

  /** Locks are session scoped and deliberately non-blocking. */
  async tryAcquireLocks(client: PoolClient, alias: SearchIndexAlias): Promise<boolean> {
    const global = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1, $2) as locked',
      [ADVISORY_LOCK_CLASS.reindex, ADVISORY_LOCK_OBJECT.global],
    );
    if (global.rows[0]?.locked !== true) return false;
    const index = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1, $2) as locked',
      [ADVISORY_LOCK_CLASS.reindex, reindexLockObject(alias)],
    );
    if (index.rows[0]?.locked === true) return true;
    await client.query('select pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_CLASS.reindex, ADVISORY_LOCK_OBJECT.global]);
    return false;
  }

  async releaseLocks(client: PoolClient, alias: SearchIndexAlias): Promise<void> {
    await client.query('select pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_CLASS.reindex, reindexLockObject(alias)]);
    await client.query('select pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_CLASS.reindex, ADVISORY_LOCK_OBJECT.global]);
  }
}
