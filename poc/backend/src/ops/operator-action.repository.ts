import { Injectable } from '@nestjs/common';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { ApiError } from '../contracts/errors.js';
import {
  parseOperatorActionResult,
  parseOperatorActionTarget,
  type OperatorActionResult,
  type OperatorActionTarget,
} from '../contracts/operator-actions.js';
import { DatabaseService, type Executor, uniqueViolation } from '../database.js';
import {
  operatorAction,
  type OperatorActionKind,
  type OperatorActionRow,
} from '../schema.js';
import type { Actor } from '../identity/actor.js';

export type OperatorActionAdmission = {
  id: string;
  kind: OperatorActionKind;
  requestFingerprint: string;
  actor: Actor;
  correlationId: string;
  reason: string;
  target: OperatorActionTarget;
};

export type OperatorActionRecord = Omit<OperatorActionRow, 'kind' | 'target' | 'result'> & {
  kind: OperatorActionKind;
  target: OperatorActionTarget;
  result: OperatorActionResult | null;
};

function decode(row: OperatorActionRow): OperatorActionRecord {
  return {
    ...row,
    kind: row.kind as OperatorActionKind,
    target: parseOperatorActionTarget(row.kind as OperatorActionKind, row.target),
    result: row.result === null
      ? null
      : parseOperatorActionResult(row.kind as OperatorActionKind, row.result),
  };
}

@Injectable()
export class OperatorActionRepository {
  constructor(private readonly database: DatabaseService) {}

  async admit(input: OperatorActionAdmission): Promise<{ action: OperatorActionRecord; created: boolean }> {
    try {
      return await this.database.transaction(async tx => {
        const now = new Date();
        const inserted = await tx.insert(operatorAction).values({
          id: input.id,
          kind: input.kind,
          state: 'queued',
          requestFingerprint: input.requestFingerprint,
          requestedBy: input.actor.sub,
          requestedRoles: [...input.actor.roles],
          correlationId: input.correlationId,
          reason: input.reason,
          target: input.target,
          createdAt: now,
        }).onConflictDoNothing({ target: operatorAction.id }).returning();
        if (inserted[0]) return { action: decode(inserted[0]), created: true };

        const existing = await tx.select().from(operatorAction)
          .where(eq(operatorAction.id, input.id)).limit(1);
        const row = existing[0];
        if (!row) throw new ApiError('internal_error', 'The idempotency record could not be read.');
        if (row.requestFingerprint !== input.requestFingerprint) {
          throw new ApiError('idempotency_conflict', 'The idempotency key is already bound to a different request.');
        }
        return { action: decode(row), created: false };
      });
    } catch (error) {
      if (uniqueViolation(error) === 'operator_action_one_active_reindex_idx') {
        throw new ApiError('reindex_already_running', 'Another reindex action is already queued or running.');
      }
      throw error;
    }
  }

  async get(id: string, executor: Executor = this.database.db): Promise<OperatorActionRecord | null> {
    const rows = await executor.select().from(operatorAction).where(eq(operatorAction.id, id)).limit(1);
    return rows[0] ? decode(rows[0]) : null;
  }

  /** Atomically claims the oldest queued action. Concurrent runners skip it. */
  async claimNext(): Promise<OperatorActionRecord | null> {
    return this.database.transaction(async tx => {
      const queued = await tx.select().from(operatorAction)
        .where(eq(operatorAction.state, 'queued'))
        .orderBy(asc(operatorAction.createdAt), asc(operatorAction.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!queued[0]) return null;
      const now = new Date();
      const updated = await tx.update(operatorAction).set({
        state: 'running',
        startedAt: now,
        heartbeatAt: now,
        errorCode: null,
      }).where(and(eq(operatorAction.id, queued[0].id), eq(operatorAction.state, 'queued'))).returning();
      return updated[0] ? decode(updated[0]) : null;
    });
  }

  async heartbeat(id: string): Promise<void> {
    await this.database.db.update(operatorAction).set({ heartbeatAt: new Date() })
      .where(and(eq(operatorAction.id, id), eq(operatorAction.state, 'running')));
  }

  async succeed(id: string, result: unknown): Promise<OperatorActionRecord> {
    const current = await this.get(id);
    if (!current) throw new ApiError('operation_not_found', 'No operator action exists for the given id.');
    const safeResult = parseOperatorActionResult(current.kind as OperatorActionKind, result);
    const now = new Date();
    const updated = await this.database.db.update(operatorAction).set({
      state: 'succeeded',
      result: safeResult,
      errorCode: null,
      heartbeatAt: now,
      completedAt: now,
    }).where(and(eq(operatorAction.id, id), eq(operatorAction.state, 'running'))).returning();
    if (!updated[0]) throw new ApiError('internal_error', 'The operator action is not running.');
    return decode(updated[0]);
  }

  async fail(id: string, errorCode: string): Promise<OperatorActionRecord> {
    const now = new Date();
    const updated = await this.database.db.update(operatorAction).set({
      state: 'failed',
      result: null,
      errorCode,
      heartbeatAt: now,
      completedAt: now,
    }).where(and(
      eq(operatorAction.id, id),
      or(eq(operatorAction.state, 'queued'), eq(operatorAction.state, 'running')),
    )).returning();
    if (!updated[0]) {
      const existing = await this.get(id);
      if (!existing) throw new ApiError('operation_not_found', 'No operator action exists for the given id.');
      return existing;
    }
    return decode(updated[0]);
  }

  async recoverStale(
    cutoff: Date,
    executor: Executor = this.database.db,
  ): Promise<OperatorActionRecord[]> {
    const now = new Date();
    const recovered = await executor.update(operatorAction).set({
      state: 'failed',
      result: null,
      errorCode: sql`case when ${operatorAction.kind} = 'reindex' then 'aborted' else 'internal_error' end`,
      heartbeatAt: now,
      completedAt: now,
    }).where(and(
      eq(operatorAction.state, 'running'),
      or(
        lt(operatorAction.heartbeatAt, cutoff),
        and(sql`${operatorAction.heartbeatAt} is null`, lt(operatorAction.startedAt, cutoff)),
      ),
    )).returning();
    return recovered.map(decode);
  }

  async activeReindex(executor: Executor = this.database.db): Promise<OperatorActionRecord | null> {
    const rows = await executor.select().from(operatorAction)
      .where(and(
        eq(operatorAction.kind, 'reindex'),
        or(eq(operatorAction.state, 'queued'), eq(operatorAction.state, 'running')),
      ))
      .orderBy(asc(operatorAction.createdAt), asc(operatorAction.id))
      .limit(1);
    return rows[0] ? decode(rows[0]) : null;
  }
}
