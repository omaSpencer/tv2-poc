import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OperatorActionRepository } from '../../src/ops/operator-action.repository.js';
import { OperatorActionRunner } from '../../src/ops/operator-action.runner.js';
import type { OperatorActionExecutor } from '../../src/ops/operator-action.executor.js';
import { operatorRequestFingerprint, type OperatorActionTarget } from '../../src/contracts/operator-actions.js';
import { DatabaseService } from '../../src/database.js';
import { ReindexControlRepository } from '../../src/search/reindex/control.repository.js';
import { fakeConfig, query, testDatabaseUrl } from '../support/database.js';

const database = new DatabaseService(fakeConfig(testDatabaseUrl()));
const repository = new OperatorActionRepository(database);
const control = new ReindexControlRepository(database);
const actor = { sub: 'operator-test', roles: ['publisher'] };

function admission(overrides: Partial<Parameters<OperatorActionRepository['admit']>[0]> = {}) {
  const target: OperatorActionTarget = {
    contentId: '123e4567-e89b-42d3-a456-426614174001',
    target: 'both',
  };
  const reason = 'Integrációs javítás';
  return {
    id: randomUUID(),
    kind: 'content_repair' as const,
    requestFingerprint: operatorRequestFingerprint('content_repair', reason, target),
    actor,
    correlationId: `operator-${randomUUID()}`,
    reason,
    target,
    ...overrides,
  };
}

beforeEach(async () => {
  await query('TRUNCATE operator_action');
});

afterAll(async () => {
  await database.onApplicationShutdown();
});

describe('operator action persistence', () => {
  it('returns the same action for same key/request and rejects a changed request', async () => {
    const input = admission();
    const first = await repository.admit(input);
    const second = await repository.admit(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.action.id).toBe(first.action.id);

    await expect(repository.admit({ ...input, requestFingerprint: 'b'.repeat(64) }))
      .rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('admits at most one queued/running reindex even under concurrency', async () => {
    const target = { index: 'a' as const, allowSearchOutage: false, confirmationTarget: null };
    const reason = 'Teljes újraépítés';
    const make = () => admission({
      id: randomUUID(), kind: 'reindex', target,
      requestFingerprint: operatorRequestFingerprint('reindex', reason, target), reason,
    });
    const settled = await Promise.allSettled([repository.admit(make()), repository.admit(make())]);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(result => result.status === 'rejected')[0]).toMatchObject({
      reason: { code: 'reindex_already_running' },
    });
    expect((await repository.activeReindex())?.kind).toBe('reindex');
  });

  it('claims an action once, persists terminal result and recovers stale runners', async () => {
    const input = admission();
    await repository.admit(input);
    const [left, right] = await Promise.all([repository.claimNext(), repository.claimNext()]);
    const claimed = left ?? right;
    expect([left, right].filter(Boolean)).toHaveLength(1);
    expect(claimed?.state).toBe('running');
    await repository.succeed(input.id, { contentId: input.target.contentId, tasks: [] });
    expect((await repository.get(input.id))?.state).toBe('succeeded');

    const stale = admission();
    await repository.admit(stale);
    await repository.claimNext();
    await query('UPDATE operator_action SET heartbeat_at = now() - interval \'2 minutes\' WHERE id = $1', [stale.id]);
    const recovered = await repository.recoverStale(new Date(Date.now() - 30_000));
    expect(recovered.map(action => action.id)).toContain(stale.id);
    expect((await repository.get(stale.id))?.errorCode).toBe('internal_error');
  });

  it('atomically recovers a stale reindex action and its control row as aborted', async () => {
    const target = { index: 'a' as const, allowSearchOutage: false, confirmationTarget: null };
    const reason = 'Megszakadt reindex helyreállítása';
    const input = admission({
      id: randomUUID(), kind: 'reindex', target, reason,
      requestFingerprint: operatorRequestFingerprint('reindex', reason, target),
    });
    await repository.admit(input);
    await repository.claimNext();
    await query(
      `UPDATE operator_action SET heartbeat_at = now() - interval '2 minutes' WHERE id = $1`,
      [input.id],
    );
    await query(
      `UPDATE search_index_control SET phase = 'importing', desired_worker_state = 'paused',
       run_id = $1, owner_id = 'stale-owner', owner_heartbeat_at = now() - interval '2 minutes',
       started_at = now() - interval '2 minutes', completed_at = null, updated_at = now()
       WHERE index_alias = 'a'`,
      [input.id],
    );
    const runner = new OperatorActionRunner(
      { get: (key: string) => key === 'OPERATOR_ACTION_STALE_MS' ? 30_000 : undefined } as never,
      database,
      repository,
      {} as OperatorActionExecutor,
      control,
    );
    await (runner as unknown as { tryRecovery(): Promise<void> }).tryRecovery();

    expect(await repository.get(input.id)).toMatchObject({ state: 'failed', errorCode: 'aborted' });
    expect(await control.get('a')).toMatchObject({
      phase: 'failed', desiredWorkerState: 'paused', ownerId: null, lastErrorCode: 'aborted',
    });
  });
});
